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

test('a handled contact with an id leaves a marker so later analysis can find the agent', () => {
  const ev = { EventType: 'CONTACT_HANDLED', AgentARN: 'arn:x/agent/p', EventTimestamp: '2026-09-15T14:05:30.000Z', ContactId: 'c-1', HandleTime: 200, Team: 'Billing team', Username: 'priya', Name: 'Priya N' };
  const w = store.planWrites(ev, 12, 1000000);
  const marker = w[w.length - 1];
  assert.equal(marker.op, 'put'); assert.equal(marker.item.pk, 'CONTACT#c-1'); assert.equal(marker.item.sk, 'AGENT');
  assert.equal(marker.item.agent, 'arn:x/agent/p'); assert.equal(marker.item.team, 'Billing team'); assert.equal(marker.item.ttl, 1000 + 14 * 86400);
});

test('sentiment and survey events add to their own sums and never to contacts', () => {
  const sent = store.planWrites({ EventType: 'SENTIMENT_SCORED', AgentARN: 'a', EventTimestamp: '2026-09-15T14:05:30.000Z', Sentiment: -2.5, Team: 't', DedupKey: 'SENT#c-1' }, 0, 0);
  assert.equal(sent[0].item.sk, 'SEEN#SENT#c-1'); assert.equal(sent[0].condition, 'attribute_not_exists(pk)');
  const day = sent.find((x) => x.op === 'update' && x.key.sk === 'DAY#2026-09-15');
  assert.ok(day, 'a zero-point sentiment still lands on the day row');
  assert.equal(day.values[':ss'], -2.5); assert.equal(day.values[':sc'], 1); assert.equal(day.values[':h'], 0); assert.equal(day.values[':cc'], 0);
  assert.match(day.expr, /sentSum :ss, sentCount :sc, csatSum :cs, csatCount :cc/);
  const csat = store.planWrites({ EventType: 'CSAT_RECEIVED', AgentARN: 'a', EventTimestamp: '2026-09-15T14:05:30.000Z', Score: 4, Team: 't' }, 6, 0);
  const cday = csat.find((x) => x.op === 'update' && x.key.sk === 'DAY#2026-09-15');
  assert.equal(cday.values[':cs'], 4); assert.equal(cday.values[':cc'], 1); assert.equal(cday.values[':sc'], 0);
});

test('mergeTeam carries sentiment and survey sums into the agent shape', () => {
  const pk = 'AGENT#arn:x/agent/p';
  const a = store.mergeTeam([{ pk, username: 'priya' }], [{ pk, points: 10, sentSum: 4.5, sentCount: 3, csatSum: 9, csatCount: 2 }], [])[0];
  assert.equal(a.sentSum, 4.5); assert.equal(a.sentCount, 3); assert.equal(a.csatSum, 9); assert.equal(a.csatCount, 2);
  const b = store.mergeTeam([{ pk, username: 'priya' }], [{ pk, points: 10 }], [])[0];
  assert.equal(b.sentCount, 0); assert.equal(b.csatSum, 0);
});

test('an adherence day adds hours and the percentage to the day and week rows', () => {
  const ev = { EventType: 'ADHERENCE_SCORED', AgentARN: 'arn:a', EventTimestamp: '2026-09-15T23:59:59.000Z', Team: 'Billing', Adherence: 93.5, AdherentHours: 7.4, ScheduledHours: 8, DedupKey: 'ADH#2026-09-15#a' };
  const w = store.planWrites(ev, 37, 0);
  assert.equal(w[0].item.sk, 'SEEN#ADH#2026-09-15#a');
  const day = w.find((x) => x.key && x.key.sk === 'DAY#2026-09-15');
  assert.ok(day); assert.equal(day.values[':ah'], 7.4); assert.equal(day.values[':as'], 93.5); assert.equal(day.values[':ac'], 1); assert.equal(day.values[':p'], 37);
  assert.match(day.expr, /adherenceHours :ah, adhSum :as, adhCount :ac/);
  // Other events leave the adherence columns at zero.
  const c = store.planWrites({ EventType: 'CONTACT_HANDLED', AgentARN: 'arn:a', EventTimestamp: '2026-09-15T10:00:00.000Z', HandleTime: 300 }, 9, 0).find((x) => x.key && x.key.sk === 'DAY#2026-09-15');
  assert.equal(c.values[':ah'], 0); assert.equal(c.values[':ac'], 0);
  const merged = store.mergeTeam([], [{ pk: 'AGENT#arn:a', points: 37, adherenceHours: 7.4, adhSum: 93.5, adhCount: 1 }], []);
  assert.equal(merged[0].adherenceHours, 7.4); assert.equal(merged[0].adhSum, 93.5);
});

test('a backfilled day carries its contacts, handle time and evaluation scores into the day row', () => {
  const ev = { EventType: 'BACKFILL_DAY', AgentARN: 'arn:a', EventTimestamp: '2026-09-14T23:59:59.000Z', Team: 'Billing', Handled: 10, AhtSum: 3000, Evaluations: 2, EvalScore: 90, DedupKey: 'BF#2026-09-14#a' };
  const day = store.planWrites(ev, 150, 0).find((x) => x.key && x.key.sk === 'DAY#2026-09-14');
  assert.equal(day.values[':h'], 10); assert.equal(day.values[':aht'], 3000); assert.deepEqual(day.values[':ev'], [90, 90]); assert.equal(day.values[':p'], 150);
  const none = store.planWrites(Object.assign({}, ev, { Evaluations: 0, EvalScore: null }), 100, 0).find((x) => x.key && x.key.sk === 'DAY#2026-09-14');
  assert.equal(none.values[':ev'], undefined);
});
