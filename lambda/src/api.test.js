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
    getTeam: async (team, iso) => { calls.push(['getTeam', team, iso]); return [{ id: 'a1', name: 'priya', username: 'priya', today: 118, week: 900, handled: 4, ahtSum: 1200, evals: [92], autofails: 0, kudosReceived: 1, escalations: 0, streak: 0, adherenceHours: 0, state: 'Available', lastEvent: 1 },
      { id: 'a2', name: 'Marcus Bell', username: 'marcus', today: 50, week: 300, handled: 2, ahtSum: 600, evals: [], autofails: 0, kudosReceived: 0, escalations: 0, streak: 0, adherenceHours: 0, state: 'Available', lastEvent: 1 }]; },
    // Day rows for today match the live agents above, so period-based challenges measure the same thing the old today-only ones did.
    getTeamDays: async (team, dates) => { const out = {}; for (const d of dates) out[d] = d === '2026-09-15' ? [{ pk: 'AGENT#a1', username: 'priya', points: 118, handled: 4, ahtSum: 1200, evals: [92], kudosReceived: 1 }, { pk: 'AGENT#a2', username: 'marcus', points: 50, handled: 2, ahtSum: 600, evals: [] }] : []; return out; },
    getTeamLive: async () => [{ pk: 'AGENT#a1', displayName: 'priya', username: 'priya' }, { pk: 'AGENT#a2', displayName: 'Marcus Bell', username: 'marcus' }],
    notify: null, getNotify: async function () { return this.notify; }, putNotify: async function (team, cfg) { this.notify = cfg; calls.push(['putNotify', team]); },
    getDigestMark: async () => null, putDigestMark: async (team, day, ch) => { calls.push(['digestMark', team, day, ch]); }, listTeams: async () => ['t'],
    kudosCounts: {},
    bumpKudosCount: async function (sender, day, limit) { const k = sender + '#' + day; if ((this.kudosCounts[k] || 0) >= limit) return false; this.kudosCounts[k] = (this.kudosCounts[k] || 0) + 1; return true; },
    listEvents: async (arn, limit) => { calls.push(['listEvents', arn, limit]); return [{ EventType: 'KUDOS', EventTimestamp: 'x', points: 8, From: 'm', Note: 'n' }]; },
    mixes: {},
    getMix: async function (team) { return (team && this.mixes[team]) || this.mixes[''] || null; },
    getMixes: async function (team) { return { team: (team && this.mixes[team]) || null, default: this.mixes[''] || null }; },
    putMix: async function (m, team) { this.mixes[team || ''] = m; calls.push(['putMix', m, team]); },
    deleteMix: async function (team) { delete this.mixes[team]; calls.push(['deleteMix', team]); },
    live: {}, getLive: async function (arn) { return this.live[arn] || null; },
    putAgentPrefs: async function (arn, prefs) { if (!this.live[arn]) return false; this.live[arn].prefs = prefs; return true; },
    getAgentDays: async (arn, from, to) => [{ sk: 'DAY#2026-09-08', points: 300 }, { sk: 'DAY#2026-09-09', points: 120 }, { sk: 'DAY#2026-09-15', points: 118 }].filter((r) => r.sk.slice(4) >= from && r.sk.slice(4) <= to),
    budget: null, spend: {},
    getBudget: async function () { return this.budget; }, putBudget: async function (team, monthly) { this.budget = { monthly }; },
    getSpend: async function (team, month) { return this.spend[month] || { spent: 0, alerted: [] }; },
    addSpend: async function (team, month, cost) { const r = this.spend[month] || (this.spend[month] = { spent: 0, alerted: [] }); r.spent += cost; return r.spent; },
    markBudgetAlert: async function (team, month, pct) { (this.spend[month] || (this.spend[month] = { spent: 0, alerted: [] })).alerted.push(pct); },
    apply: async (w) => { calls.push(['apply', w]); },
  };
}
const req = (method, path, extra) => Object.assign({ rawPath: path, requestContext: { http: { method }, authorizer: { jwt: { claims: { 'cognito:groups': ['supervisors'], name: 'Dana' } } } } }, extra || {});
const anon = (method, path, extra) => Object.assign({ rawPath: path, requestContext: { http: { method } } }, extra || {});
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
  assert.equal(s.calls[0][2], '2026-09-01T12:00:00.000Z');
});

test('agent events are flattened and capped at 100', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  const r = await h(req('GET', '/agents/a1/events', { queryStringParameters: { limit: '500' } }));
  assert.equal(JSON.parse(r.body).events[0].from, 'm'); assert.equal(s.calls[0][2], 100);
});

test('mix: default when unset, validated on put, supervisors only', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  assert.equal(JSON.parse((await h(req('GET', '/config/mix'))).body).mix.quality, 50);
  const denied = await h(Object.assign(anon('PUT', '/config/mix', { body: JSON.stringify({ quality: 50, productivity: 35, adherence: 15 }) }), agentTokFor('PUT')));
  assert.equal(denied.statusCode, 403);
  const bad = await h(Object.assign(req('PUT', '/config/mix', { body: JSON.stringify({ quality: 50, productivity: 40, adherence: 15 }) }), sup));
  assert.equal(bad.statusCode, 400);
  const ok = await h(Object.assign(req('PUT', '/config/mix', { body: JSON.stringify({ quality: 30, productivity: 55, adherence: 15 }) }), sup));
  assert.equal(ok.statusCode, 200); assert.match(JSON.parse(ok.body).warning, /rushing/); assert.equal(s.calls[0][0], 'putMix');
});

