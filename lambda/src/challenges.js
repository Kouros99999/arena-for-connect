/*
 * Challenges over their real period, for the API and the hourly job.
 *
 * A challenge runs from startsAt to endsAt. Progress and standings are measured over that whole
 * period from the per-agent day rows, not just today. When a challenge ends (by date, or a
 * supervisor ends it) its standings are frozen into `results` and prizes are paid once as
 * CHALLENGE_WON events, so later data never changes who won.
 */
'use strict';
const Arena = require('./arena-engine.js');
const store = require('./store.js');

const MAX_DAYS = 92;
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00.000Z') + n * 86400000).toISOString().slice(0, 10);
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dayRow = (row, names) => { const id = row.pk.replace(/^AGENT#/, ''); return { id, name: (names && names[id]) || row.username || id.split('/').pop(), points: row.points || 0, handled: row.handled || 0, ahtSum: row.ahtSum || 0,
  evals: row.evals || [], autofails: row.autofails || 0, escalations: row.escalations || 0, kudosReceived: row.kudosReceived || 0, sentSum: row.sentSum || 0, sentCount: row.sentCount || 0, csatSum: row.csatSum || 0, csatCount: row.csatCount || 0 }; };
const stateOf = (c, today) => (c.state === 'ended' || c.results ? 'ended' : c.startsAt > today ? 'scheduled' : c.endsAt < today ? 'ended' : 'active');

