const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mixFor, clearCache, TTL_MS } = require('./mix.js');

test('the mix is looked up per team, cached for a minute, and survives a store error', async () => {
  clearCache();
  const calls = [];
  const s = { getMix: async (team) => { calls.push(team); if (team === 'Sales') throw new Error('down'); return team === 'Billing' ? { quality: 40, productivity: 45, adherence: 15 } : null; } };
  assert.equal((await mixFor(s, 'Billing', 1000)).quality, 40);
  assert.equal((await mixFor(s, 'Billing', 2000)).quality, 40, 'cached');
  assert.equal((await mixFor(s, undefined, 1000)).quality, 50, 'no profile: engine default');
  assert.equal((await mixFor(s, 'Sales', 1000)).quality, 50, 'store error: default');
  assert.deepEqual(calls, ['Billing', undefined, 'Sales']);
  await mixFor(s, 'Billing', 1000 + TTL_MS + 1);
  assert.equal(calls.length, 4, 'refreshed after the ttl');
});
