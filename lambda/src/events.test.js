const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalize, normalizeCsat, TYPES } = require('./events.js');

test('canonical events validate and get dedup keys', () => {
  const c = normalize({ type: 'CONTACT_HANDLED', agent: 'g-1', at: '2026-09-15T10:00:00Z', contactId: 'c-1', handleTime: '312.6', queue: 'Billing', escalated: true, team: 'Billing team', name: 'Priya N' });
  assert.deepEqual(c, { EventType: 'CONTACT_HANDLED', AgentARN: 'g-1', EventTimestamp: '2026-09-15T10:00:00.000Z', Team: 'Billing team', Name: 'Priya N', Source: 'ingest', ContactId: 'c-1', HandleTime: 313, Queue: 'Billing', Escalated: true, DedupKey: 'CT#c-1' });
  const e = normalize({ type: 'EVALUATION_SUBMITTED', agent: 'g-1', evaluationId: 'e-9', score: 92.4 });
  assert.equal(e.Score, 92); assert.equal(e.DedupKey, 'EVAL#e-9'); assert.ok(e.EventTimestamp);
  assert.equal(normalize({ type: 'EVALUATION_SUBMITTED', agent: 'g-1', evaluationId: 'e-8', autoFail: true }).Reason, 'policy');
  assert.equal(normalize({ type: 'SENTIMENT_SCORED', agent: 'g-1', contactId: 'c-2', sentiment: -1.26 }).Sentiment, -1.3);
  assert.equal(normalize({ type: 'CSAT_RECEIVED', agent: 'g-1', contactId: 'c-3', score: 9 }).Score, 4.6);
  const a = normalize({ type: 'ADHERENCE_SCORED', agent: 'g-1', day: '2026-09-15', adherence: 93.46, adherentHours: 7.42 });
  assert.equal(a.Adherence, 93.5); assert.equal(a.AdherentHours, 7.4); assert.equal(a.EventTimestamp, '2026-09-15T23:59:59.000Z'); assert.equal(a.DedupKey, 'ADH#2026-09-15#g-1');
  assert.equal(normalize({ type: 'AGENT_STATE_CHANGE', agent: 'g-1', state: 'Available' }).State, 'Available');
  assert.equal(normalizeCsat(85), 4.4); assert.equal(normalizeCsat(5), 5); assert.equal(normalizeCsat(NaN), null);
  assert.equal(TYPES.length, 6);
});

test('bad events say what is wrong', () => {
  assert.throws(() => normalize({ type: 'LOGIN', agent: 'x' }), /type must be one of/);
  assert.throws(() => normalize({ type: 'CONTACT_HANDLED' }), /agent is required/);
  assert.throws(() => normalize({ type: 'CONTACT_HANDLED', agent: 'x', handleTime: -1 }), /handleTime/);
  assert.throws(() => normalize({ type: 'CONTACT_HANDLED', agent: 'x', handleTime: 10, at: 'yesterday' }), /ISO 8601/);
  assert.throws(() => normalize({ type: 'EVALUATION_SUBMITTED', agent: 'x', evaluationId: 'e', score: 140 }), /0 to 100/);
  assert.throws(() => normalize({ type: 'SENTIMENT_SCORED', agent: 'x', sentiment: 1 }), /contactId/);
  assert.throws(() => normalize({ type: 'ADHERENCE_SCORED', agent: 'x', day: '15/09/2026', adherence: 90, adherentHours: 7 }), /YYYY-MM-DD/);
  assert.throws(() => normalize('nope'), /must be an object/);
});
