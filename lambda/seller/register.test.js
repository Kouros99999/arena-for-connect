const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.RELEASE_BASE = 'https://rel.example/arena/0.2.0'; process.env.CUSTOMERS_TABLE = 'customers';
const { handler, launchUrl, tokenFrom } = require('./register.js');
const { parseRecord } = require('./notify.js');

test('launchUrl carries customer id, product code, template and site archive', () => {
  const full = launchUrl('cust-1', 'prod-1', { releaseBase: 'https://rel.example/arena/0.2.0', region: 'us-east-1' });
  assert.ok(full.startsWith('https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?'));
  const q = new URLSearchParams(full.slice(full.lastIndexOf('?') + 1));
  assert.equal(q.get('templateURL'), 'https://rel.example/arena/0.2.0/template.yaml');
  assert.equal(q.get('param_MarketplaceCustomerId'), 'cust-1'); assert.equal(q.get('param_MarketplaceProductCode'), 'prod-1');
  assert.equal(q.get('param_SiteArchiveUrl'), 'https://rel.example/arena/0.2.0/site.zip'); assert.equal(q.get('stackName'), 'arena');
});

test('tokenFrom reads plain and base64 form bodies', () => {
  assert.equal(tokenFrom({ body: 'x-amzn-marketplace-token=abc%2Bdef' }), 'abc+def');
  assert.equal(tokenFrom({ body: Buffer.from('x-amzn-marketplace-token=zzz').toString('base64'), isBase64Encoded: true }), 'zzz');
  assert.equal(tokenFrom({ body: 'other=1' }), null);
});

function fake(resolve) {
  const writes = [];
  return { writes, clients: { metering: { send: async () => { if (resolve instanceof Error) throw resolve; return resolve; } }, ResolveCustomerCommand: function (i) { this.input = i; },
    ddb: { send: async (c) => { writes.push(c.input); } }, UpdateCommand: function (i) { this.input = i; } } };
}
const req = (method, body) => ({ rawPath: '/register', requestContext: { http: { method } }, body });

test('POST with a valid token resolves the customer, records them, and shows the launch page', async () => {
  const f = fake({ CustomerIdentifier: 'cust-1', ProductCode: 'prod-1', CustomerAWSAccountId: '111122223333' });
  const r = await handler(req('POST', 'x-amzn-marketplace-token=tok'), {}, { clients: f.clients, now: () => new Date('2026-09-26T10:00:00Z') });
  assert.equal(r.statusCode, 200); assert.match(r.body, /Launch Arena in CloudFormation/); assert.match(r.body, /111122223333/); assert.match(r.body, /param_MarketplaceCustomerId=cust-1/);
  assert.equal(f.writes[0].Key.customerId, 'cust-1'); assert.equal(f.writes[0].ExpressionAttributeValues[':a'], '111122223333');
});

test('POST without a token or with a bad token is a friendly 400', async () => {
  assert.equal((await handler(req('POST', ''), {}, { clients: fake({}).clients })).statusCode, 400);
  const bad = await handler(req('POST', 'x-amzn-marketplace-token=expired'), {}, { clients: fake(Object.assign(new Error('nope'), { name: 'InvalidTokenException' })).clients });
  assert.equal(bad.statusCode, 400); assert.match(bad.body, /could not be verified/);
});

test('GET shows the landing page; /health is JSON', async () => {
  assert.match((await handler(req('GET'), {}, { clients: fake({}).clients })).body, /Set up your account/);
  assert.equal(JSON.parse((await handler({ rawPath: '/health', requestContext: { http: { method: 'GET' } } }, {}, { clients: fake({}).clients })).body).ok, true);
});

test('notify parses Marketplace subscription messages and ignores junk', () => {
  const rec = { Sns: { Timestamp: '2026-09-26T10:00:00Z', Message: JSON.stringify({ action: 'subscribe-success', 'customer-identifier': 'cust-1', 'product-code': 'prod-1' }) } };
  const p = parseRecord(rec);
  assert.equal(p.customerId, 'cust-1'); assert.equal(p.action, 'subscribe-success'); assert.equal(p.productCode, 'prod-1');
  assert.equal(parseRecord({ Sns: { Message: 'not json' } }), null);
  assert.equal(parseRecord({ Sns: { Message: '{}' } }), null);
});
