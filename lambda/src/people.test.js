const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolve, clearCache, TTL_MS } = require('./people.js');

test('ids resolve through aliases, cached, and fall back to themselves', async () => {
  clearCache(); const calls = [];
  const s = { getAlias: async (id) => { calls.push(id); if (id === 'boom') throw new Error('down'); return id === 'genesys-42' ? { agent: 'arn:connect/agent/p1' } : null; } };
  assert.equal(await resolve(s, 'genesys-42', 1000), 'arn:connect/agent/p1');
  assert.equal(await resolve(s, 'genesys-42', 2000), 'arn:connect/agent/p1'); assert.equal(calls.length, 1, 'cached');
  assert.equal(await resolve(s, 'arn:connect/agent/p1', 1000), 'arn:connect/agent/p1');
  assert.equal(await resolve(s, 'boom', 1000), 'boom', 'store error: unchanged');
  assert.equal(await resolve(s, undefined, 1000), undefined);
  await resolve(s, 'genesys-42', 1000 + TTL_MS + 1); assert.equal(calls.length, 4, 'refreshed after the ttl');
});
