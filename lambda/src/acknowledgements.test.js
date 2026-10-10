const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runFor, toEvent, instanceOf } = require('./acknowledgements.js');

const ARN = 'arn:aws:connect:us-east-1:111122223333:instance/inst-1/agent/p1';
const NOW = Date.parse('2026-09-16T10:20:00.000Z');
const pending = (id, submittedAt) => ({ evaluationId: id, agent: ARN, team: 'Billing', username: 'priya', name: 'Priya N', contactId: 'c-' + id, score: 92, submittedAt: submittedAt || '2026-09-15T14:00:00.000Z' });

test('instance comes from the agent ARN; an acknowledged evaluation becomes one deduped event', () => {
  assert.deepEqual(instanceOf(ARN), { region: 'us-east-1', instanceId: 'inst-1' });
  assert.equal(instanceOf('agent-3'), null);
  assert.equal(toEvent(pending('e1'), { Evaluation: {} }), null);
  const ev = toEvent(pending('e1'), { Evaluation: { Acknowledgement: { AcknowledgedTime: new Date('2026-09-16T09:00:00.000Z'), AcknowledgedBy: 'p1' } } });
  assert.equal(ev.EventType, 'EVALUATION_ACKNOWLEDGED'); assert.equal(ev.EventTimestamp, '2026-09-16T09:00:00.000Z'); assert.equal(ev.DedupKey, 'ACK#e1'); assert.equal(ev.Score, 92); assert.equal(ev.Team, 'Billing');
});

test('the job pays acknowledged ones, keeps the rest pending, and drops old or deleted evaluations', async () => {
  const acks = [pending('e1'), pending('e2'), pending('e3', '2026-08-01T00:00:00.000Z'), pending('e4')];
  const applied = [], deleted = [];
  const s = { listAcks: async () => acks, deleteAck: async (id) => deleted.push(id), getMix: async () => null, apply: async (w) => { applied.push(w); return true; } };
  const answers = { e1: { Evaluation: { Acknowledgement: { AcknowledgedTime: new Date('2026-09-16T09:00:00.000Z') } } }, e2: { Evaluation: {} } };
  const connect = { DescribeContactEvaluationCommand: function (i) { this.input = i; }, client: { send: async (c) => { if (c.input.EvaluationId === 'e4') { const e = new Error('gone'); e.name = 'ResourceNotFoundException'; throw e; } return answers[c.input.EvaluationId]; } } };
  const r = await runFor(NOW, { store: s, connect });
  assert.deepEqual(r, { pending: 4, checked: 2, scored: 1, expired: 2, points: 5 });
  assert.deepEqual(deleted.sort(), ['e1', 'e3', 'e4']);
  const ev = applied[0].find((w) => w.item && w.item.sk && w.item.sk.startsWith('EV#')).item;
  assert.equal(ev.EventType, 'EVALUATION_ACKNOWLEDGED'); assert.equal(ev.points, 5);
  assert.ok(applied[0].find((w) => w.key && w.key.sk === 'DAY#2026-09-16'), 'lands on the day of the acknowledgement');
});