test('kudos scores, stores and takes the sender from the token', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  const r = await h(Object.assign(anon('POST', '/kudos', { body: JSON.stringify({ to: 'a2', note: 'great save', from: 'spoofed', team: 'someone-elses-team' }) }), { requestContext: { http: { method: 'POST' }, authorizer: { jwt: { claims: { name: 'Marcus', sub: 'sub-m', 'custom:agentArn': 'a1', 'custom:team': 't' } } } } }));
  assert.equal(r.statusCode, 403, 'an agent cannot send kudos on another team');
  const ok = await h(Object.assign(anon('POST', '/kudos', { body: JSON.stringify({ to: 'a2', note: 'great save', from: 'spoofed' }) }), { requestContext: { http: { method: 'POST' }, authorizer: { jwt: { claims: { name: 'Marcus', sub: 'sub-m', 'custom:agentArn': 'a1', 'custom:team': 't' } } } } }));
  assert.equal(ok.statusCode, 201); assert.equal(JSON.parse(ok.body).points, 8);
  const writes = s.calls.find((c) => c[0] === 'apply')[1];
  assert.equal(writes[0].item.From, 'Marcus'); assert.equal(writes[0].item.FromId, 'sub-m'); assert.equal(writes[0].item.AgentARN, 'a2'); assert.equal(writes[0].item.Team, 't'); assert.equal(writes[0].item.ToName, 'Marcus Bell');
  assert.equal(writes.length, 5, 'ledger, live, team feed, day, week');
  assert.equal((await h(req('POST', '/kudos', { body: '{}' }))).statusCode, 400);
});

const agentTokFor = (method) => ({ requestContext: { http: { method }, authorizer: { jwt: { claims: { name: 'Priya', 'custom:agentArn': 'a1', 'custom:team': 't', 'cognito:groups': ['agents'] } } } } });
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

// ---------- history, coaching, metrics ----------
const supReq = (method, path, body, qs) => ({ rawPath: path, queryStringParameters: qs, body: body ? JSON.stringify(body) : undefined,
  requestContext: { http: { method }, authorizer: { jwt: { claims: { 'cognito:groups': ['supervisors'], name: 'Dana' } } } } });
const agentReq = (method, path, body, arn) => ({ rawPath: path, body: body ? JSON.stringify(body) : undefined,
  requestContext: { http: { method }, authorizer: { jwt: { claims: { 'cognito:groups': ['agents'], 'custom:agentArn': arn, 'custom:team': 't', name: 'Priya' } } } } });

function historyStore() {
  const s = fakeStore();
  const row = (id, over) => Object.assign({ pk: 'AGENT#' + id, username: id, points: 100, handled: 10, ahtSum: 3000, evals: [80] }, over);
  s.days = { '2026-09-15': [row('a1', { evals: [90], sentSum: 6, sentCount: 3 })], '2026-09-14': [row('a1', { evals: [88] })], '2026-09-08': [row('a1', { evals: [70] })], '2026-09-02': [row('a1', { evals: [72] })] };
  s.getTeamDays = async (team, dates) => { s.calls.push(['getTeamDays', team, dates]); const out = {}; for (const d of dates) out[d] = s.days[d] || []; return out; };
  s.getTeamLive = async () => [{ pk: 'AGENT#a1', displayName: 'Priya Natarajan', username: 'priya' }];
  s.getAgentDays = async (arn, from, to) => { s.calls.push(['getAgentDays', arn, from, to]); return Object.keys(s.days).filter((d) => d >= from && d <= to).flatMap((d) => s.days[d].filter((r) => r.pk === 'AGENT#' + arn)); };
  s.getLive = async (arn) => (arn === 'a1' ? { team: 'Billing team', username: 'priya' } : null);
  s.apply = async (w) => { s.calls.push(['apply', w]); return s.applyResult; };
  return s;
}

test('history is for supervisors and compares the period with the one before', async () => {
  const s = historyStore(); const h = makeHandler({ store: s, now: fixed });
  assert.equal((await h(agentReq('GET', '/teams/Billing%20team/history', null, 'a1'))).statusCode, 403);
  const r = await h(supReq('GET', '/teams/Billing%20team/history', null, { days: '7' }));
  assert.equal(r.statusCode, 200);
  const rep = JSON.parse(r.body).report;
  const dates = s.calls.find((c) => c[0] === 'getTeamDays')[2];
  assert.equal(dates.length, 14); assert.equal(dates[0], '2026-09-02'); assert.equal(dates[13], '2026-09-15');
  assert.equal(rep.period, 7); assert.equal(rep.from, '2026-09-09'); assert.equal(rep.to, '2026-09-15');
  assert.equal(rep.current.qa, 89); assert.equal(rep.previous.qa, 71); assert.equal(rep.change.qa, 18);
  assert.equal(rep.current.sentiment, 2); assert.equal(rep.agents[0].name, 'Priya Natarajan'); assert.equal(rep.series.length, 7);
});

