/*
 * Spotlights: recognition Arena writes itself when something notable happens, so good moments reach the team
 * without waiting for a person to send kudos. A spotlight is a kudos-feed item "from Arena" (shown on the console,
 * the wallboard ticker and the agent panel) plus a channel message under the "spotlights" notification switch.
 * No points are attached: nothing here can be farmed.
 *
 * Moments: an evaluation at or above SPOTLIGHTS.evalScore; a quality streak reaching one of SPOTLIGHTS.streakDays;
 * a personal best day (yesterday beat every earlier day on record, with at least SPOTLIGHTS.minPriorDays earlier days).
 */
'use strict';
const Arena = require('./arena-engine.js');
const notify = require('./notify.js');

/** Write the feed item and tell the channels. Never throws: a spotlight must not fail the job that noticed it. */
async function spotlight(s, team, data, deps) {
  try {
    const at = data.at || new Date().toISOString();
    const text = Arena.spotlightText(data.kind, data);
    if (!text || !team) return false;
    await s.putTeamItem(team, `KD#${at}#spot-${(data.agent || '').split('/').pop()}-${data.kind}`, { at, from: 'Arena', auto: true, kind: data.kind, to: data.agent, toName: data.name || (data.agent || '').split('/').pop(), note: text, ttl: Math.floor(Date.now() / 1000) + 90 * 86400 });
    const cfg = await s.getNotify(team);
    if (cfg) await ((deps && deps.send) || notify.send)(cfg, { kind: 'spotlight', who: data.name || (data.agent || '').split('/').pop(), what: text }, deps);
    return true;
  } catch (e) { console.warn('spotlight failed', e.message); return false; }
}

module.exports = { spotlight };
