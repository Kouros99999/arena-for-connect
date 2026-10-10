/*
 * Backfill: fill the first BackfillDays of history from Amazon Connect so a new installation is not empty.
 *
 * The agent event stream only starts when the stack is pointed at it, but Connect keeps three months of historical
 * metrics. Once (a MARK row records the run), this job lists the instance's users, writes a LIVE row for each so the
 * console shows the whole team, and asks GetMetricDataV2 for each past day: contacts handled, total handle time,
 * evaluations performed and their average score, grouped by agent. Each agent-day with contacts becomes one
 * BACKFILL_DAY event whose points are what the engine would have scored those contacts and evaluations at. Days
 * that already have a row (the stream was running) are left alone, and today is never backfilled.
 *
 * Needs ConnectInstanceArn on the stack and connect:ListUsers, DescribeUser, DescribeRoutingProfile, GetMetricDataV2.
 */
'use strict';
const Arena = require('./arena-engine.js');
const store = require('./store.js');
const clock = require('./clock.js');
const { mixFor } = require('./mix.js');

const INSTANCE_ARN = process.env.CONNECT_INSTANCE_ARN || '';
const DAYS = Math.max(0, Math.min(92, +(process.env.BACKFILL_DAYS || 0)));
const METRICS = ['CONTACTS_HANDLED', 'SUM_HANDLE_TIME', 'EVALUATIONS_PERFORMED', 'AVG_EVALUATION_SCORE'];

let cc;
function connect(region) {
  if (cc) return cc;
  const sdk = require('@aws-sdk/client-connect');
  cc = { client: new sdk.ConnectClient(region ? { region } : {}), ListUsersCommand: sdk.ListUsersCommand, DescribeUserCommand: sdk.DescribeUserCommand,
    DescribeRoutingProfileCommand: sdk.DescribeRoutingProfileCommand, GetMetricDataV2Command: sdk.GetMetricDataV2Command };
  return cc;
}

/** Pure: GetMetricDataV2 results with a DAY interval -> { [agentId]: { [day]: { handled, ahtSum, evals, evalAvg } } }. */
function readResults(results, tz) {
  const out = {};
  for (const r of results || []) {
    const id = r.Dimensions && r.Dimensions.AGENT, start = r.MetricInterval && r.MetricInterval.StartTime;
    if (!id || !start) continue;
    const day = clock.dayKey(start, tz);
    const a = out[id] || (out[id] = {});
    const d = a[day] || (a[day] = { handled: 0, ahtSum: 0, evals: 0, evalAvg: null });
    for (const c of r.Collections || []) {
      const name = c.Metric && c.Metric.Name, v = Number(c.Value);
      if (!Number.isFinite(v)) continue;
      if (name === 'CONTACTS_HANDLED') d.handled = v;
      else if (name === 'SUM_HANDLE_TIME') d.ahtSum = v;
      else if (name === 'EVALUATIONS_PERFORMED') d.evals = v;
      else if (name === 'AVG_EVALUATION_SCORE') d.evalAvg = v;
    }
  }
  return out;
}

/** Pure: one agent-day of Connect metrics -> a BACKFILL_DAY event and its points, or null when nothing happened. */
function toEvent(user, day, d, mix, tz) {
  if (!d || !(d.handled > 0 || d.evals > 0)) return null;
  const handled = Math.round(d.handled), ahtSum = Math.round(d.ahtSum || 0), evals = Math.round(d.evals || 0);
  const avgAht = handled ? ahtSum / handled : 0;
  let points = handled * Arena.scoreEvent('CONTACT_HANDLED', { HandleTime: avgAht }, mix);
  const evalScore = evals && d.evalAvg != null ? Math.round(d.evalAvg) : null;
  if (evals && evalScore != null) points += evals * Arena.scoreEvent('EVALUATION_SUBMITTED', { Score: evalScore }, mix);
  const end = clock.dayBounds(day, tz).end - 1000;
  const ev = { EventType: 'BACKFILL_DAY', AgentARN: user.arn, EventTimestamp: new Date(end).toISOString(), Day: day, Handled: handled, AhtSum: ahtSum,
    Evaluations: evals, EvalScore: evalScore, Team: user.team, Username: user.username, Name: user.name, DedupKey: `BF#${day}#${user.id}` };
  return { ev, points };
}

