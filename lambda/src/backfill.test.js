const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runFor, readResults, toEvent } = require('./backfill.js');
const Arena = require('./arena-engine.js');

const INSTANCE = 'arn:aws:connect:us-east-1:111122223333:instance/inst-1';
const NOW = Date.parse('2026-09-16T05:30:00.000Z');
const user = { id: 'p1', arn: INSTANCE + '/agent/p1', username: 'priya', name: 'Priya N', team: 'Billing' };

test('metric rows become per-day numbers and a day with contacts scores what the engine would have', () => {
  const by = readResults([
    { Dimensions: { AGENT: 'p1' }, MetricInterval: { StartTime: new Date('2026-09-14T00:00:00.000Z') }, Collections: [{ Metric: { Name: 'CONTACTS_HANDLED' }, Value: 10 }, { Metric: { Name: 'SUM_HANDLE_TIME' }, Value: 3000 }, { Metric: { Name: 'EVALUATIONS_PERFORMED' }, Value: 2 }, { Metric: { Name: 'AVG_EVALUATION_SCORE' }, Value: 90 }] },
    { Dimensions: { AGENT: 'p1' }, MetricInterval: { StartTime: new Date('2026-09-15T00:00:00.000Z') }, Collections: [{ Metric: { Name: 'CONTACTS_HANDLED' }, Value: 0 }] },
  ], 'UTC');
  assert.deepEqual(by.p1['2026-09-14'], { handled: 10, ahtSum: 3000, evals: 2, evalAvg: 90 });
  const m = Arena.DEFAULT_MIX, made = toEvent(user, '2026-09-14', by.p1['2026-09-14'], m, 'UTC');
  assert.equal(made.points, 10 * Arena.scoreEvent('CONTACT_HANDLED', { HandleTime: 300 }, m) + 2 * Arena.scoreEvent('EVALUATION_SUBMITTED', { Score: 90 }, m));
  assert.equal(made.ev.EventType, 'BACKFILL_DAY'); assert.equal(made.ev.EventTimestamp, '2026-09-14T23:59:59.000Z'); assert.equal(made.ev.DedupKey, 'BF#2026-09-14#p1'); assert.equal(made.ev.Handled, 10); assert.equal(made.ev.EvalScore, 90);
  assert.equal(toEvent(user, '2026-09-15', by.p1['2026-09-15'], m, 'UTC'), null);
});

test('the job lists users, seeds LIVE rows, writes past days once, skips days the stream covered, and marks itself done', async () => {
  const calls = [], applied = [], seeded = [], marks = {};
  const s = { getMark: async (j, d) => marks[j + '#' + d] || null, putMark: async (j, d, f) => { marks[j + '#' + d] = f; }, seedLive: async (arn, f) => seeded.push([arn, f]), getMix: async () => null,
    getDay: async (arn, day) => (day === '2026-09-14' ? { points: 1 } : null), apply: async (w) => { applied.push(w); return true; } };
  const connect = {
    ListUsersCommand: function (i) { this.kind = 'list'; this.input = i; }, DescribeUserCommand: function (i) { this.kind = 'user'; this.input = i; },
    DescribeRoutingProfileCommand: function (i) { this.kind = 'rp'; this.input = i; }, GetMetricDataV2Command: function (i) { this.kind = 'metrics'; this.input = i; },
    client: { send: async (c) => { calls.push(c);
      if (c.kind === 'list') return { UserSummaryList: [{ Id: 'p1', Arn: INSTANCE + '/agent/p1', Username: 'priya' }, { Id: 'p2', Arn: INSTANCE + '/agent/p2', Username: 'marcus' }] };
      if (c.kind === 'user') return { User: { Username: c.input.UserId === 'p1' ? 'priya' : 'marcus', RoutingProfileId: 'rp-1', IdentityInfo: { FirstName: c.input.UserId === 'p1' ? 'Priya' : 'Marcus', LastName: 'N' } } };
      if (c.kind === 'rp') return { RoutingProfile: { Name: 'Billing' } };
      return { MetricResults: [
        { Dimensions: { AGENT: 'p1' }, MetricInterval: { StartTime: new Date('2026-09-13T00:00:00.000Z') }, Collections: [{ Metric: { Name: 'CONTACTS_HANDLED' }, Value: 4 }, { Metric: { Name: 'SUM_HANDLE_TIME' }, Value: 1200 }] },
        { Dimensions: { AGENT: 'p1' }, MetricInterval: { StartTime: new Date('2026-09-14T00:00:00.000Z') }, Collections: [{ Metric: { Name: 'CONTACTS_HANDLED' }, Value: 7 }] },
        { Dimensions: { AGENT: 'p2' }, MetricInterval: { StartTime: new Date('2026-09-16T00:00:00.000Z') }, Collections: [{ Metric: { Name: 'CONTACTS_HANDLED' }, Value: 3 }] },
      ] }; } } };
  const r = await runFor(NOW, { store: s, connect, instanceArn: INSTANCE, days: 7, tz: 'UTC' });
  assert.deepEqual(r, { users: 2, from: '2026-09-09', to: '2026-09-15', agentDays: 1, kept: 1, points: 48 });
  assert.equal(seeded.length, 2); assert.deepEqual(seeded[0][1], { team: 'Billing', username: 'priya', displayName: 'Priya N' });
  const m = calls.find((c) => c.kind === 'metrics').input;
  assert.equal(m.ResourceArn, INSTANCE); assert.deepEqual(m.Interval, { IntervalPeriod: 'DAY', TimeZone: 'UTC' }); assert.deepEqual(m.Filters[0].FilterValues, ['p1', 'p2']);
  assert.equal(m.StartTime.toISOString(), '2026-09-09T00:00:00.000Z'); assert.equal(m.EndTime.toISOString(), '2026-09-16T00:00:00.000Z');
  assert.equal(calls.filter((c) => c.kind === 'rp').length, 1, 'routing profile looked up once');
  assert.ok(marks['BACKFILL#done']);
  assert.equal((await runFor(NOW, { store: s, connect, instanceArn: INSTANCE, days: 7 })).skipped, 'already done');
  assert.equal((await runFor(NOW, { store: s, connect, instanceArn: '', days: 7 })).skipped, 'backfill not configured');
});
