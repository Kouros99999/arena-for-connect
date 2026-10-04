const assert = require('node:assert/strict');
const { test } = require('node:test');
const { translate, objects, handler } = require('./sentiment.js');

const doc = (over) => Object.assign({
  Version: '1.1.0', Channel: 'VOICE', AccountId: '123456789012',
  CustomerMetadata: { InstanceId: 'abc', ContactId: 'c-1' },
  ConversationCharacteristics: { Sentiment: { OverallSentiment: { AGENT: 1.24, CUSTOMER: 2.86 } } },
}, over);

test('translate takes the customer overall sentiment and dedups on the contact', () => {
  const ev = translate(doc(), '2026-10-04T10:00:00.000Z');
  assert.equal(ev.EventType, 'SENTIMENT_SCORED'); assert.equal(ev.ContactId, 'c-1');
  assert.equal(ev.Sentiment, 2.9); assert.equal(ev.AgentSentiment, 1.2); assert.equal(ev.DedupKey, 'SENT#c-1'); assert.equal(ev.Channel, 'VOICE');
});

test('translate clamps out-of-range scores and ignores files without a score', () => {
  assert.equal(translate(doc({ ConversationCharacteristics: { Sentiment: { OverallSentiment: { CUSTOMER: -9 } } } })).Sentiment, -5);
  assert.equal(translate(doc({ ConversationCharacteristics: {} })), null);
  assert.equal(translate(doc({ CustomerMetadata: {} })), null);
  assert.equal(translate(null), null);
});

test('objects reads EventBridge and S3 notification shapes', () => {
  assert.deepEqual(objects({ detail: { bucket: { name: 'b' }, object: { key: 'Analysis/Voice/2026/10/04/c-1_analysis.json' } } }), [{ bucket: 'b', key: 'Analysis/Voice/2026/10/04/c-1_analysis.json' }]);
  assert.deepEqual(objects({ Records: [{ s3: { bucket: { name: 'b' }, object: { key: 'a+b.json' } } }] }), [{ bucket: 'b', key: 'a b.json' }]);
});

function fakeStore(contact, applied) {
  const calls = [];
  return { calls, getMix: async () => null, getContact: async (id) => { calls.push(['getContact', id]); return contact; }, apply: async (w) => { calls.push(['apply', w]); return applied; } };
}
const s3event = (key) => ({ detail: { bucket: { name: 'b' }, object: { key } } });

test('handler scores the contact for the agent who handled it', async () => {
  const s = fakeStore({ agent: 'arn:x/agent/p', team: 'Billing team', username: 'priya' }, true);
  const r = await handler(s3event('Analysis/Voice/2026/10/04/c-1_analysis.json'), {}, { store: s, readObject: async () => doc() });
  assert.deepEqual(r, { scored: 1, skipped: 0 });
  const writes = s.calls.find((c) => c[0] === 'apply')[1];
  const ledger = writes.find((w) => w.op === 'put' && w.item.sk.startsWith('EV#'));
  assert.equal(ledger.item.AgentARN, 'arn:x/agent/p'); assert.equal(ledger.item.points, 8); assert.equal(ledger.item.Team, 'Billing team');
  const day = writes.find((w) => w.op === 'update' && w.key.sk.startsWith('DAY#'));
  assert.equal(day.values[':ss'], 2.9); assert.equal(day.values[':sc'], 1); assert.equal(day.values[':h'], 0);
});

test('handler skips the redacted copy, counts a duplicate, and fails for retry when the contact is unknown', async () => {
  const dup = fakeStore({ agent: 'a', team: 't' }, false);
  assert.deepEqual(await handler(s3event('Analysis/Voice/Redacted/2026/10/04/c-1.json'), {}, { store: dup, readObject: async () => doc() }), { scored: 0, skipped: 1 });
  assert.deepEqual(await handler(s3event('Analysis/Voice/2026/10/04/c-1.json'), {}, { store: dup, readObject: async () => doc() }), { scored: 0, skipped: 1 });
  await assert.rejects(() => handler(s3event('Analysis/Voice/2026/10/04/c-1.json'), {}, { store: fakeStore(null, true), readObject: async () => doc() }), /retrying/);
});
