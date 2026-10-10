/*
 * Hourly job: daily digests and challenge finishing.
 *
 * Runs every hour. For each team with notification settings it sends the daily digest at the team's
 * chosen hour (UTC). For every team it finalises challenges whose end date has passed: standings are
 * frozen and prizes paid once. Idempotent: a digest is recorded per team per day, and a finalised
 * challenge carries its results.
 */
'use strict';
const Arena = require('./arena-engine.js');
const store = require('./store.js');
const clock = require('./clock.js');
const { spotlight } = require('./spotlight.js');
const notify = require('./notify.js');
const challenges = require('./challenges.js');

/** The day's digest for one team from its agents and challenges. Pure. */
function buildDigest(team, agents, chals, rewardsPending, now) {
  const stats = Arena.createEngine({ agents }).stats();
  const top = [...agents].sort((a, b) => (b.today || 0) - (a.today || 0)).slice(0, 5).map((a) => ({ name: a.name, points: a.today || 0 }));
  const flagged = agents.filter((a) => Arena.flagsFor(a, agents, now).length).length;
  return { team, points: stats.points, handled: stats.handled, qa: stats.qa, sentiment: stats.sentiment, kudos: agents.reduce((s, a) => s + (a.kudosReceived || 0), 0),
    top, challenges: chals.filter((c) => c.state === 'active').map((c) => ({ title: c.title, label: (c.progress && c.progress.label) || '' })), flagged, rewardsPending };
}

async function runFor(now, deps) {
  deps = deps || {};
  const s = deps.store || store, sendFn = deps.send || notify.send;
  const nowDate = typeof now === 'number' ? new Date(now) : now;
  const today = clock.dayKey(nowDate), hour = clock.hourOf(nowDate);   // the team's digest hour is local time
  const teams = await s.listTeams();
  const out = { teams: teams.length, digests: 0, finalized: 0, prizes: 0, bestDays: 0 };
  const yesterday = clock.addDays(today, -1);
  for (const team of teams) {
    const cfg = notify.withDefaults(await s.getNotify(team));
    const notifyTeam = async (t, ev) => sendFn(cfg, ev, deps);
    // 1. Finish challenges whose time is up.
    const items = await s.listTeamItems(team, 'CH#', 50, true);
    for (const c of items) {
      if (c.results || c.endsAt >= today) continue;
      const r = await challenges.finalize(s, team, c, nowDate, { notify: notifyTeam });
      if (r) { out.finalized++; out.prizes += (r.prizes || []).length; }
    }
    // 2. Personal bests: once per team per day, the first run after local midnight looks at yesterday against each agent's record.
    if (!(await s.getDigestMark(team + '#best', yesterday))) {
      try {
        const rows = (await s.getTeamDays(team, [yesterday]))[yesterday] || [];
        const names = {}; for (const l of await s.getTeamLive(team)) names[l.pk.replace(/^AGENT#/, '')] = l.displayName || l.username;
        for (const row of rows) {
          const arn = row.pk.replace(/^AGENT#/, '');
          const hist = (await s.getAgentDays(arn, clock.addDays(yesterday, -89), yesterday)).map((r) => ({ day: r.sk.slice(4), points: r.points || 0 }));
          if (Arena.isBestDay(hist, yesterday) && await spotlight(s, team, { kind: 'bestDay', points: row.points, agent: arn, name: names[arn] || row.username, at: nowDate.toISOString() }, deps)) out.bestDays++;
        }
        await s.putDigestMark(team + '#best', yesterday, ['checked']);
      } catch (e) { console.warn('best-day check failed for', team, e.message); }
    }
    // 2. The daily digest, once, at the team's hour.
    if (!cfg.events.digest || cfg.digestHour !== hour || !(cfg.slackUrl || cfg.teamsUrl || cfg.email)) continue;
    if (await s.getDigestMark(team, today)) continue;
    const [agents, chals, rewards] = await Promise.all([s.getTeam(team, nowDate.toISOString()), challenges.challengesFor(s, team, nowDate, { supervisor: true }), s.listTeamItems(team, 'RW#', 100, true)]);
    if (!agents.length) continue;
    const digest = buildDigest(team, agents, chals, rewards.filter((r) => r.status === 'pending').length, nowDate.getTime());
    const used = await sendFn(cfg, { kind: 'digest', digest }, deps);
    if (used.length) { await s.putDigestMark(team, today, used); out.digests++; }
  }
  return out;
}

exports.handler = async (event, context, deps) => {
  const r = await runFor((deps && deps.now) ? deps.now() : Date.now(), deps);
  console.log(JSON.stringify(r));
  return r;
};
exports.runFor = runFor;
exports.buildDigest = buildDigest;
