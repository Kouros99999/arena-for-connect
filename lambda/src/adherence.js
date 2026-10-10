/*
 * Schedule adherence import. Runs hourly; the first run after local midnight scores yesterday, later runs are no-ops.
 *
 * Amazon Connect computes adherence itself when forecasting, capacity planning and scheduling are enabled on the
 * instance. This job reads it with GetMetricDataV2 (AGENT_SCHEDULE_ADHERENCE, AGENT_ADHERENT_TIME, AGENT_SCHEDULED_TIME)
 * for every agent Arena knows, grouped by agent, over the local day, and turns each agent's result into one
 * ADHERENCE_SCORED event: `Adherence` (percent), `AdherentHours`, `ScheduledHours`. Points are BASE.adherenceHour per
 * adherent hour, weighted by the adherence slider in the scoring mix. Agents with no schedule that day get nothing,
 * neither points nor a penalty.
 *
 * The instance ARN is derived from the agent ARNs, so there is nothing to configure beyond turning the job on
 * (ScheduleAdherence=enabled in the stack). Idempotent through a MARK row per day and a DedupKey per agent and day.
 */
'use strict';
const Arena = require('./arena-engine.js');
const store = require('./store.js');
const clock = require('./clock.js');
const { mixFor } = require('./mix.js');

const METRICS = ['AGENT_SCHEDULE_ADHERENCE', 'AGENT_ADHERENT_TIME', 'AGENT_SCHEDULED_TIME'];

let cc;
function connect(region) {
  if (cc) return cc;
  const { ConnectClient, GetMetricDataV2Command } = require('@aws-sdk/client-connect');
  cc = { client: new ConnectClient(region ? { region } : {}), GetMetricDataV2Command };
  return cc;
}

/** arn:aws:connect:region:acct:instance/<id>/agent/<id> -> { instanceArn, agentId }. Null for anything else. */
function splitAgentArn(arn) {
  const m = /^(arn:aws:connect:([a-z0-9-]+):\d+:instance\/[^/]+)\/agent\/([^/]+)$/.exec(arn || '');
  return m ? { instanceArn: m[1], region: m[2], agentId: m[3] } : null;
}

/** Pure: GetMetricDataV2 results -> { [agentId]: { adherence, adherentSeconds, scheduledSeconds } }. */
function readResults(results) {
  const out = {};
  for (const r of results || []) {
    const id = r.Dimensions && r.Dimensions.AGENT;
    if (!id) continue;
    const o = out[id] || (out[id] = { adherence: null, adherentSeconds: 0, scheduledSeconds: 0 });
    for (const c of r.Collections || []) {
      const name = c.Metric && c.Metric.Name, v = Number(c.Value);
      if (!Number.isFinite(v)) continue;
      if (name === 'AGENT_SCHEDULE_ADHERENCE') o.adherence = v;
      else if (name === 'AGENT_ADHERENT_TIME') o.adherentSeconds = v;
      else if (name === 'AGENT_SCHEDULED_TIME') o.scheduledSeconds = v;
    }
  }
  return out;
}

/** Pure: one agent's day of adherence -> the event to score, or null when there was no schedule. */
function toEvent(live, day, m, endIso) {
  if (!m || !(m.scheduledSeconds > 0)) return null;
  const arn = live.pk.replace(/^AGENT#/, '');
  const adherence = m.adherence != null ? Math.round(m.adherence * 10) / 10 : Math.round((m.adherentSeconds / m.scheduledSeconds) * 1000) / 10;
  return { EventType: 'ADHERENCE_SCORED', AgentARN: arn, EventTimestamp: endIso, Day: day, Adherence: adherence,
    AdherentHours: Math.round((m.adherentSeconds / 3600) * 10) / 10, ScheduledHours: Math.round((m.scheduledSeconds / 3600) * 10) / 10,
    Team: live.team, Username: live.username, Name: live.displayName, DedupKey: `ADH#${day}#${arn.split('/').pop()}` };
}

async function runFor(now, deps) {
  deps = deps || {};
  const s = deps.store || store;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const day = clock.addDays(clock.dayKey(nowMs), -1);
  if (await s.getMark('ADHERENCE', day)) return { day, skipped: 'already imported' };
  const live = (await s.scanLiveFull()).filter((r) => splitAgentArn(r.pk.replace(/^AGENT#/, '')));
  if (!live.length) return { day, agents: 0, scored: 0 };
  const bounds = clock.dayBounds(day);
  const endIso = new Date(bounds.end - 1000).toISOString();   // the last second of the local day, so the day row is yesterday's
  const byInstance = new Map();
  for (const r of live) { const p = splitAgentArn(r.pk.replace(/^AGENT#/, '')); if (!byInstance.has(p.instanceArn)) byInstance.set(p.instanceArn, []); byInstance.get(p.instanceArn).push({ live: r, ...p }); }
  let scored = 0, noSchedule = 0, points = 0;
  for (const [instanceArn, agents] of byInstance) {
    const c = deps.connect || connect(agents[0].region);
    for (let i = 0; i < agents.length; i += 100) {
      const chunk = agents.slice(i, i + 100);
      let results = [], NextToken;
      do {
        const r = await c.client.send(new c.GetMetricDataV2Command({ ResourceArn: instanceArn, StartTime: new Date(bounds.start), EndTime: new Date(bounds.end),
          Filters: [{ FilterKey: 'AGENT', FilterValues: chunk.map((a) => a.agentId) }], Groupings: ['AGENT'], Metrics: METRICS.map((Name) => ({ Name })), NextToken }));
        results = results.concat(r.MetricResults || []); NextToken = r.NextToken;
      } while (NextToken);
      const byAgent = readResults(results);
      for (const a of chunk) {
        const ev = toEvent(a.live, day, byAgent[a.agentId], endIso);
        if (!ev) { noSchedule++; continue; }
        const pts = Arena.scoreEvent('ADHERENCE_SCORED', ev, await mixFor(s, ev.Team));
        if (await s.apply(store.planWrites(ev, pts, nowMs)) !== false) { scored++; points += pts; }
      }
    }
  }
  await s.putMark('ADHERENCE', day, { agents: live.length, scored, noSchedule, points });
  return { day, agents: live.length, scored, noSchedule, points };
}

exports.handler = async (event, context, deps) => {
  const r = await runFor((deps && deps.now) ? deps.now() : Date.now(), deps);
  console.log(JSON.stringify(r));
  return r;
};
exports.runFor = runFor;
exports.readResults = readResults;
exports.toEvent = toEvent;
exports.splitAgentArn = splitAgentArn;
