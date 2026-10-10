const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runFor, rowsFor, rowsBetween, toRow, jsonl } = require('./export.js');

const NOW = new Date('2026-09-16T07:50:00.000Z');
function fakeStore() {
  const days = { '2026-09-15': { Billing: [{ pk: 'AGENT#arn/agent/p1', username: 'priya', points: 118, handled: 4, ahtSum: 1200, evals: [92], kudosReceived: 1, sentSum: 2.4, sentCount: 2, adhSum: 93, adhCount: 1, adherenceHours: 7.4 }], Sales: [{ pk: 'AGENT#arn/agent/s1', username: 'sam', points: 40, handled: 2, ahtSum: 700, evals: [] }] }, '2026-09-14': { Billing: [{ pk: 'AGENT#arn/agent/p1', username: 'priya', points: 60, handled: 2, ahtSum: 500, evals: [] }], Sales: [] } };
  return { listTeams: async () => ['Billing', 'Sales'], getTeamLive: async (t) => (t === 'Billing' ? [{ pk: 'AGENT#arn/agent/p1', displayName: 'Priya N', username: 'priya' }] : []),
    getTeamDays: async (t, dates) => { const out = {}; for (const d of dates) out[d] = (days[d] && days[d][t]) || []; return out; } };
}

test('a day row becomes a flat export row with averages, names and no customer data', () => {
  const r = toRow({ pk: 'AGENT#arn/agent/p1', username: 'priya', points: 118, handled: 4, ahtSum: 1200, evals: [92, 88], autofails: 0, escalations: 1, kudosReceived: 1, sentSum: 2.4, sentCount: 2, csatSum: 9, csatCount: 2, adhSum: 93, adhCount: 1, adherenceHours: 7.4 }, 'Billing', '2026-09-15', { 'arn/agent/p1': 'Priya N' });
  assert.deepEqual(r, { day: '2026-09-15', team: 'Billing', agentArn: 'arn/agent/p1', agentId: 'p1', username: 'priya', name: 'Priya N', points: 118, contactsHandled: 4, avgHandleTimeSeconds: 300, evaluations: 2, evaluationAvg: 90, autoFails: 0, escalations: 1, kudosReceived: 1, sentimentAvg: 1.2, surveyAvg: 4.5, adherencePct: 93, adherentHours: 7.4 });
  assert.equal(jsonl([{ a: 1 }, { b: 2 }]), '{"a":1}\n{"b":2}\n'); assert.equal(jsonl([]), '');
});

test('rows come per team and per day range, capped', async () => {
  const s = fakeStore();
  assert.equal((await rowsFor(s, '2026-09-15')).length, 2);
  assert.equal((await rowsFor(s, '2026-09-15', 'Sales'))[0].name, 'sam', 'falls back to the username');
  const span = await rowsBetween(s, '2026-09-14', '2026-09-15', 'Billing');
  assert.deepEqual(span.map((r) => r.day + ':' + r.points), ['2026-09-14:60', '2026-09-15:118']);
});

test('the nightly job writes one file per team for yesterday plus a manifest, and skips without a bucket', async () => {
  const s = fakeStore(); const written = [];
  const r = await runFor(NOW, { store: s, bucket: 'b', put: async (key, body, type) => written.push({ key, body, type }) });
  assert.deepEqual(r, { day: '2026-09-15', teams: 2, files: 2, rows: 2 });
  assert.deepEqual(written.map((w) => w.key), ['days/dt=2026-09-15/billing.json', 'days/dt=2026-09-15/sales.json', 'manifests/2026-09-15.json']);
  assert.equal(written[0].type, 'application/x-ndjson'); assert.equal(JSON.parse(written[0].body.trim()).name, 'Priya N');
  assert.equal(JSON.parse(written[2].body).files.length, 2);
  assert.equal((await runFor(NOW, { store: s, bucket: '' })).skipped, 'no export bucket');
});
