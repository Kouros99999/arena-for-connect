/*
 * Nightly streak job. Runs after midnight UTC on the same schedule as metering.
 *
 * A "clean day" is: at least one contact handled, no evaluation auto-fail, and every
 * evaluation that day at or above STREAK_QA (default 85). A clean day extends the agent's
 * streak by one; anything else resets it to zero. Days with no contacts (days off) neither
 * extend nor reset: the streak is held.
 *
 * From day 2 onward each clean day pays the streak bonus (BASE.streakDay) into the new day,
 * so the agent sees "Streak bonus, day N" first thing in the morning.
 *
 * Idempotent: the LIVE row records which day was last assessed; re-running for that day is a no-op.
 */
'use strict';
const Arena = require('./arena-engine.js');
const store = require('./store.js');

const STREAK_QA = +(process.env.STREAK_QA || 85);

/** Pure: given a day's aggregate row (or null) and the current streak, return the new streak and whether the day was clean. */
function assessDay(dayRow, streak) {
  if (!dayRow || !(dayRow.handled > 0)) return { streak, clean: null };   // no contacts: hold
  const evals = (dayRow.evals || []).filter((e) => typeof e === 'number');
  const autofail = (dayRow.autofails || 0) > 0 || evals.some((e) => e === 0);
  const clean = !autofail && evals.filter((e) => e > 0).every((e) => e >= STREAK_QA);
  return { streak: clean ? streak + 1 : 0, clean };
}

async function runFor(now, deps) {
  const s = (deps && deps.store) || store;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const yesterday = new Date(nowMs - 86400000).toISOString().slice(0, 10);
  const rows = await s.scanLiveFull();
  let assessed = 0, extended = 0, reset = 0, held = 0, bonuses = 0;
  for (const live of rows) {
    if (live.streakAssessed === yesterday) continue;
    const arn = live.pk.replace(/^AGENT#/, '');
    const day = await s.getDay(arn, yesterday);
    const r = assessDay(day, live.streak || 0);
    assessed++;
    if (r.clean === null) held++; else if (r.streak > (live.streak || 0)) extended++; else reset++;
    await s.setStreak(arn, r.streak, yesterday);
    if (r.clean && r.streak >= 2) {
      const ev = { EventType: 'STREAK_DAY', AgentARN: arn, EventTimestamp: new Date(nowMs).toISOString(), Day: r.streak, Team: live.team, Username: live.username, Name: live.displayName };
      await s.apply(store.planWrites(ev, Arena.scoreEvent('STREAK_DAY', ev, Arena.DEFAULT_MIX), nowMs));
      bonuses++;
    }
  }
  return { day: yesterday, assessed, extended, reset, held, bonuses };
}

exports.handler = async (event, context, deps) => {
  const r = await runFor((deps && deps.now) ? deps.now() : Date.now(), deps);
  console.log(JSON.stringify(r));
  return r;
};
exports.assessDay = assessDay;
exports.runFor = runFor;
