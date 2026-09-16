const assert = require('node:assert/strict');
const { test } = require('node:test');
const Auth = require('./arena-auth.js');
const Arena = require('./arena-engine.js');

const jwt = (claims) => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';

test('parseJwt decodes claims and tolerates junk', () => {
  const c = Auth.parseJwt(jwt({ sub: 'u1', 'custom:agentArn': 'arn:x/agent/p', 'cognito:groups': ['supervisors'] }));
  assert.equal(c.sub, 'u1'); assert.equal(c['custom:agentArn'], 'arn:x/agent/p');
  assert.equal(Auth.parseJwt('not-a-token'), null);
});

test('isSupervisor reads the groups claim in array or string form', () => {
  assert.equal(Auth.isSupervisor({ 'cognito:groups': ['agents', 'supervisors'] }), true);
  assert.equal(Auth.isSupervisor({ 'cognito:groups': 'supervisors' }), true);
  assert.equal(Auth.isSupervisor({ 'cognito:groups': ['agents'] }), false);
  assert.equal(Auth.isSupervisor(null), false);
});

test('connect takes agent and team from token claims when signed in', async () => {
  const claims = { 'custom:agentArn': 'arn:x/agent/p', 'custom:team': 'Billing team', 'cognito:groups': ['agents'] };
  const fakeAuth = { enabled: () => true, claims: () => claims, token: async () => 'tok', ready: async () => 'tok', isSupervisor: Auth.isSupervisor };
  const conn = Arena.connect('', { api: '/api', auth: { domain: 'https://x', clientId: 'c' } }, fakeAuth);
  assert.equal(conn.signedIn, true); assert.equal(conn.agentId, 'arn:x/agent/p'); assert.equal(conn.isSupervisor, false);
  const override = Arena.connect('?agent=a9&team=Support', { api: '/api', auth: { domain: 'https://x', clientId: 'c' } }, fakeAuth);
  assert.equal(override.agentId, 'a9');
});

test('connect with a kiosk token skips sign-in and is read-only', () => {
  const fakeAuth = { enabled: () => true, claims: () => ({}), token: async () => 't', ready: async () => 't', isSupervisor: () => true };
  const conn = Arena.connect('?kiosk=abc', { api: '/api', auth: { domain: 'https://x', clientId: 'c' } }, fakeAuth);
  assert.equal(conn.kiosk, true); assert.equal(conn.signedIn, false); assert.equal(conn.isSupervisor, false); assert.equal(conn.engine.kiosk, true);
});

test('connect without auth config is not signed in and treats everyone as supervisor', () => {
  const conn = Arena.connect('', { api: '/api' }, { enabled: () => false });
  assert.equal(conn.signedIn, false); assert.equal(conn.isSupervisor, true); assert.equal(conn.agentId, null);
});