test('history falls back to 30 days for an unsupported period', async () => {
  const s = historyStore(); const h = makeHandler({ store: s, now: fixed });
  await h(supReq('GET', '/teams/t/history', null, { days: '500' }));
  assert.equal(s.calls.find((c) => c[0] === 'getTeamDays')[2].length, 60);
});

test('coaching: a supervisor opens a plan with a 14-day baseline', async () => {
  const s = historyStore(); const h = makeHandler({ store: s, now: fixed });
  assert.equal((await h(agentReq('POST', '/teams/Billing%20team/coaching', { agentId: 'a1' }, 'a1'))).statusCode, 403);
  assert.equal((await h(supReq('POST', '/teams/Billing%20team/coaching', {}))).statusCode, 400);
  assert.equal((await h(supReq('POST', '/teams/Billing%20team/coaching', { agentId: 'ghost' }))).statusCode, 404);
  const r = await h(supReq('POST', '/teams/Billing%20team/coaching', { agentId: 'a1', reason: 'Auto-fail today', note: 'private', action: 'Use the checklist', dueAt: '2026-09-22' }));
  assert.equal(r.statusCode, 201);
  const c = JSON.parse(r.body).coaching;
  assert.equal(c.status, 'open'); assert.equal(c.agentName, 'priya'); assert.equal(c.createdBy, 'Dana'); assert.equal(c.dueAt, '2026-09-22');
  assert.deepEqual(s.calls.find((x) => x[0] === 'getAgentDays').slice(1), ['a1', '2026-09-02', '2026-09-15']);
  assert.equal(c.baseline.qa, 80); assert.equal(c.baseline.days, 4);
  assert.ok(s.items[0].sk.startsWith('CO#2026-09-15T14:05:30.000Z#'));
});

test('coaching: agents see only their own plans, without the private note; supervisors see all', async () => {
  const s = historyStore(); const h = makeHandler({ store: s, now: fixed });
  await h(supReq('POST', '/teams/t/coaching', { agentId: 'a1', note: 'private', action: 'Use the checklist' }));
  s.items.push({ pk: 'TEAMITEMS#t', sk: 'CO#2026-09-10T00:00:00.000Z#x2', id: 'x2', agentId: 'a2', agentName: 'Marcus', note: 'n', action: 'a', status: 'open', createdAt: '2026-09-10T00:00:00.000Z' });
  const mine = JSON.parse((await h(agentReq('GET', '/teams/t/coaching', null, 'a1'))).body).coaching;
  assert.equal(mine.length, 1); assert.equal(mine[0].agentId, 'a1'); assert.equal(mine[0].note, undefined); assert.equal(mine[0].action, 'Use the checklist');
  const noTeam = await h(Object.assign(anon('GET', '/teams/t/coaching'), { requestContext: { http: { method: 'GET' }, authorizer: { jwt: { claims: { 'cognito:groups': ['agents'], 'custom:team': 't', name: 'No Arn' } } } } }));
  assert.deepEqual(JSON.parse(noTeam.body).coaching, [], 'a team member with no agent identity sees nothing');
  assert.equal((await h(anon('GET', '/teams/t/coaching'))).statusCode, 403, 'no token, no team');
  const all = JSON.parse((await h(supReq('GET', '/teams/t/coaching'))).body).coaching;
  assert.equal(all.length, 2); assert.ok(all.some((c) => c.note === 'private'));
  const marcus = all.find((c) => c.agentId === 'a2');
  assert.ok(s.calls.some((x) => x[0] === 'getAgentDays' && x[1] === 'a2' && x[2] === '2026-09-11' && x[3] === '2026-09-15'), 'since starts the day after the plan opened');
  assert.equal(marcus.since, null, 'no rows since the plan opened');
});

test('coaching: the agent may acknowledge and nothing else; closing records the result', async () => {
  const s = historyStore(); const h = makeHandler({ store: s, now: fixed });
  s.items.push({ pk: 'TEAMITEMS#t', sk: 'CO#2026-09-07T00:00:00.000Z#x1', id: 'x1', agentId: 'a1', agentName: 'Priya', note: 'private', action: 'old', status: 'open', createdAt: '2026-09-07T00:00:00.000Z', baseline: { qa: 71 } });
  assert.equal((await h(agentReq('PUT', '/teams/t/coaching/x1', { acknowledged: true }, 'someone-else'))).statusCode, 403);
  const ack = JSON.parse((await h(agentReq('PUT', '/teams/t/coaching/x1', { acknowledged: true, action: 'rewritten by agent', status: 'done' }, 'a1'))).body).coaching;
  assert.equal(ack.acknowledgedAt, '2026-09-15T14:05:30.000Z'); assert.equal(ack.action, 'old'); assert.equal(ack.status, 'open'); assert.equal(ack.note, undefined);
  const done = JSON.parse((await h(supReq('PUT', '/teams/t/coaching/x1', { status: 'done', outcome: 'Back on track' }))).body).coaching;
  assert.equal(done.status, 'done'); assert.equal(done.closedBy, 'Dana'); assert.equal(done.outcome, 'Back on track');
  assert.equal(done.result.qa, 83, 'averages the days after the plan opened: 70, 88, 90');
  assert.equal(done.since.qa, 83); assert.equal(done.note, 'private');
  assert.equal((await h(supReq('PUT', '/teams/t/coaching/missing', { status: 'done' }))).statusCode, 404);
});

