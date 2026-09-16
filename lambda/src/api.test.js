const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeHandler, route } = require('./api.js');

const fixed = () => new Date('2026-09-15T14:05:30.000Z');
function fakeStore() {
  const calls = [];
  const items = [];
  return { calls, items,
    listTeamItems: async (team, prefix, limit, newest) => items.filter((i) => i.pk === 'TEAMITEMS#' + team && i.sk.startsWith(prefix)).sort((a, b) => (newest ? -1 : 1) * a.sk.localeCompare(b.sk)),
    putTeamItem: async (team, sk, item) => { items.push(Object.assign({ pk: 'TEAMITEMS#' + team, sk }, item)); return item; },
    updateTeamItem: async (team, sk, fields) => { const i = items.find((x) => x.pk === 'TEAMITEMS#' + team && x.sk === sk); if (!i) return null; Object.assign(i, fields); return i; },
    spendPoints: async (arn, iso, cost) => { calls.push(['spendPoints', arn, cost]); },
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
  assert.equal(writes[0].item.From, 'Marcus'); assert.equal(writes[0].item.AgentARN, 'a2'); assert.equal(writes.length, 5, 'ledger, live, team feed, day, week');
  assert.equal((await h(req('POST', '/kudos', { body: '{}' }))).statusCode, 400);
});

const agentTokFor = (method) => ({ requestContext: { http: { method }, authorizer: { jwt: { claims: { name: 'Priya', 'custom:agentArn': 'a1', 'cognito:groups': ['agents'] } } } } });
const agentTok = agentTokFor('POST');
const supTok = (method) => ({ requestContext: { http: { method }, authorizer: { jwt: { claims: { 'cognito:groups': ['supervisors'], name: 'Dana' } } } } });

test('challenges: supervisors create, everyone lists with computed progress', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  const denied = await h(Object.assign(req('POST', '/teams/t/challenges', { body: JSON.stringify({ template: 'esc' }) }), agentTok));
  assert.equal(denied.statusCode, 403);
  const made = await h(Object.assign(req('POST', '/teams/t/challenges', { body: JSON.stringify({ template: 'esc', target: '5%', endsAt: '2026-09-19' }) }), supTok('POST')));
  assert.equal(made.statusCode, 201); const c = JSON.parse(made.body).challenge;
  assert.equal(c.state, 'active'); assert.equal(c.target, 5); assert.equal(c.reward, 150); assert.equal(c.createdBy, 'Dana');
  const bad = await h(Object.assign(req('POST', '/teams/t/challenges', { body: JSON.stringify({ template: 'nope' }) }), supTok('POST')));
  assert.equal(bad.statusCode, 400);
  const list = JSON.parse((await h(req('GET', '/teams/t/challenges'))).body).challenges;
  assert.equal(list.length, 1); assert.equal(list[0].progress.label, '0.0% now'); assert.equal(list[0].progress.onTrack, true);
  const ended = await h(Object.assign(req('PUT', '/teams/t/challenges/' + c.id, { body: JSON.stringify({ state: 'ended' }) }), supTok('PUT')));
  assert.equal(JSON.parse(ended.body).challenge.state, 'ended');
});

test('rewards: agent requests from token identity, needs enough points, supervisor decides once', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  const poor = await h(Object.assign(req('POST', '/teams/t/rewards', { body: JSON.stringify({ catalogId: 'halfday' }) }), agentTok));
  assert.equal(poor.statusCode, 400); assert.match(JSON.parse(poor.body).error, /needs 5,000/);
  const ok = await h(Object.assign(req('POST', '/teams/t/rewards', { body: JSON.stringify({ catalogId: 'gift25', agentId: 'spoofed' }) }), Object.assign({}, agentTok)));
  assert.equal(ok.statusCode, 400, 'gift25 costs 2500 and a1 has 900 this week');
  s.getTeam = async () => [{ id: 'a1', name: 'priya', week: 3000, today: 0, handled: 0, evals: [], escalations: 0, kudosReceived: 0 }];
  const made = await h(Object.assign(req('POST', '/teams/t/rewards', { body: JSON.stringify({ catalogId: 'gift25', agentId: 'spoofed' }) }), agentTok));
  assert.equal(made.statusCode, 201); const rw = JSON.parse(made.body).reward;
  assert.equal(rw.agentId, 'a1', 'identity comes from the token, not the body'); assert.equal(rw.status, 'pending'); assert.equal(rw.cost, 2500);
  const pending = JSON.parse((await h(req('GET', '/teams/t/rewards', { queryStringParameters: { status: 'pending' } }))).body);
  assert.equal(pending.rewards.length, 1); assert.ok(pending.catalog.length >= 4);
  assert.equal((await h(Object.assign(req('PUT', '/teams/t/rewards/' + rw.id, { body: JSON.stringify({ status: 'approved' }) }), agentTokFor('PUT')))).statusCode, 403);
  const approved = await h(Object.assign(req('PUT', '/teams/t/rewards/' + rw.id, { body: JSON.stringify({ status: 'approved' }) }), supTok('PUT')));
  assert.equal(JSON.parse(approved.body).reward.status, 'approved'); assert.deepEqual(s.calls.find((c) => c[0] === 'spendPoints'), ['spendPoints', 'a1', 2500]);
  assert.equal((await h(Object.assign(req('PUT', '/teams/t/rewards/' + rw.id, { body: JSON.stringify({ status: 'declined' }) }), supTok('PUT')))).statusCode, 409);
});

