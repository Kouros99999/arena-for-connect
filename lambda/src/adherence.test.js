const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runFor, readResults, toEvent, splitAgentArn } = require('./adherence.js');

const ARN = (id) => `arn:aws:connect:us-east-1:111122223333:instance/inst-1/agent/${id}`;
const NOW = new Date('2026-09-16T00:45:00.000Z');   // the first run after UTC midnight

function fakeStore(live) {
  const applied = [], marks = {};
  return { applied, marks,
    scanLiveFull: async () => live,
    getMix: async () => null,
    getMark: async (job, day) => marks[job + '#' + day] || null,
    putMark: async (job, day, f) => { marks[job + '#' + day] = f; },
    apply: async (w) => { applied.push(w); return true; } };
}
const fakeConnect = (results, calls) => ({ GetMetricDataV2Command: function (input) { this.input = input; }, client: { send: async (cmd) => { calls.push(cmd.input); return { MetricResults: results }; } } });

test('agent ARNs split into instance and agent ids', () => {
  assert.deepEqual(splitAgentArn(ARN('p1')), { instanceArn: 'arn:aws:connect:us-east-1:111122223333:instance/inst-1', region: 'us-east-1', agentId: 'p1' });
  assert.equal(splitAgentArn('agent-3'), null);
});

test('metric results become one scored event per agent with a schedule', () => {
  const by = readResults([
    { Dimensions: { AGENT: 'p1' }, Collections: [{ Metric: { Name: 'AGENT_SCHEDULE_ADHERENCE' }, Value: 93.5 }, { Metric: { Name: 'AGENT_ADHERENT_TIME' }, Value: 26640 }, { Metric: { Name: 'AGENT_SCHEDULED_TIME' }, Value: 28800 }] },
    { Dimensions: { AGENT: 'p2' }, Collections: [{ Metric: { Name: 'AGENT_SCHEDULED_TIME' }, Value: 0 }] },
  ]);
  const ev = toEvent({ pk: 'AGENT#' + ARN('p1'), team: 'Billing', username: 'priya', displayName: 'Priya N' }, '2026-09-15', by.p1, '2026-09-15T23:59:59.000Z');
  assert.equal(ev.EventType, 'ADHERENCE_SCORED'); assert.equal(ev.Adherence, 93.5); assert.equal(ev.AdherentHours, 7.4); assert.equal(ev.ScheduledHours, 8);
  assert.equal(ev.DedupKey, 'ADH#2026-09-15#p1'); assert.equal(ev.Team, 'Billing'); assert.equal(ev.EventTimestamp, '2026-09-15T23:59:59.000Z');
  assert.equal(toEvent({ pk: 'AGENT#' + ARN('p2') }, '2026-09-15', by.p2, 'x'), null, 'no schedule, no event');
  assert.equal(toEvent({ pk: 'AGENT#' + ARN('p3') }, '2026-09-15', undefined, 'x'), null);
});

test('the job asks Connect for yesterday, scores every scheduled agent once, and marks the day', async () => {
  const live = [{ pk: 'AGENT#' + ARN('p1'), team: 'Billing', username: 'priya' }, { pk: 'AGENT#' + ARN('p2'), team: 'Billing', username: 'marcus' }, { pk: 'AGENT#agent-3', team: 'demo' }];
  const s = fakeStore(live), calls = [];
  const connect = fakeConnect([
    { Dimensions: { AGENT: 'p1' }, Collections: [{ Metric: { Name: 'AGENT_SCHEDULE_ADHERENCE' }, Value: 90 }, { Metric: { Name: 'AGENT_ADHERENT_TIME' }, Value: 7200 }, { Metric: { Name: 'AGENT_SCHEDULED_TIME' }, Value: 8000 }] },
  ], calls);
  const r = await runFor(NOW, { store: s, connect });
  assert.equal(r.day, '2026-09-15'); assert.equal(r.agents, 2, 'the demo agent is not a Connect agent'); assert.equal(r.scored, 1); assert.equal(r.noSchedule, 1); assert.equal(r.points, 10);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ResourceArn, 'arn:aws:connect:us-east-1:111122223333:instance/inst-1');
  assert.deepEqual(calls[0].Filters, [{ FilterKey: 'AGENT', FilterValues: ['p1', 'p2'] }]); assert.deepEqual(calls[0].Groupings, ['AGENT']);
  assert.equal(calls[0].StartTime.toISOString(), '2026-09-15T00:00:00.000Z'); assert.equal(calls[0].EndTime.toISOString(), '2026-09-16T00:00:00.000Z');
  assert.equal(s.applied.length, 1);
  const ev = s.applied[0].find((w) => w.item && w.item.sk && w.item.sk.startsWith('EV#')).item;
  assert.equal(ev.EventType, 'ADHERENCE_SCORED'); assert.equal(ev.points, 10); assert.equal(ev.EventTimestamp, '2026-09-15T23:59:59.000Z');
  assert.ok(s.applied[0].find((w) => w.key && w.key.sk === 'DAY#2026-09-15'), 'lands on yesterday');
  assert.deepEqual(s.marks['ADHERENCE#2026-09-15'], { agents: 2, scored: 1, noSchedule: 1, points: 10 });
  // Later that day: nothing to do.
  const again = await runFor(new Date('2026-09-16T13:45:00.000Z'), { store: s, connect });
  assert.equal(again.skipped, 'already imported'); assert.equal(calls.length, 1);
});