test('metrics: a supervisor records a survey score; duplicates and bad input are refused', async () => {
  const s = historyStore(); const h = makeHandler({ store: s, now: fixed });
  assert.equal((await h(agentReq('POST', '/teams/t/metrics', { agentId: 'a1', metric: 'csat', score: 5 }, 'a1'))).statusCode, 403);
  assert.equal((await h(supReq('POST', '/teams/t/metrics', { agentId: 'a1', metric: 'csat', score: 9 }))).statusCode, 400);
  assert.equal((await h(supReq('POST', '/teams/t/metrics', { agentId: 'a1', metric: 'nps', score: 9 }))).statusCode, 400);
  assert.equal((await h(supReq('POST', '/teams/t/metrics', { agentId: 'a1', metric: 'sentiment', score: '' }))).statusCode, 400);
  const r = await h(supReq('POST', '/teams/t/metrics', { agentId: 'a1', metric: 'csat', score: 5, contactId: 'c-1' }));
  assert.equal(r.statusCode, 201); assert.equal(JSON.parse(r.body).points, 10);
  const writes = s.calls.find((c) => c[0] === 'apply')[1];
  assert.equal(writes[0].item.sk, 'SEEN#CSAT#c-1');
  const ledger = writes.find((w) => w.op === 'put' && w.item.sk.startsWith('EV#'));
  assert.equal(ledger.item.Team, 'Billing team', 'team comes from the agent, not the URL'); assert.equal(ledger.item.Score, 5); assert.equal(ledger.item.RecordedBy, 'Dana');
  s.applyResult = false;
  const dup = await h(supReq('POST', '/teams/t/metrics', { agentId: 'a1', metric: 'csat', score: 5, contactId: 'c-1' }));
  assert.equal(dup.statusCode, 200); assert.equal(JSON.parse(dup.body).duplicate, true);
});

test('new routes resolve', () => {
  assert.equal(route('GET', '/teams/Billing%20team/history').name, 'history');
  assert.equal(route('PUT', '/teams/t/coaching/abc').id, 'abc');
  assert.equal(route('POST', '/teams/t/metrics').name, 'recordMetric');
  assert.equal(route('GET', '/kiosk/tok/coaching'), null, 'coaching is never served to a wallboard token');
});

// ---------- scoping, kudos limits, wallboard names ----------
const agentOn = (team, arn, method) => ({ requestContext: { http: { method }, authorizer: { jwt: { claims: { 'cognito:groups': ['agents'], 'custom:agentArn': arn, 'custom:team': team, name: 'Priya', sub: 'sub-' + arn } } } } });

test('agents read only their own team; supervisors read any team; no token reads nothing', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  for (const path of ['/teams/t/agents', '/teams/t/challenges', '/teams/t/rewards', '/teams/t/kudos', '/teams/t/coaching']) {
    assert.equal((await h(Object.assign(anon('GET', path), agentOn('t', 'a1', 'GET')))).statusCode, 200, path + ' own team');
    assert.equal((await h(Object.assign(anon('GET', path), agentOn('other', 'a1', 'GET')))).statusCode, 403, path + ' other team');
    assert.equal((await h(anon('GET', path))).statusCode, 403, path + ' without a team claim');
    assert.equal((await h(req('GET', path))).statusCode, 200, path + ' supervisor');
  }
  assert.equal((await h(Object.assign(anon('POST', '/teams/other/rewards', { body: JSON.stringify({ catalogId: 'gift25' }) }), agentOn('t', 'a1', 'POST')))).statusCode, 403);
});

test('an agent reads only their own ledger', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  assert.equal((await h(Object.assign(anon('GET', '/agents/a1/events'), agentOn('t', 'a1', 'GET')))).statusCode, 200);
  assert.equal((await h(Object.assign(anon('GET', '/agents/a2/events'), agentOn('t', 'a1', 'GET')))).statusCode, 403);
  assert.equal((await h(anon('GET', '/agents/a2/events'))).statusCode, 403);
  assert.equal((await h(req('GET', '/agents/a2/events'))).statusCode, 200, 'supervisors may review any ledger');
});

test('kudos: not to yourself, only to a teammate, and no more than the daily limit', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  const send = (to) => h(Object.assign(anon('POST', '/kudos', { body: JSON.stringify({ to, note: 'nice' }) }), agentOn('t', 'a1', 'POST')));
  assert.equal((await send('a1')).statusCode, 400, 'self');
  assert.equal((await send('ghost')).statusCode, 404, 'not on the team');
  for (let i = 0; i < 5; i++) assert.equal((await send('a2')).statusCode, 201, 'kudos ' + (i + 1));
  const sixth = await send('a2');
  assert.equal(sixth.statusCode, 429); assert.match(JSON.parse(sixth.body).error, /limit of 5/);
  assert.equal(s.calls.filter((c) => c[0] === 'apply').length, 5, 'the refused kudos was not stored');
  // a supervisor sending on a team they name is fine, but still not to the recipient as themselves
  assert.equal((await h(req('POST', '/kudos', { body: JSON.stringify({ to: 'a2', note: 'well done', team: 't' }) }))).statusCode, 201);
});