/** Day rows for a team between two dates, keyed by date, with display names applied. */
async function teamDays(s, team, from, to) {
  const dates = []; for (let d = from; d <= to; d = addDays(d, 1)) { dates.push(d); if (dates.length >= MAX_DAYS) break; }
  const [byDate, live] = await Promise.all([s.getTeamDays(team, dates), s.getTeamLive(team)]);
  const names = {}; for (const l of live) names[l.pk.replace(/^AGENT#/, '')] = l.displayName || l.username;
  return dates.map((date) => ({ date, rows: (byDate[date] || []).map((row) => dayRow(row, names)) }));
}

/** Aggregate agents for one challenge's period from a prepared day list (and the opponent's, for team vs team). */
function periodAgents(days, c, today) {
  const to = c.endsAt < today ? c.endsAt : today;
  return Arena.aggregateAgents(days.filter((d) => d.date >= c.startsAt && d.date <= to));
}

/** Every challenge for a team with state, progress and (for races and duels) standings measured over its period. */
async function challengesFor(s, team, now, opts) {
  opts = opts || {};
  const today = now.toISOString().slice(0, 10);
  const items = (await s.listTeamItems(team, 'CH#', 50, true)).map((i) => { const { pk, sk, ttl, ...rest } = i; return Object.assign(rest, { _sk: sk }); });
  const live = items.filter((c) => !c.results && c.startsAt <= today);
  const from = live.length ? live.reduce((m, c) => (c.startsAt < m ? c.startsAt : m), today) : today;
  const days = await teamDays(s, team, from < addDays(today, -(MAX_DAYS - 1)) ? addDays(today, -(MAX_DAYS - 1)) : from, today);
  const opponentDays = {};
  for (const c of live) if (c.template === 'teams' && c.opponent && !opponentDays[c.opponent]) opponentDays[c.opponent] = await teamDays(s, c.opponent, c.startsAt, today);
  return items.map((c) => {
    const { _sk, ...clean } = c;
    const state = stateOf(c, today);
    let progress;
    if (c.results) progress = Object.assign({}, c.results, { frozen: true });
    else {
      const agents = periodAgents(days, c, today);
      const withOpp = c.template === 'teams' && opponentDays[c.opponent] ? Object.assign({}, c, { opponentAgents: periodAgents(opponentDays[c.opponent], c, today) }) : c;
      progress = Arena.challengeProgress(withOpp, agents);
    }
    const out = Object.assign({}, clean, { state, progress });
    // Anonymised races hide who is where from everyone but supervisors; each agent still sees their own row.
    if (c.anonymize && !opts.supervisor && progress && progress.standings) {
      out.progress = Object.assign({}, progress, { value: progress.measured ? 'in progress' : progress.value, label: progress.measured ? `${progress.standings.rows.filter((r) => r.rank).length} ranked` : progress.label,
        standings: { metrics: progress.standings.metrics, rows: progress.standings.rows.map((r) => (r.agentId === opts.viewer ? Object.assign({}, r, { you: true }) : { rank: r.rank, score: r.score, values: r.values, qualified: r.qualified, excluded: r.excluded, measured: r.measured })) } });
    }
    return out;
  });
}

/** Prizes a finished challenge owes: [{ agentId, name, points, place }]. Pure. */
function prizesFor(c, progress, agents) {
  const out = [];
  const st = progress && progress.standings;
  if (st) { for (const r of st.rows) if (r.rank && r.prize > 0) out.push({ agentId: r.agentId, name: r.name, points: r.prize, place: ordinal(r.rank) }); return out; }
  if (!progress || !progress.onTrack) return out;
  const each = Number(c.reward) || 0;
  if (!each) return out;
  const eligible = c.template === 'kudos' ? agents.filter((a) => (a.kudosReceived || 0) >= (Number(c.target) || 0)) : c.template === 'qa' ? agents.filter((a) => (a.evals || []).some((e) => e > 0)) : agents.filter((a) => (a.handled || 0) > 0 || (a.today || 0) > 0);
  for (const a of eligible) out.push({ agentId: a.id, name: a.name, points: each, place: 'held' });
  return out;
}
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th') + ' place';

/** Freeze a challenge's result and pay prizes once. Returns the stored results, or null if it was already final. */
async function finalize(s, team, c, now, deps) {
  if (c.results) return null;
  const today = now.toISOString().slice(0, 10);
  const days = await teamDays(s, team, c.startsAt, c.endsAt < today ? c.endsAt : today);
  const agents = Arena.aggregateAgents(days);
  const withOpp = c.template === 'teams' && c.opponent ? Object.assign({}, c, { opponentAgents: Arena.aggregateAgents(await teamDays(s, c.opponent, c.startsAt, c.endsAt < today ? c.endsAt : today)) }) : c;
  const progress = Arena.challengeProgress(withOpp, agents);
  const prizes = prizesFor(c, progress, agents);
  const live = await s.getTeamLive(team);
  const byId = {}; for (const l of live) byId[l.pk.replace(/^AGENT#/, '')] = l;
  for (const p of prizes) {
    const l = byId[p.agentId] || {};
    const ev = { EventType: 'CHALLENGE_WON', AgentARN: p.agentId, EventTimestamp: now.toISOString(), Points: p.points, Title: c.title, Place: p.place, ChallengeId: c.id, Team: team, Username: l.username, Name: l.displayName, DedupKey: `CHW#${c.id}#${p.agentId}` };
    await s.apply(store.planWrites(ev, Arena.scoreEvent('CHALLENGE_WON', ev, Arena.DEFAULT_MIX), now.getTime()));
  }
  const results = Object.assign({ endedAt: now.toISOString(), prizes }, progress);
  await s.updateTeamItem(team, c.sk || c._sk, { state: 'ended', results, updatedAt: now.toISOString() });
  if (deps && deps.notify) await deps.notify(team, { kind: 'challengeEnded', challenge: c, results }).catch((e) => console.warn('notify failed', e.message));
  return results;
}

/** Validate and normalise challenge fields from a request body. Returns { ok, error, fields }. Pure. */
function challengeFields(b, t, today) {
  const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(String(v).replace(/[^0-9.-]/g, '')));
  const f = { template: b.template, title: String(b.title || t.title).slice(0, 120), scope: String(b.scope || 'Team').slice(0, 60),
    target: b.target != null ? num(b.target, t.defaultTarget) : t.defaultTarget, reward: b.reward != null ? num(b.reward, t.reward) : t.reward,
    startsAt: isDay(b.startsAt) ? b.startsAt : today, endsAt: isDay(b.endsAt) ? b.endsAt : today, excluded: [] };
  if (f.endsAt < f.startsAt) return { ok: false, error: 'the end date is before the start date' };
  if (t.ranked || b.template === 'teams') {
    const ms = Array.isArray(b.metrics) ? b.metrics : b.metric ? [{ key: b.metric, weight: 1 }] : [{ key: 'points', weight: 1 }];
    const metrics = ms.map((m) => ({ key: String(m.key), weight: Math.max(0, Number(m.weight) || 0) })).filter((m) => Arena.METRICS[m.key] && m.weight > 0).slice(0, 10);
    if (!metrics.length) return { ok: false, error: 'pick at least one measure with a weight' };
    f.metrics = metrics; f.metric = metrics[0].key;
    f.minContacts = Math.max(0, Math.round(num(b.minContacts, 0)));
    f.anonymize = !!b.anonymize;
    f.tiers = Array.isArray(b.tiers) ? b.tiers.map((x) => ({ place: Math.round(Number(x.place)), reward: Math.max(0, Math.round(Number(x.reward) || 0)) })).filter((x) => x.place >= 1 && x.place <= 10 && x.reward > 0).slice(0, 10) : [];
  }
  if (b.template === 'duel') {
    if (!Array.isArray(b.agents) || b.agents.length !== 2 || b.agents[0] === b.agents[1]) return { ok: false, error: 'a head-to-head needs two different agents' };
    f.agents = b.agents.map(String);
  }
  if (b.template === 'teams') {
    if (!b.opponent || typeof b.opponent !== 'string') return { ok: false, error: 'team vs team needs an opponent team' };
    f.opponent = b.opponent.slice(0, 80);
  }
  return { ok: true, fields: f };
}

module.exports = { challengesFor, finalize, prizesFor, challengeFields, teamDays, periodAgents, stateOf, addDays, isDay };
