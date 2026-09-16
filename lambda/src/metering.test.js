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
  return { meters, scanLive: async () => [{ pk: 'AGENT#a', lastEvent: day(1) }, { pk: 'AGENT#b', lastEvent: day(3) }],
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
  assert.equal(sent[0].ProductCode, 'abc123'); assert.equal(sent[0].UsageDimension, 'agents'); assert.equal(sent[0].UsageQuantity, 2);
  const again = await m.handler({}, {}, deps);
  assert.match(again.skipped, /already reported/); assert.equal(sent.length, 1);
  delete process.env.PRODUCT_CODE;
  delete require.cache[require.resolve('./metering.js')];
});