test('wallboards get shortened names and no usernames when DISPLAY_NAMES is set', async () => {
  process.env.DISPLAY_NAMES = 'first';
  delete require.cache[require.resolve('./api.js')];
  const api = require('./api.js');
  const s = fakeStore(); const h = api.makeHandler({ store: s, now: fixed });
  s.getKiosk = async (t) => (t === 'tok' ? { token: 'tok', team: 't', expiresAt: '2027-01-01T00:00:00Z' } : null);
  await s.putTeamItem('t', 'KD#2026-09-15T10:00:00Z#a', { at: '2026-09-15T10:00:00Z', from: 'Marcus Bell', to: 'a1', toName: 'Priya Natarajan', note: 'one' });
  const agents = JSON.parse((await h(anon('GET', '/kiosk/tok/agents'))).body).agents;
  assert.deepEqual(agents.map((a) => a.name), ['priya', 'Marcus B.']); assert.equal(agents[0].username, undefined);
  const feed = JSON.parse((await h(anon('GET', '/kiosk/tok/kudos'))).body).kudos;
  assert.equal(feed[0].from, 'Marcus B.'); assert.equal(feed[0].toName, 'Priya N.');
  const signedIn = JSON.parse((await h(req('GET', '/teams/t/agents'))).body).agents;
  assert.equal(signedIn[1].name, 'Marcus Bell', 'signed-in pages keep full names');
  process.env.DISPLAY_NAMES = 'initials';
  delete require.cache[require.resolve('./api.js')];
  const h2 = require('./api.js').makeHandler({ store: s, now: fixed });
  assert.deepEqual(JSON.parse((await h2(anon('GET', '/kiosk/tok/agents'))).body).agents.map((a) => a.name), ['P', 'MB']);
  delete process.env.DISPLAY_NAMES;
  delete require.cache[require.resolve('./api.js')];
});

// ---------- notifications, contest rules, head-to-head ----------
test('notifications: supervisors set channels, URLs come back masked, a test message goes to each channel', async () => {
  const s = fakeStore(); const sent = [];
  const h = makeHandler({ store: s, now: fixed, send: async (cfg, ev) => { sent.push([ev.kind, cfg.slackUrl, cfg.teamsUrl]); return ['slack']; } });
  assert.equal((await h(Object.assign(anon('GET', '/teams/t/notifications'), agentOn('t', 'a1', 'GET')))).statusCode, 403);
  const empty = JSON.parse((await h(req('GET', '/teams/t/notifications'))).body).notifications;
  assert.equal(empty.slackSet, false); assert.equal(empty.digestHour, 17); assert.equal(empty.events.kudos, true);
  assert.equal((await h(req('POST', '/teams/t/notifications/test', { body: '{}' }))).statusCode, 400, 'nothing configured yet');
  const bad = await h(req('PUT', '/teams/t/notifications', { body: JSON.stringify({ slackUrl: 'http://not-https' }) }));
  assert.equal(bad.statusCode, 400);
  const saved = JSON.parse((await h(req('PUT', '/teams/t/notifications', { body: JSON.stringify({ slackUrl: 'https://hooks.slack.com/services/T/B/abcdef', digestHour: 9, events: { rewards: false } }) }))).body).notifications;
  assert.equal(saved.slackSet, true); assert.equal(saved.slackUrl, '…abcdef'); assert.equal(saved.digestHour, 9); assert.equal(saved.events.rewards, false); assert.equal(saved.events.kudos, true);
  assert.equal(s.notify.slackUrl, 'https://hooks.slack.com/services/T/B/abcdef', 'the full URL is stored');
  const again = JSON.parse((await h(req('PUT', '/teams/t/notifications', { body: JSON.stringify({ slackUrl: '…abcdef', email: 'lead@example.com' }) }))).body).notifications;
  assert.equal(s.notify.slackUrl, 'https://hooks.slack.com/services/T/B/abcdef', 'sending the mask back keeps the URL'); assert.equal(again.email, 'lead@example.com');
  const t = await h(req('POST', '/teams/t/notifications/test', { body: '{}' }));
  assert.equal(t.statusCode, 200); assert.deepEqual(JSON.parse(t.body).sent, ['slack']); assert.equal(sent[0][0], 'test');
});

test('kudos and reward events reach the team channels; a dead webhook never fails the request', async () => {
  const s = fakeStore(); const sent = [];
  s.notify = { slackUrl: 'https://hooks.slack.com/x', events: { kudos: true, rewards: true, challenges: true, digest: true } };
  const h = makeHandler({ store: s, now: fixed, send: async (cfg, ev) => { sent.push(ev.kind); if (ev.kind === 'rewardRequested') throw new Error('boom'); return ['slack']; } });
  assert.equal((await h(Object.assign(anon('POST', '/kudos', { body: JSON.stringify({ to: 'a2', note: 'nice' }) }), agentOn('t', 'a1', 'POST')))).statusCode, 201);
  s.getTeam = async () => [{ id: 'a1', name: 'priya', week: 3000, today: 0, handled: 0, evals: [], escalations: 0, kudosReceived: 0 }];
  assert.equal((await h(Object.assign(req('POST', '/teams/t/rewards', { body: JSON.stringify({ catalogId: 'gift25' }) }), agentTok))).statusCode, 201, 'request succeeds although the webhook threw');
  assert.deepEqual(sent, ['kudos', 'rewardRequested']);
});

