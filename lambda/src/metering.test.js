const assert = require('node:assert/strict');
const { test } = require('node:test');
const { countActive, report, handler } = require('./metering.js');

const NOW = Date.parse('2026-09-16T03:00:00.000Z');
const day = (d) => new Date(NOW - d * 86400000).toISOString();

test('countActive counts distinct agents inside the window', () => {
  const rows = [
    { pk: 'AGENT#a', lastEvent: day(1) }, { pk: 'AGENT#b', lastEvent: day(29) },
    { pk: 'AGENT#c', lastEvent: day(31) }, { pk: 'AGENT#a', lastEvent: day(2) }, { pk: 'AGENT#d' },
  ];
  assert.equal(countActive(rows, NOW, 30), 2);
  assert.equal(countActive([], NOW, 30), 0);
});

function fakeStore() {
  const meters = {};
  return { meters, scanLive: async () => [{ pk: 'AGENT#a', lastEvent: day(0.5) }, { pk: 'AGENT#b', lastEvent: day(0.9) }, { pk: 'AGENT#c', lastEvent: day(3) }],
    getMeter: async (d) => meters[d] || null, putMeter: async (d, f) => { meters[d] = f; } };
}

test('without a product code it records the count and does not call Marketplace', async () => {
  const s = fakeStore(); let called = 0;
  const r = await handler({}, {}, { store: s, now: () => NOW, metering: { client: { send: async () => { called++; } }, MeterUsageCommand: function () {} } });
  assert.equal(r.count, 2); assert.match(r.skipped, /not a Marketplace/); assert.equal(called, 0);
  assert.equal(s.meters['2026-09-16'].reported, false);
});

test('with a product code it meters once per day and is idempotent on retry', async () => {
  process.env.PRODUCT_CODE = 'abc123';
  delete require.cache[require.resolve('./metering.js')];
  const m = require('./metering.js');
  const s = fakeStore(); const sent = [];
  const deps = { store: s, now: () => NOW, metering: { client: { send: async (cmd) => { sent.push(cmd.input); return { MeteringRecordId: 'rec-1' }; } }, MeterUsageCommand: function (input) { this.input = input; } } };
  const first = await m.handler({}, {}, deps);
  assert.equal(first.reported, true); assert.equal(sent.length, 1);
  assert.equal(sent[0].ProductCode, 'abc123'); assert.equal(sent[0].UsageDimension, 'agent_days'); assert.equal(sent[0].UsageQuantity, 2);
  const again = await m.handler({}, {}, deps);
  assert.match(again.skipped, /already reported/); assert.equal(sent.length, 1);
  delete process.env.PRODUCT_CODE;
  delete require.cache[require.resolve('./metering.js')];
});

test('SaaS mode reports through BatchMeterUsage against the license and accepts a duplicate as done', async () => {
  process.env.PRODUCT_CODE = 'abc123'; process.env.LICENSE_ARN = 'arn:lic-9'; process.env.CUSTOMER_ACCOUNT_ID = '111122223333';
  delete require.cache[require.resolve('./metering.js')];
  const m = require('./metering.js');
  const s = fakeStore(); const sent = [];
  const deps = { store: s, now: () => NOW, metering: {
    client: { send: async (cmd) => { sent.push(cmd); return { Results: [{ MeteringRecordId: 'rec-s', Status: sent.length === 1 ? 'Success' : 'DuplicateRecord' }], UnprocessedRecords: [] }; } },
    MeterUsageCommand: function (input) { this.kind = 'single'; this.input = input; }, BatchMeterUsageCommand: function (input) { this.kind = 'batch'; this.input = input; } } };
  const r = await m.handler({}, {}, deps);
  assert.equal(r.reported, true); assert.equal(r.mode, 'saas'); assert.equal(sent[0].kind, 'batch');
  const rec = sent[0].input.UsageRecords[0];
  assert.equal(rec.LicenseArn, 'arn:lic-9'); assert.equal(rec.CustomerAWSAccountId, '111122223333'); assert.equal(rec.Dimension, 'agent_days'); assert.equal(rec.Quantity, 2);
  assert.equal(sent[0].input.ProductCode, undefined);
  delete process.env.PRODUCT_CODE; delete process.env.LICENSE_ARN; delete process.env.CUSTOMER_ACCOUNT_ID;
  delete require.cache[require.resolve('./metering.js')];
});

test('SaaS mode fails loudly when Marketplace leaves the record unprocessed', async () => {
  process.env.PRODUCT_CODE = 'abc123'; process.env.LICENSE_ARN = 'arn:lic-9'; process.env.CUSTOMER_ACCOUNT_ID = '111122223333';
  delete require.cache[require.resolve('./metering.js')];
  const m = require('./metering.js');
  const deps = { store: fakeStore(), now: () => NOW, metering: { client: { send: async () => ({ Results: [], UnprocessedRecords: [{}] }) }, MeterUsageCommand: function () {}, BatchMeterUsageCommand: function (i) { this.input = i; } } };
  await assert.rejects(() => m.handler({}, {}, deps), /did not accept/);
  delete process.env.PRODUCT_CODE; delete process.env.LICENSE_ARN; delete process.env.CUSTOMER_ACCOUNT_ID;
  delete require.cache[require.resolve('./metering.js')];
});

test('free trial: the first agents each day are not billed for the trial period, and the full count is kept', async () => {
  const { billable } = require('./metering.js');
  const t0 = NOW;
  assert.deepEqual(billable(40, t0, t0, 30, 25), { inTrial: true, billable: 15, trialEndsAt: new Date(t0 + 30 * 86400000).toISOString() });
  assert.equal(billable(10, t0 + 10 * 86400000, t0, 30, 25).billable, 0);
  assert.equal(billable(40, t0 + 31 * 86400000, t0, 30, 25).billable, 40);
  assert.equal(billable(40, t0, null, 30, 25).billable, 40);
  assert.equal(billable(40, t0, t0, 0, 25).inTrial, false);
  // Through the handler: the trial row is created on the first report and the reported quantity is the billable count.
  process.env.PRODUCT_CODE = 'code'; process.env.LICENSE_ARN = ''; delete require.cache[require.resolve('./metering.js')];
  const mod = require('./metering.js');
  const s = fakeStore(); const sent = [];
  const metering = { client: { send: async (cmd) => { sent.push(cmd.input); return { MeteringRecordId: 'rec' }; } }, MeterUsageCommand: function (i) { this.input = i; }, BatchMeterUsageCommand: function (i) { this.input = i; } };
  const r = await mod.handler({}, {}, { store: s, now: () => NOW, metering, trialDays: 30, trialAgents: 1 });
  assert.equal(r.count, 2); assert.equal(r.billed, 1); assert.equal(r.trial, true); assert.equal(sent[0].UsageQuantity, 1);
  assert.equal(s.meters.TRIAL.startedAt, new Date(NOW).toISOString()); assert.equal(s.meters['2026-09-16'].count, 2); assert.equal(s.meters['2026-09-16'].billed, 1);
  delete process.env.PRODUCT_CODE; delete require.cache[require.resolve('./metering.js')];
});