test('kudos feed lists newest first', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  await s.putTeamItem('t', 'KD#2026-09-15T10:00:00Z#a', { at: '2026-09-15T10:00:00Z', from: 'x', to: 'a', note: 'one' });
  await s.putTeamItem('t', 'KD#2026-09-15T11:00:00Z#b', { at: '2026-09-15T11:00:00Z', from: 'y', to: 'b', note: 'two' });
  const feed = JSON.parse((await h(req('GET', '/teams/t/kudos', { queryStringParameters: { limit: '5' } }))).body).kudos;
  assert.equal(feed[0].note, 'two'); assert.equal(feed[1].note, 'one'); assert.equal(feed[0].pk, undefined);
});

test('kiosk: supervisor mints a link, the wallboard reads through it without a token, revoke kills it', async () => {
  const s = fakeStore(); const kiosks = {};
  s.putKiosk = async (t, team, f) => { kiosks[t] = Object.assign({ token: t, team }, f); };
  s.getKiosk = async (t) => kiosks[t] || null; s.listKiosks = async () => Object.values(kiosks); s.deleteKiosk = async (t) => { delete kiosks[t]; };
  const h = makeHandler({ store: s, now: fixed });
  assert.equal((await h(Object.assign(req('POST', '/teams/t/kiosk', { body: '{}' }), agentTok))).statusCode, 403);
  const made = await h(Object.assign(req('POST', '/teams/t/kiosk', { body: JSON.stringify({ label: 'Floor TV', days: 30 }) }), supTok('POST')));
  assert.equal(made.statusCode, 201); const k = JSON.parse(made.body).kiosk;
  assert.ok(k.token.length >= 30); assert.equal(k.expiresAt, '2026-10-15T14:05:30.000Z'); assert.equal(k.ttl, undefined);
  const agents = await h(req('GET', '/kiosk/' + k.token + '/agents'));
  assert.equal(agents.statusCode, 200); assert.equal(JSON.parse(agents.body).team, 't'); assert.equal(JSON.parse(agents.body).agents[0].name, 'priya');
  assert.equal((await h(req('GET', '/kiosk/' + k.token + '/challenges'))).statusCode, 200);
  assert.equal((await h(req('GET', '/kiosk/' + k.token + '/kudos'))).statusCode, 200);
  assert.equal((await h(req('GET', '/kiosk/nope/agents'))).statusCode, 401);
  assert.equal(JSON.parse((await h(Object.assign(req('GET', '/teams/t/kiosk'), supTok('GET')))).body).kiosks.length, 1);
  assert.equal((await h(Object.assign(req('DELETE', '/teams/t/kiosk/' + k.token), supTok('DELETE')))).statusCode, 200);
  assert.equal((await h(req('GET', '/kiosk/' + k.token + '/agents'))).statusCode, 401);
});

test('kiosk: an expired link is refused', async () => {
  const s = fakeStore(); s.getKiosk = async () => ({ token: 'old', team: 't', expiresAt: '2026-01-01T00:00:00.000Z' });
  const h = makeHandler({ store: s, now: fixed });
  assert.equal((await h(req('GET', '/kiosk/old/agents'))).statusCode, 401);
});

test('deleteAgent: supervisors only, reports rows removed', async () => {
  const s = fakeStore(); s.deleteAgent = async (arn) => { s.calls.push(['deleteAgent', arn]); return 7; };
  const h = makeHandler({ store: s, now: fixed });
  assert.equal((await h(Object.assign(req('DELETE', '/agents/arn%3Ax%2Fagent%2Fp'), agentTokFor('DELETE')))).statusCode, 403);
  const r = await h(Object.assign(req('DELETE', '/agents/arn%3Ax%2Fagent%2Fp'), supTok('DELETE')));
  assert.equal(r.statusCode, 200); assert.deepEqual(JSON.parse(r.body), { deleted: 7, agent: 'arn:x/agent/p' });
  assert.deepEqual(s.calls.find((c) => c[0] === 'deleteAgent'), ['deleteAgent', 'arn:x/agent/p']);
});

test('unknown route is 404, OPTIONS is 204', async () => {
  const h = makeHandler({ store: fakeStore(), now: fixed });
  assert.equal((await h(req('GET', '/nope'))).statusCode, 404);
  assert.equal((await h(req('OPTIONS', '/kudos'))).statusCode, 204);
});