test('a race ranks agents over its period with qualifiers, tiers and anonymity; ending it freezes results and pays prizes', async () => {
  const s = fakeStore(); const sent = [];
  s.notify = { slackUrl: 'https://hooks.slack.com/x', events: { kudos: true, rewards: true, challenges: true, digest: true } };
  const h = makeHandler({ store: s, now: fixed, send: async (cfg, ev) => { sent.push(ev); return ['slack']; } });
  const bad = await h(req('POST', '/teams/t/challenges', { body: JSON.stringify({ template: 'race', metrics: [{ key: 'nope', weight: 1 }] }) }));
  assert.equal(bad.statusCode, 400);
  const made = await h(req('POST', '/teams/t/challenges', { body: JSON.stringify({ template: 'race', title: 'Points race', metrics: [{ key: 'points', weight: 2 }, { key: 'handled', weight: 1 }], minContacts: 3, tiers: [{ place: 1, reward: 100 }, { place: 2, reward: 40 }], anonymize: true, endsAt: '2026-09-19' }) }));
  assert.equal(made.statusCode, 201); const c = JSON.parse(made.body).challenge;
  assert.equal(c.minContacts, 3); assert.equal(c.anonymize, true); assert.equal(c.metrics.length, 2); assert.equal(sent[0].kind, 'challengeStarted');
  const sup = JSON.parse((await h(req('GET', '/teams/t/challenges'))).body).challenges[0];
  const rows = sup.progress.standings.rows;
  assert.equal(rows[0].name, 'priya'); assert.equal(rows[0].rank, 1); assert.equal(rows[0].prize, 100);
  const marcus = rows.find((r) => r.name === 'Marcus Bell');
  assert.equal(marcus.qualified, false, 'two contacts is under the minimum'); assert.equal(marcus.rank, undefined);
  assert.equal(sup.progress.label, 'priya leads on 100 pts · 1 ranked');
  const agentView = JSON.parse((await h(Object.assign(anon('GET', '/teams/t/challenges'), agentOn('t', 'a2', 'GET')))).body).challenges[0];
  assert.equal(agentView.progress.value, 'in progress', 'anonymised: no leader named');
  assert.equal(agentView.progress.standings.rows[0].name, undefined, 'anonymised: no names');
  assert.equal(agentView.progress.standings.rows.find((r) => r.you).qualified, false, 'but you can see your own row');
  // disqualify priya, then end: marcus is unqualified too, so nobody is paid
  const excluded = await h(req('PUT', '/teams/t/challenges/' + c.id, { body: JSON.stringify({ excluded: ['a1'] }) }));
  assert.equal(JSON.parse(excluded.body).challenge.progress.standings.rows.find((r) => r.name === 'priya').excluded, true);
  const reinstated = await h(req('PUT', '/teams/t/challenges/' + c.id, { body: JSON.stringify({ excluded: [] }) }));
  assert.equal(JSON.parse(reinstated.body).challenge.progress.standings.rows[0].rank, 1);
  const ended = JSON.parse((await h(req('PUT', '/teams/t/challenges/' + c.id, { body: JSON.stringify({ state: 'ended' }) }))).body).challenge;
  assert.equal(ended.state, 'ended'); assert.equal(ended.results.prizes.length, 1); assert.equal(ended.results.prizes[0].points, 100); assert.equal(ended.results.prizes[0].place, '1st place');
  const paid = s.calls.filter((x) => x[0] === 'apply').map((x) => x[1][1].item);
  assert.equal(paid.length, 1); assert.equal(paid[0].EventType, 'CHALLENGE_WON'); assert.equal(paid[0].points, 100); assert.equal(paid[0].AgentARN, 'a1');
  assert.equal(s.calls.filter((x) => x[0] === 'apply')[0][1][0].item.sk, 'SEEN#CHW#' + c.id + '#a1', 'paid once, ever');
  assert.equal(sent.pop().kind, 'challengeEnded');
  assert.equal((await h(req('PUT', '/teams/t/challenges/' + c.id, { body: JSON.stringify({ state: 'ended' }) }))).statusCode, 409, 'cannot end twice');
  const frozen = JSON.parse((await h(req('GET', '/teams/t/challenges'))).body).challenges[0];
  assert.equal(frozen.state, 'ended'); assert.equal(frozen.progress.frozen, true); assert.equal(frozen.progress.standings.rows[0].name, 'priya');
});

