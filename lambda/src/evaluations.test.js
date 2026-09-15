const assert = require('node:assert/strict');
const { test } = require('node:test');
const { translate, objects } = require('./evaluations.js');
const store = require('./store.js');
const Arena = require('./arena-engine.js');

const opts = { region: 'us-east-1', account: '123456789012' };
const doc = (over) => Object.assign({
  schemaVersion: '1.0', evaluationId: 'eval-1', contactId: 'c-1', instanceId: 'inst-1', agentId: 'user-priya',
  evaluationDefinitionTitle: 'Billing QA v3', evaluator: 'dana', evaluationSubmitTimestamp: '2026-09-15T15:00:00.000Z',
  evaluationFormTotalScore: { percentage: 91.7, notApplicable: false, automaticFail: false },
  sections: [{ sectionTitle: 'Compliance', questions: [{ questionTitle: 'Verified identity', score: { percentage: 100, automaticFail: false } }] }],
}, over);

test('a scored evaluation becomes EVALUATION_SUBMITTED with a rebuilt agent ARN', () => {
  const ev = translate(doc(), opts);
  assert.equal(ev.EventType, 'EVALUATION_SUBMITTED');
  assert.equal(ev.AgentARN, 'arn:aws:connect:us-east-1:123456789012:instance/inst-1/agent/user-priya');
  assert.equal(ev.Score, 92); assert.equal(ev.AutoFail, undefined); assert.equal(ev.DedupKey, 'EVAL#eval-1');
  assert.equal(ev.Form, 'Billing QA v3'); assert.equal(ev.EventTimestamp, '2026-09-15T15:00:00.000Z');
});

test('auto-fail scores 0, is flagged, and names the failed question', () => {
  const d = doc({ evaluationFormTotalScore: { percentage: 0, automaticFail: true } });
  d.sections[0].questions[0].score = { percentage: 0, automaticFail: true };
  const ev = translate(d, opts);
  assert.equal(ev.AutoFail, true); assert.equal(ev.Score, 0); assert.equal(ev.Reason, 'Verified identity');
  assert.equal(Arena.scoreEvent('EVALUATION_SUBMITTED', ev, Arena.DEFAULT_MIX), -40);
});

test('alternate total-score spelling and an ARN agentId are accepted', () => {
  const d = doc({ evaluationFormTotalScore: undefined, evaluationTotalScore: { percentage: 80 }, agentId: 'arn:aws:connect:x:y:instance/i/agent/a' });
  const ev = translate(d, opts);
  assert.equal(ev.Score, 80); assert.equal(ev.AgentARN, 'arn:aws:connect:x:y:instance/i/agent/a');
});

test('documents without a score or without ids are skipped', () => {
  assert.equal(translate(doc({ evaluationFormTotalScore: {} }), opts), null);
  assert.equal(translate(doc({ evaluationId: undefined }), opts), null);
});

test('the plan starts with a conditional SEEN marker so a resubmit cannot double score', () => {
  const ev = translate(doc(), opts);
  const w = store.planWrites(ev, 20, 0);
  assert.equal(w[0].op, 'put'); assert.equal(w[0].item.sk, 'SEEN#EVAL#eval-1'); assert.match(w[0].condition, /attribute_not_exists/);
  assert.equal(w.length, 5);
  assert.deepEqual(w[3].values[':ev'], [92]);
});

test('objects() reads EventBridge and S3 notification shapes', () => {
  assert.deepEqual(objects({ detail: { bucket: { name: 'b' }, object: { key: 'Evaluations/2026/09/15/x%20y.json' } } }), [{ bucket: 'b', key: 'Evaluations/2026/09/15/x y.json' }]);
  assert.deepEqual(objects({ Records: [{ s3: { bucket: { name: 'b' }, object: { key: 'Evaluations/a+b.json' } } }] }), [{ bucket: 'b', key: 'Evaluations/a b.json' }]);
  assert.deepEqual(objects({}), []);
});
