/*
 * The scoring mix an event is scored with: the team's own profile when a supervisor has set one,
 * otherwise the stack-wide default, otherwise the engine's built-in weights. Cached per team for a
 * minute so the stream handlers do not read DynamoDB for every event.
 */
'use strict';
const Arena = require('./arena-engine.js');

const TTL_MS = 60000;
const cache = new Map();   // team -> { at, mix }

async function mixFor(s, team, nowMs) {
  const key = team || '';
  const now = nowMs || Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.mix;
  let mix = hit ? hit.mix : Arena.DEFAULT_MIX;
  try { mix = (await s.getMix(team)) || Arena.DEFAULT_MIX; }
  catch (e) { console.warn('mix lookup failed, using the last known mix', e.message); }
  cache.set(key, { at: now, mix });
  return mix;
}
const clearCache = () => cache.clear();

module.exports = { mixFor, clearCache, TTL_MS };