test('a head-to-head needs two agents on the team and names the leader', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  assert.equal((await h(req('POST', '/teams/t/challenges', { body: JSON.stringify({ template: 'duel', agents: ['a1'] }) }))).statusCode, 400);
  assert.equal((await h(req('POST', '/teams/t/challenges', { body: JSON.stringify({ template: 'duel', agents: ['a1', 'ghost'] }) }))).statusCode, 400);
  const made = await h(req('POST', '/teams/t/challenges', { body: JSON.stringify({ template: 'duel', title: 'Priya vs Marcus', agents: ['a1', 'a2'], metric: 'handled', reward: 60, endsAt: '2026-09-19' }) }));
  assert.equal(made.statusCode, 201);
  const c = JSON.parse((await h(req('GET', '/teams/t/challenges'))).body).challenges[0];
  assert.equal(c.progress.value, '4 vs 2'); assert.equal(c.progress.label, 'priya leads');
  assert.equal(c.progress.standings.rows[0].prize, 60, 'the flat reward goes to the winner');
});

test('team vs team compares this team with the opponent over the same period', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  const mine = s.getTeamDays;
  s.getTeamDays = async (team, dates) => { if (team !== 'Support') return mine(team, dates); const out = {}; for (const d of dates) out[d] = d === '2026-09-15' ? [{ pk: 'AGENT#b1', username: 'bob', points: 300, handled: 9, ahtSum: 2700, evals: [70] }] : []; return out; };
  assert.equal((await h(req('POST', '/teams/t/challenges', { body: JSON.stringify({ template: 'teams' }) }))).statusCode, 400, 'needs an opponent');
  const made = await h(req('POST', '/teams/t/challenges', { body: JSON.stringify({ template: 'teams', title: 'Billing vs Support', opponent: 'Support', metric: 'qa', endsAt: '2026-09-19' }) }));
  assert.equal(made.statusCode, 201);
  const c = JSON.parse((await h(req('GET', '/teams/t/challenges'))).body).challenges[0];
  assert.equal(c.progress.value, '92% vs 70%'); assert.equal(c.progress.label, 'ahead of Support'); assert.equal(c.progress.onTrack, true);
});

test('reward budget: a monthly cap blocks approvals past it and announces 25/50/75/100%', async () => {
  const s = fakeStore(); const sent = []; const h = makeHandler({ store: s, now: fixed, send: async (cfg, ev) => { sent.push(ev); return ['slack']; } });
  s.notify = { slackUrl: 'https://hooks.slack.com/x', events: { rewards: true } };
  const supReq = (method, path, body) => Object.assign(req(method, path), { body: JSON.stringify(body || {}) });
  // No cap by default; agents never see the budget.
  let r = await h(req('GET', '/teams/t/rewards'));
  assert.equal(JSON.parse(r.body).budget.capped, false);
  r = await h(Object.assign(anon('GET', '/teams/t/rewards'), { requestContext: { http: { method: 'GET' }, authorizer: { jwt: { claims: { 'custom:team': 't', 'custom:agentArn': 'a1' } } } } }));
  assert.equal(JSON.parse(r.body).budget, undefined);
  // Set a 5,000 pt cap for the month (fixed() is September 2026).
  r = await h(supReq('PUT', '/teams/t/budget', { monthly: 5000 }));
  assert.equal(r.statusCode, 200); assert.deepEqual(JSON.parse(r.body).budget, { month: '2026-09', monthly: 5000, spent: 0, remaining: 5000, pct: 0, capped: true, alerted: [] });
  assert.equal((await h(supReq('PUT', '/teams/t/budget', { monthly: -1 }))).statusCode, 400);
  // Two $25 cards (2,500 each) fit exactly and cross 50% then 100%; the third is refused.
  for (let i = 0; i < 3; i++) await s.putTeamItem('t', `RW#2026-09-15T10:0${i}:00.000Z#r${i}`, { id: 'r' + i, agentId: 'a1', agentName: 'priya', what: '$25 gift card', cost: 2500, status: 'pending' });
  r = await h(supReq('PUT', '/teams/t/rewards/r0', { status: 'approved' }));
  assert.equal(r.statusCode, 200); assert.equal(JSON.parse(r.body).budget.spent, 2500);
  assert.deepEqual(sent.filter((e) => e.kind === 'budgetAlert').map((e) => e.pct), [25, 50]);
  r = await h(supReq('PUT', '/teams/t/rewards/r1', { status: 'approved' }));
  assert.equal(r.statusCode, 200); assert.deepEqual(sent.filter((e) => e.kind === 'budgetAlert').map((e) => e.pct), [25, 50, 75, 100]);
  r = await h(supReq('PUT', '/teams/t/rewards/r2', { status: 'approved' }));
  assert.equal(r.statusCode, 409); assert.match(JSON.parse(r.body).error, /over its 5,000 pt reward budget/);
  assert.equal(s.items.find((i) => i.id === 'r2').status, 'pending', 'refused approval leaves the request pending');
  assert.equal(s.calls.filter((c) => c[0] === 'spendPoints').length, 2);
  // Declining never touches the budget; removing the cap lets the third one through.
  await s.putTeamItem('t', 'RW#2026-09-15T10:09:00.000Z#r9', { id: 'r9', agentId: 'a1', agentName: 'priya', what: 'Parking', cost: 1500, status: 'pending' });
  assert.equal((await h(supReq('PUT', '/teams/t/rewards/r9', { status: 'declined' }))).statusCode, 200);
  await h(supReq('PUT', '/teams/t/budget', { monthly: 0 }));
  r = await h(supReq('PUT', '/teams/t/rewards/r2', { status: 'approved' }));
  assert.equal(r.statusCode, 200); assert.equal(JSON.parse(r.body).budget.capped, false);
  assert.equal((await h(Object.assign(anon('GET', '/teams/t/budget'), { requestContext: { http: { method: 'GET' }, authorizer: { jwt: { claims: { 'custom:team': 't' } } } } }))).statusCode, 403);
});

