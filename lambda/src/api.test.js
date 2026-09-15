const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeHandler, route } = require('./api.js');

const fixed = () => new Date('2026-09-15T14:05:30.000Z');
function fakeStore() {
  const calls = [];
  return { calls,
    getTeam: async (team, iso) => { calls.push(['getTeam', team, iso]); return [{ id: 'a1', name: 'priya', today: 118, week: 900, handled: 4, ahtSum: 1200, evals: [92], autofails: 0, kudosReceived: 1, escalations: 0, streak: 0, adherenceHours: 0, state: 'Available', lastEvent: 1 }]; },
    listEvents: async (arn, limit) => { calls.push(['listEvents', arn, limit]); return [{ EventType: 'KUDOS', EventTimestamp: 'x', points: 8, From: 'm', Note: 'n' }]; },
    getMix: async () => null,
    putMix: async (m) => { calls.push(['putMix', m]); },
    apply: async (w) => { calls.push(['apply', w]); },
  };
}
const req = (method, path, extra) => Object.assign({ rawPath: path, requestContext: { http: { method } } }, extra || {});
const sup = { requestContext: { http: { method: 'PUT' }, authorizer: { jwt: { claims: { 'cognito:groups': ['supervisors'], name: 'Dana' } } } } };

test('routes', () => {
  assert.equal(route('GET', '/teams/Billing%20team/agents').team, 'Billing team');
  assert.equal(route('GET', '/agents/arn%3Aaws%3Aconnect%3Ax%2Fagent%2Fp/events').arn, 'arn:aws:connect:x/agent/p');
  assert.equal(route('DELETE', '/config/mix'), null);
});

test('team agents returns engine-shaped agents with date and week', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  const r = await h(req('GET', '/teams/Billing%20team/agents'));
  assert.equal(r.statusCode, 200);
  const b = JSON.parse(r.body);
  assert.equal(b.date, '2026-09-15'); assert.equal(b.week, '2026-W38'); assert.equal(b.agents[0].name, 'priya');
  assert.deepEqual(s.calls[0], ['getTeam', 'Billing team', '2026-09-15T14:05:30.000Z']);
});

test('date query pins the day', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  await h(req('GET', '/teams/t/agents', { queryStringParameters: { date: '2026-09-01' } }));
  assert.equal(s.calls[0][2], '2026-09-01T00:00:00.000Z');
});

test('agent events are flattened and capped at 100', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  const r = await h(req('GET', '/agents/a1/events', { queryStringParameters: { limit: '500' } }));
  assert.equal(JSON.parse(r.body).events[0].from, 'm'); assert.equal(s.calls[0][2], 100);
});

test('mix: default when unset, validated on put, supervisors only', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  assert.equal(JSON.parse((await h(req('GET', '/config/mix'))).body).mix.quality, 50);
  const denied = await h(req('PUT', '/config/mix', { body: JSON.stringify({ quality: 50, productivity: 35, adherence: 15 }) }));
  assert.equal(denied.statusCode, 403);
  const bad = await h(Object.assign(req('PUT', '/config/mix', { body: JSON.stringify({ quality: 50, productivity: 40, adherence: 15 }) }), sup));
  assert.equal(bad.statusCode, 400);
  const ok = await h(Object.assign(req('PUT', '/config/mix', { body: JSON.stringify({ quality: 30, productivity: 55, adherence: 15 }) }), sup));
  assert.equal(ok.statusCode, 200); assert.match(JSON.parse(ok.body).warning, /rushing/); assert.equal(s.calls[0][0], 'putMix');
});

test('kudos scores, stores and takes the sender from the token', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  const r = await h(Object.assign(req('POST', '/kudos', { body: JSON.stringify({ to: 'a2', note: 'great save', from: 'spoofed', team: 't' }) }), { requestContext: { http: { method: 'POST' }, authorizer: { jwt: { claims: { name: 'Marcus' } } } } }));
  assert.equal(r.statusCode, 201); assert.equal(JSON.parse(r.body).points, 8);
  const writes = s.calls[0][1];
  assert.equal(writes[0].item.From, 'Marcus'); assert.equal(writes[0].item.AgentARN, 'a2'); assert.equal(writes.length, 4);
  assert.equal((await h(req('POST', '/kudos', { body: '{}' }))).statusCode, 400);
});

test('unknown route is 404, OPTIONS is 204', async () => {
  const h = makeHandler({ store: fakeStore(), now: fixed });
  assert.equal((await h(req('GET', '/nope'))).statusCode, 404);
  assert.equal((await h(req('OPTIONS', '/kudos'))).statusCode, 204);
});
