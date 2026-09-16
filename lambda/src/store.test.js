const assert = require('node:assert/strict');
const { test } = require('node:test');
const store = require('./store.js');

test('week key follows ISO weeks', () => {
  assert.equal(store.weekKey('2026-09-15T14:05:30.000Z'), '2026-W38');
  assert.equal(store.weekKey('2026-01-01T00:00:00.000Z'), '2026-W01');
  assert.equal(store.weekKey('2027-01-01T00:00:00.000Z'), '2026-W53');
});

test('a contact handled plans ledger, live and two period rows', () => {
  const ev = { EventType: 'CONTACT_HANDLED', AgentARN: 'arn:x/agent/p', EventTimestamp: '2026-09-15T14:05:30.000Z', HandleTime: 330, Team: 'Billing team', Username: 'priya', Escalated: true };
  const w = store.planWrites(ev, 12, 0);
  assert.equal(w.length, 4);
  assert.equal(w[0].op, 'put'); assert.equal(w[0].item.sk, 'EV#2026-09-15T14:05:30.000Z#CONTACT_HANDLED'); assert.equal(w[0].item.points, 12);
  assert.equal(w[1].key.sk, 'LIVE'); assert.equal(w[1].values[':g1'], 'TEAM#Billing team#LIVE');
  assert.equal(w[2].key.sk, 'DAY#2026-09-15'); assert.equal(w[2].values[':g1'], 'TEAM#Billing team#DAY#2026-09-15');
  assert.equal(w[2].values[':h'], 1); assert.equal(w[2].values[':aht'], 330); assert.equal(w[2].values[':esc'], 1);
  assert.equal(w[3].key.sk, 'WEEK#2026-W38');
});

test('a state change touches only ledger and live', () => {
  const ev = { EventType: 'AGENT_STATE_CHANGE', AgentARN: 'arn:x/agent/p', EventTimestamp: '2026-09-15T14:05:30.000Z', State: 'Break', Team: 'Billing team' };
  const w = store.planWrites(ev, 0, 0);
  assert.equal(w.length, 2);
  assert.match(w[1].expr, /agentState = :state/); assert.equal(w[1].values[':state'], 'Break');
});

test('an evaluation appends to the evals list; auto-fail appends 0', () => {
  const ev = { EventType: 'EVALUATION_SUBMITTED', AgentARN: 'a', EventTimestamp: '2026-09-15T14:05:30.000Z', Score: 91, Team: 't' };
  assert.deepEqual(store.planWrites(ev, 20, 0)[2].values[':ev'], [91]);
  const af = { EventType: 'EVALUATION_SUBMITTED', AgentARN: 'a', EventTimestamp: '2026-09-15T14:05:30.000Z', AutoFail: true, Team: 't' };
  const w = store.planWrites(af, -40, 0)[2];
  assert.deepEqual(w.values[':ev'], [0]); assert.equal(w.values[':af'], 1);
});

test('a kudos event also writes a team feed row', () => {
  const ev = { EventType: 'KUDOS', AgentARN: 'arn:x/agent/p', EventTimestamp: '2026-09-15T14:05:30.000Z', From: 'Marcus', Note: 'great save', Team: 'Billing team', ToName: 'Priya N' };
  const w = store.planWrites(ev, 8, 0);
  const feed = w.find((x) => x.op === 'put' && x.item.sk.startsWith('KD#'));
  assert.ok(feed); assert.equal(feed.item.pk, 'TEAMITEMS#Billing team'); assert.equal(feed.item.toName, 'Priya N'); assert.equal(feed.item.from, 'Marcus');
});

test('mergeTeam produces the engine agent shape', () => {
  const pk = 'AGENT#arn:x/agent/p';
  const agents = store.mergeTeam(
    [{ pk, username: 'priya', agentState: 'Available', lastEvent: '2026-09-15T14:05:30.000Z', team: 'Billing team' }],
    [{ pk, points: 118, handled: 4, ahtSum: 1200, evals: [92], autofails: 0, kudosReceived: 1 }],
    [{ pk, points: 900 }]);
  assert.equal(agents.length, 1);
  const a = agents[0];
  assert.equal(a.id, 'arn:x/agent/p'); assert.equal(a.name, 'priya'); assert.equal(a.today, 118); assert.equal(a.week, 900);
  assert.equal(a.state, 'Available'); assert.deepEqual(a.evals, [92]); assert.equal(a.lastEvent, Date.parse('2026-09-15T14:05:30.000Z'));
});

test('mergeTeam fills defaults for an agent with only a week row', () => {
  const a = store.mergeTeam([], [], [{ pk: 'AGENT#arn:x/agent/q', points: 50, username: 'q' }])[0];
  assert.equal(a.today, 0); assert.equal(a.week, 50); assert.deepEqual(a.evals, []); assert.equal(a.state, 'Offline');
});