test('a requested date is a local day in the stack time zone', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  const r = await h(Object.assign(req('GET', '/teams/t/agents'), { queryStringParameters: { date: '2026-09-14' } }));
  const b = JSON.parse(r.body);
  assert.equal(b.date, '2026-09-14'); assert.equal(b.week, '2026-W38'); assert.equal(b.timezone, 'UTC');
  assert.equal(s.calls[0][2], '2026-09-14T12:00:00.000Z');
});

test('scoring profiles: a team can have its own mix, otherwise the default applies; supervisors only', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  const supReq = (method, path, body, team) => Object.assign(req(method, path), { body: JSON.stringify(body || {}), queryStringParameters: team ? { team } : undefined });
  let b = JSON.parse((await h(supReq('GET', '/config/mix', null, 'Billing'))).body);
  assert.equal(b.source, 'default'); assert.deepEqual(b.mix, { quality: 50, productivity: 35, adherence: 15 });
  // Default for everyone, then a profile for Billing only.
  assert.equal((await h(supReq('PUT', '/config/mix', { quality: 60, productivity: 30, adherence: 10 }))).statusCode, 200);
  b = JSON.parse((await h(supReq('PUT', '/config/mix', { quality: 35, productivity: 50, adherence: 15 }, 'Billing'))).body);
  assert.equal(b.source, 'team'); assert.equal(b.mix.quality, 35); assert.equal(b.default.quality, 60); assert.match(b.warning, /rushing/);
  assert.equal(JSON.parse((await h(supReq('GET', '/config/mix', null, 'Sales'))).body).mix.quality, 60, 'other teams get the default');
  assert.equal(JSON.parse((await h(supReq('GET', '/config/mix', null, 'Billing'))).body).mix.quality, 35);
  // An agent may read their own team's mix, not another's, and may not write.
  const agent = (team, method, path) => Object.assign(anon(method, path), { queryStringParameters: { team }, requestContext: { http: { method }, authorizer: { jwt: { claims: { 'custom:team': 'Billing' } } } } });
  assert.equal((await h(agent('Billing', 'GET', '/config/mix'))).statusCode, 200);
  assert.equal((await h(agent('Sales', 'GET', '/config/mix'))).statusCode, 403);
  assert.equal((await h(Object.assign(agent('Billing', 'PUT', '/config/mix'), { body: '{"quality":50,"productivity":35,"adherence":15}' }))).statusCode, 403);
  // Back to the default.
  b = JSON.parse((await h(supReq('PUT', '/config/mix', { useDefault: true }, 'Billing'))).body);
  assert.equal(b.source, 'default'); assert.equal(b.mix.quality, 60); assert.ok(s.calls.some((c) => c[0] === 'deleteMix' && c[1] === 'Billing'));
  assert.equal((await h(supReq('PUT', '/config/mix', { quality: 50, productivity: 40, adherence: 15 }, 'Billing'))).statusCode, 400, 'must add to 100');
});

test('personal best: an agent reads their own record and switches their panel; others may not', async () => {
  const s = fakeStore(); const h = makeHandler({ store: s, now: fixed });
  s.live.a1 = { pk: 'AGENT#a1', team: 't' };
  const me = (method, path, body) => Object.assign(anon(method, path), { body: body ? JSON.stringify(body) : undefined, requestContext: { http: { method }, authorizer: { jwt: { claims: { 'custom:team': 't', 'custom:agentArn': 'a1' } } } } });
  let r = await h(me('GET', '/agents/a1/best'));
  assert.equal(r.statusCode, 200);
  const b = JSON.parse(r.body);
  assert.equal(b.today, '2026-09-15'); assert.deepEqual(b.bestDay, { day: '2026-09-08', points: 300 }); assert.equal(b.todayPoints, 118); assert.equal(b.dayPct, 39);
  assert.equal(b.bestWeek.week, '2026-W37'); assert.equal(b.bestWeek.points, 420); assert.equal(b.weekPoints, 118); assert.equal(b.avgDay, 210); assert.equal(b.activeDays, 3);
  assert.equal((await h(me('GET', '/agents/a2/best'))).statusCode, 403);
  assert.equal(JSON.parse((await h(me('GET', '/agents/a1/prefs'))).body).prefs.personalBest, false);
  r = await h(me('PUT', '/agents/a1/prefs', { personalBest: true }));
  assert.equal(r.statusCode, 200); assert.equal(JSON.parse(r.body).prefs.personalBest, true); assert.equal(s.live.a1.prefs.personalBest, true);
  assert.equal((await h(me('PUT', '/agents/a2/prefs', { personalBest: true }))).statusCode, 403);
  assert.equal((await h(Object.assign(req('PUT', '/agents/a9/prefs'), { body: '{"personalBest":true}' }))).statusCode, 404, 'unknown agent');
  assert.equal((await h(req('GET', '/agents/a1/best'))).statusCode, 200, 'supervisors may look');
});
