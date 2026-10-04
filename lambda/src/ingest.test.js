// Exercises the pure translate() step against a record shaped like the real agent event stream.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { translate, decode } = require('./ingest.js');

const ARN = 'arn:aws:connect:us-east-1:123456789012:instance/abc/agent/priya';
const base = (over) => Object.assign({
  AWSAccountId: '123456789012', AgentARN: ARN, Version: '2017-10-01', EventId: 'e1',
  EventTimestamp: '2026-09-15T14:05:30.000Z', EventType: 'STATE_CHANGE',
  CurrentAgentSnapshot: { AgentStatus: { Name: 'Available', Type: 'ROUTABLE' }, Contacts: [],
    Configuration: { Username: 'priya', FirstName: 'Priya', LastName: 'Natarajan', RoutingProfile: { Name: 'Billing team' } } },
  PreviousAgentSnapshot: { AgentStatus: { Name: 'Break', Type: 'CUSTOM' }, Contacts: [] },
}, over);

test('state change emits AGENT_STATE_CHANGE with team and username', () => {
  const out = translate(base());
  assert.equal(out.length, 1);
  assert.equal(out[0].EventType, 'AGENT_STATE_CHANGE');
  assert.equal(out[0].State, 'Available'); assert.equal(out[0].Team, 'Billing team'); assert.equal(out[0].Username, 'priya'); assert.equal(out[0].Name, 'Priya Natarajan');
});

test('same status in both snapshots emits nothing', () => {
  const r = base(); r.PreviousAgentSnapshot.AgentStatus.Name = 'Available';
  assert.deepEqual(translate(r), []);
});

test('logout maps to Offline', () => {
  const out = translate(base({ EventType: 'LOGOUT' }));
  assert.equal(out[0].State, 'Offline');
});

test('contact flipping to ENDED emits CONTACT_HANDLED with handle time', () => {
  const contact = { ContactId: 'c1', Channel: 'VOICE', State: 'CONNECTED', Queue: { Name: 'Billing' },
    ConnectedToAgentTimestamp: '2026-09-15T14:00:00.000Z' };
  const r = base();
  r.PreviousAgentSnapshot.AgentStatus.Name = 'Available';
  r.PreviousAgentSnapshot.Contacts = [contact];
  r.CurrentAgentSnapshot.Contacts = [Object.assign({}, contact, { State: 'ENDED' })];
  const out = translate(r);
  assert.equal(out.length, 1);
  assert.equal(out[0].EventType, 'CONTACT_HANDLED');
  assert.equal(out[0].HandleTime, 330); assert.equal(out[0].Queue, 'Billing'); assert.equal(out[0].ContactId, 'c1');
});

test('a contact already ENDED is not counted twice', () => {
  const ended = { ContactId: 'c1', State: 'ENDED', ConnectedToAgentTimestamp: '2026-09-15T14:00:00.000Z' };
  const r = base();
  r.PreviousAgentSnapshot.AgentStatus.Name = 'Available';
  r.PreviousAgentSnapshot.Contacts = [ended]; r.CurrentAgentSnapshot.Contacts = [ended];
  assert.deepEqual(translate(r), []);
});

test('decode reads a base64 Kinesis record', () => {
  const raw = base();
  const rec = { kinesis: { data: Buffer.from(JSON.stringify(raw)).toString('base64') } };
  assert.equal(decode(rec).AgentARN, ARN);
});

const { translateContactRecord, normalizeCsat, isContactRecord } = require('./ingest.js');

const ctr = (over) => Object.assign({
  AWSContactTraceRecordFormatVersion: '2017-03-10', ContactId: 'c-9', Channel: 'VOICE', DisconnectTimestamp: '2026-09-15T14:09:00Z',
  Agent: { ARN: ARN, Username: 'priya', RoutingProfile: { Name: 'Billing team' } }, Queue: { Name: 'Billing' }, Attributes: { csat: '4' },
}, over);

test('a contact record with the survey attribute becomes a CSAT event for its agent', () => {
  assert.equal(isContactRecord(ctr()), true); assert.equal(isContactRecord(base()), false);
  const out = translateContactRecord(ctr(), 'csat');
  assert.equal(out.length, 1);
  assert.equal(out[0].EventType, 'CSAT_RECEIVED'); assert.equal(out[0].AgentARN, ARN); assert.equal(out[0].Score, 4);
  assert.equal(out[0].Team, 'Billing team'); assert.equal(out[0].DedupKey, 'CSAT#c-9'); assert.equal(out[0].EventTimestamp, '2026-09-15T14:09:00Z');
});

test('contact records without a score, or without an agent, are ignored', () => {
  assert.deepEqual(translateContactRecord(ctr({ Attributes: {} }), 'csat'), []);
  assert.deepEqual(translateContactRecord(ctr({ Attributes: { csat: 'n/a' } }), 'csat'), []);
  assert.deepEqual(translateContactRecord(ctr({ Agent: null }), 'csat'), []);
  assert.equal(translateContactRecord(ctr({ Attributes: { survey_score: '5' } }), 'survey_score')[0].Score, 5);
});

test('survey scores on other scales are brought to 1-5', () => {
  assert.equal(normalizeCsat('5'), 5); assert.equal(normalizeCsat(3.5), 3.5);
  assert.equal(normalizeCsat('9'), 4.5); assert.equal(normalizeCsat(10), 5);
  assert.equal(normalizeCsat('80'), 4); assert.equal(normalizeCsat(0), 1);
  assert.equal(normalizeCsat(''), null); assert.equal(normalizeCsat(-1), null);
});
