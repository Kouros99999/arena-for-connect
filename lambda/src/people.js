/*
 * One person, many platform ids.
 *
 * Arena keys an agent's rows by whatever id first fed them (a Connect ARN today). When a customer moves platforms,
 * or runs two, the new platform's id for the same person is linked to the existing one with an alias
 * (pk ALIAS#<platform id> -> agent). Every connector resolves ids through here before writing, so points, streaks,
 * personal bests and coaching history carry on under the person's original key. Cached for a minute per id.
 */
'use strict';

const TTL_MS = 60000;
const cache = new Map();

/** The key an event for `id` should be written under: its alias target if one exists, else itself. */
async function resolve(s, id, nowMs) {
  if (!id) return id;
  const now = nowMs || Date.now();
  const hit = cache.get(id);
  if (hit && now - hit.at < TTL_MS) return hit.to;
  let to = id;
  try { const a = await s.getAlias(id); if (a && a.agent) to = a.agent; }
  catch (e) { console.warn('alias lookup failed for', id, e.message); }
  cache.set(id, { at: now, to });
  return to;
}
const clearCache = () => cache.clear();

module.exports = { resolve, clearCache, TTL_MS };