async function listUsers(c, instanceArn) {
  const instanceId = instanceArn.split('/').pop();
  const users = []; let NextToken;
  do {
    const r = await c.client.send(new c.ListUsersCommand({ InstanceId: instanceId, MaxResults: 1000, NextToken }));
    users.push(...(r.UserSummaryList || [])); NextToken = r.NextToken;
  } while (NextToken);
  const profiles = new Map(); const out = [];
  for (const u of users) {
    const d = await c.client.send(new c.DescribeUserCommand({ InstanceId: instanceId, UserId: u.Id }));
    const user = d.User || {};
    const rp = user.RoutingProfileId;
    if (rp && !profiles.has(rp)) {
      try { const p = await c.client.send(new c.DescribeRoutingProfileCommand({ InstanceId: instanceId, RoutingProfileId: rp })); profiles.set(rp, (p.RoutingProfile && p.RoutingProfile.Name) || rp); }
      catch (e) { profiles.set(rp, rp); }
    }
    const ii = user.IdentityInfo || {};
    out.push({ id: u.Id, arn: u.Arn || user.Arn, username: user.Username || u.Username, name: [ii.FirstName, ii.LastName].filter(Boolean).join(' ') || undefined, team: rp ? profiles.get(rp) : 'unassigned' });
  }
  return out;
}

async function runFor(now, deps) {
  deps = deps || {};
  const s = deps.store || store;
  const instanceArn = deps.instanceArn || INSTANCE_ARN, days = deps.days != null ? deps.days : DAYS, tz = deps.tz || clock.TZ;
  if (!instanceArn || !days) return { skipped: 'backfill not configured' };
  if (await s.getMark('BACKFILL', 'done')) return { skipped: 'already done' };
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const today = clock.dayKey(nowMs, tz), from = clock.addDays(today, -days);
  const c = deps.connect || connect(instanceArn.split(':')[3]);
  const users = await listUsers(c, instanceArn);
  // Every agent gets a LIVE row so the console shows the team from day one, without a lastEvent so nothing is metered for it.
  for (const u of users) await s.seedLive(u.arn, { team: u.team, username: u.username, displayName: u.name });
  let scored = 0, points = 0, kept = 0;
  const byId = new Map(users.map((u) => [u.id, u]));
  // GetMetricDataV2 takes at most 100 agents per filter and 35 days per DAY-interval call.
  for (let i = 0; i < users.length; i += 100) {
    const chunk = users.slice(i, i + 100);
    for (let start = from; start < today; start = clock.addDays(start, 30)) {
      const stop = clock.addDays(start, 30) < today ? clock.addDays(start, 30) : today;
      let results = [], NextToken;
      do {
        const r = await c.client.send(new c.GetMetricDataV2Command({ ResourceArn: instanceArn, StartTime: new Date(clock.dayBounds(start, tz).start), EndTime: new Date(clock.dayBounds(stop, tz).start),
          Interval: { IntervalPeriod: 'DAY', TimeZone: tz }, Filters: [{ FilterKey: 'AGENT', FilterValues: chunk.map((u) => u.id) }], Groupings: ['AGENT'],
          Metrics: METRICS.map((Name) => ({ Name })), NextToken }));
        results = results.concat(r.MetricResults || []); NextToken = r.NextToken;
      } while (NextToken);
      const data = readResults(results, tz);
      for (const [id, daysOf] of Object.entries(data)) {
        const user = byId.get(id); if (!user) continue;
        const mix = await mixFor(s, user.team);
        for (const [day, d] of Object.entries(daysOf)) {
          if (day >= today) continue;
          if (await s.getDay(user.arn, day)) { kept++; continue; }   // the stream already covered this day
          const made = toEvent(user, day, d, mix, tz);
          if (!made) continue;
          if (await s.apply(store.planWrites(made.ev, made.points, nowMs)) !== false) { scored++; points += made.points; }
        }
      }
    }
  }
  const out = { users: users.length, from, to: clock.addDays(today, -1), agentDays: scored, kept, points };
  await s.putMark('BACKFILL', 'done', out);
  return out;
}

exports.handler = async (event, context, deps) => {
  const r = await runFor((deps && deps.now) ? deps.now() : Date.now(), deps);
  console.log(JSON.stringify(r));
  return r;
};
exports.runFor = runFor;
exports.readResults = readResults;
exports.toEvent = toEvent;
