const assert = require('node:assert/strict');
const { test } = require('node:test');
const Arena = require('./arena-engine.js');
const { challengeFields, prizesFor, periodAgents } = require('./challenges.js');

const T = Arena.TEMPLATES;

test('challengeFields validates and normalises each template', () => {
  const race = challengeFields({ template: 'race', metrics: [{ key: 'qa', weight: '2' }, { key: 'bogus', weight: 1 }, { key: 'points', weight: 0 }], minContacts: '3.7', tiers: [{ place: 1, reward: 100 }, { place: 0, reward: 5 }, { place: 2, reward: 0 }], anonymize: 'yes', startsAt: '2026-09-10', endsAt: '2026-09-12' }, T.race, '2026-09-10');
  assert.equal(race.ok, true); assert.deepEqual(race.fields.metrics, [{ key: 'qa', weight: 2 }]); assert.equal(race.fields.minContacts, 4); assert.deepEqual(race.fields.tiers, [{ place: 1, reward: 100 }]); assert.equal(race.fields.anonymize, true);
  assert.equal(challengeFields({ template: 'race', metrics: [{ key: 'bogus', weight: 1 }] }, T.race, '2026-09-10').ok, false);
  assert.equal(challengeFields({ template: 'duel', agents: ['a', 'a'] }, T.duel, '2026-09-10').ok, false);
  assert.equal(challengeFields({ template: 'duel', agents: ['a', 'b'], metric: 'handled' }, T.duel, '2026-09-10').fields.metric, 'handled');
  assert.equal(challengeFields({ template: 'teams' }, T.teams, '2026-09-10').ok, false);
  assert.equal(challengeFields({ template: 'teams', opponent: 'Support', metric: 'csat' }, T.teams, '2026-09-10').fields.opponent, 'Support');
  assert.equal(challengeFields({ template: 'esc', startsAt: '2026-09-12', endsAt: '2026-09-10' }, T.esc, '2026-09-10').ok, false, 'end before start');
  const esc = challengeFields({ template: 'esc', target: '5%', reward: '150 pts' }, T.esc, '2026-09-10').fields;
  assert.equal(esc.target, 5); assert.equal(esc.reward, 150); assert.equal(esc.startsAt, '2026-09-10'); assert.equal(esc.metrics, undefined);
});

test('standings honour qualifiers, exclusions, weights and tiers', () => {
  const agents = [
    { id: 'a', name: 'A', today: 100, handled: 10, ahtSum: 3000, evals: [90] },
    { id: 'b', name: 'B', today: 300, handled: 10, ahtSum: 3000, evals: [70] },
    { id: 'c', name: 'C', today: 500, handled: 1, ahtSum: 300, evals: [] },
  ];
  const st = Arena.challengeStandings({ template: 'race', metrics: [{ key: 'qa', weight: 3 }, { key: 'points', weight: 1 }], minContacts: 5, tiers: [{ place: 1, reward: 50 }, { place: 2, reward: 20 }], excluded: [] }, agents);
  assert.deepEqual(st.rows.map((r) => [r.name, r.rank, r.prize]), [['A', 1, 50], ['B', 2, 20], ['C', undefined, undefined]]);
  assert.equal(st.rows[2].qualified, false);
  const noB = Arena.challengeStandings({ template: 'race', metrics: [{ key: 'points', weight: 1 }], excluded: ['b'] }, agents);
  assert.deepEqual(noB.rows.map((r) => [r.name, r.rank]), [['C', 1], ['A', 2], ['B', undefined]]); assert.equal(noB.rows[2].excluded, true);
  const lower = Arena.challengeStandings({ template: 'race', metrics: [{ key: 'aht', weight: 1 }] }, agents);
  assert.equal(lower.rows[0].name, 'A', 'equal AHT: A and B tie on score, A ranks first on contacts tie-break? A and B both 300s; C is 300s too');
  const flat = Arena.challengeStandings({ template: 'race', metrics: [{ key: 'points', weight: 1 }], reward: 80 }, agents);
  assert.equal(flat.rows[0].prize, 80, 'no tiers: the flat reward goes to first place'); assert.equal(flat.rows[1].prize, 0);
});

test('prizes: ranked challenges pay by place, team challenges pay everyone who took part when held', () => {
  const agents = [{ id: 'a', name: 'A', today: 10, handled: 2, evals: [90], kudosReceived: 3 }, { id: 'b', name: 'B', today: 0, handled: 0, evals: [], kudosReceived: 0 }];
  const race = { template: 'race', metrics: [{ key: 'points', weight: 1 }], tiers: [{ place: 1, reward: 100 }] };
  assert.deepEqual(prizesFor(race, Arena.challengeProgress(race, agents), agents), [{ agentId: 'a', name: 'A', points: 100, place: '1st place' }]);
  const esc = { template: 'esc', target: 5, reward: 30 };
  assert.deepEqual(prizesFor(esc, Arena.challengeProgress(esc, agents), agents), [{ agentId: 'a', name: 'A', points: 30, place: 'held' }], 'only agents with activity');
  const kudos = { template: 'kudos', target: 3, reward: 10 };
  assert.deepEqual(prizesFor(kudos, { onTrack: true }, agents).map((p) => p.agentId), ['a']);
  assert.deepEqual(prizesFor(esc, { onTrack: false }, agents), [], 'not held, nothing paid');
});

test('periodAgents aggregates only the challenge window', () => {
  const days = [{ date: '2026-09-09', rows: [{ id: 'a', name: 'A', points: 5, handled: 1 }] }, { date: '2026-09-10', rows: [{ id: 'a', name: 'A', points: 10, handled: 2, evals: [80] }] }, { date: '2026-09-11', rows: [{ id: 'a', name: 'A', points: 20, handled: 3, evals: [90] }] }];
  const a = periodAgents(days, { startsAt: '2026-09-10', endsAt: '2026-09-11' }, '2026-09-11')[0];
  assert.equal(a.today, 30); assert.equal(a.handled, 5); assert.deepEqual(a.evals, [80, 90]);
  assert.equal(periodAgents(days, { startsAt: '2026-09-10', endsAt: '2026-09-20' }, '2026-09-10')[0].today, 10, 'nothing past today');
});
