const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runFor, buildDigest } = require('./digest.js');

const NOW = new Date('2026-09-16T09:10:00.000Z');   // 09:xx UTC
function fakeStore() {
  const calls = [], items = [];
  const s = { calls, items, notify: { slackUrl: 'https://hooks.slack.com/a', digestHour: 9, events: { kudos: true, rewards: true, challenges: true, digest: true } }, marks: {},
    listTeams: async () => ['Billing team'],
    getNotify: async () => s.notify,
    listTeamItems: async (team, prefix, limit, newest) => items.filter((i) => i.sk.startsWith(prefix)),
    updateTeamItem: async (team, sk, f) => { const i = items.find((x) => x.sk === sk); Object.assign(i, f); calls.push(['update', sk, f.state]); return i; },
    getTeam: async () => [{ id: 'a1', name: 'Priya', today: 150, handled: 6, ahtSum: 1800, evals: [90], kudosReceived: 2, escalations: 0, state: 'Available', lastEvent: NOW.getTime() }, { id: 'a2', name: 'Marcus', today: 40, handled: 2, ahtSum: 700, evals: [], kudosReceived: 0, escalations: 0, state: 'Available', lastEvent: NOW.getTime() }],
    getTeamDays: async (team, dates) => { const out = {}; for (const d of dates) out[d] = [{ pk: 'AGENT#a1', username: 'priya', points: 150, handled: 6, ahtSum: 1800, evals: [90] }, { pk: 'AGENT#a2', username: 'marcus', points: 40, handled: 2, ahtSum: 700, evals: [] }]; return out; },
    getTeamLive: async () => [{ pk: 'AGENT#a1', displayName: 'Priya', username: 'priya' }, { pk: 'AGENT#a2', displayName: 'Marcus', username: 'marcus' }],
    getDigestMark: async (team, day) => s.marks[team + day] || null, putDigestMark: async (team, day, ch) => { s.marks[team + day] = ch; },
    apply: async (w) => { calls.push(['apply', w[1].item.AgentARN, w[1].item.points]); return true; },
    getAgentDays: async (arn) => (arn === 'a1' ? [{ sk: 'DAY#2026-09-10', points: 100 }, { sk: 'DAY#2026-09-11', points: 120 }, { sk: 'DAY#2026-09-12', points: 90 }, { sk: 'DAY#2026-09-15', points: 150 }] : [{ sk: 'DAY#2026-09-15', points: 40 }]),
    putTeamItem: async (team, sk, item) => { items.push(Object.assign({ pk: 'TEAMITEMS#' + team, sk }, item)); calls.push(['spot', sk]); },
  };
  return s;
}

test('buildDigest summarises the day', () => {
  const d = buildDigest('Billing team', [{ id: 'a1', name: 'Priya', today: 150, handled: 6, ahtSum: 1800, evals: [90], kudosReceived: 2, escalations: 0, state: 'Available', lastEvent: NOW.getTime() }], [{ state: 'active', title: 'Race', progress: { label: 'Priya leads' } }, { state: 'ended', title: 'Old' }], 1, NOW.getTime());
  assert.equal(d.points, 150); assert.equal(d.qa, 90); assert.equal(d.kudos, 2); assert.deepEqual(d.top, [{ name: 'Priya', points: 150 }]); assert.deepEqual(d.challenges, [{ title: 'Race', label: 'Priya leads' }]); assert.equal(d.rewardsPending, 1);
});

test('the hourly run sends each team its digest once at its hour, and finishes challenges whose date has passed', async () => {
  const s = fakeStore(); const sent = [];
  s.items.push({ pk: 'TEAMITEMS#Billing team', sk: 'CH#2026-09-10T00:00:00Z#r1', id: 'r1', template: 'race', title: 'Points race', metrics: [{ key: 'points', weight: 1 }], tiers: [{ place: 1, reward: 100 }], startsAt: '2026-09-10', endsAt: '2026-09-15', state: 'active', excluded: [] },
    { pk: 'TEAMITEMS#Billing team', sk: 'CH#2026-09-10T00:00:00Z#r2', id: 'r2', template: 'contest', title: 'Still running', target: 100, reward: 10, startsAt: '2026-09-10', endsAt: '2026-09-20', state: 'active' });
  const send = async (cfg, ev) => { sent.push(ev.kind); return ['slack']; };
  const r = await runFor(NOW, { store: s, send });
  assert.deepEqual(r, { teams: 1, digests: 1, finalized: 1, prizes: 1, bestDays: 1 });
  assert.deepEqual(sent, ['challengeEnded', 'spotlight', 'digest']);
  assert.deepEqual(s.calls.find((c) => c[0] === 'apply').slice(1), ['a1', 100], 'the race winner was paid');
  assert.equal(s.items[0].state, 'ended'); assert.equal(s.items[0].results.prizes[0].name, 'Priya'); assert.equal(s.items[1].state, 'active');
  const again = await runFor(NOW, { store: s, send });
  assert.deepEqual(again, { teams: 1, digests: 0, finalized: 0, prizes: 0, bestDays: 0 }, 'idempotent within the hour');
  s.marks = {};
  const wrongHour = await runFor(new Date('2026-09-16T10:10:00.000Z'), { store: s, send });
  assert.equal(wrongHour.digests, 0, 'not the team\'s hour');
  s.notify.events.digest = false;
  assert.equal((await runFor(NOW, { store: s, send })).digests, 0, 'digest switched off');
});

test('the first run after midnight spotlights personal best days, once per team per day', async () => {
  const s = fakeStore(); const send = async (cfg, ev) => { s.calls.push(['send', ev.kind, ev.who]); return ['slack']; };
  const r = await runFor(new Date('2026-09-16T01:05:00.000Z'), { store: s, send });
  assert.equal(r.bestDays, 1, 'a1 beat three earlier days; a2 has no history');
  assert.ok(s.calls.some((c) => c[0] === 'spot' && c[1].includes('spot-a1-bestDay')));
  assert.ok(s.calls.some((c) => c[0] === 'send' && c[1] === 'spotlight' && c[2] === 'Priya'));
  assert.equal((await runFor(new Date('2026-09-16T02:05:00.000Z'), { store: s, send })).bestDays, 0, 'marked, not repeated');
});
