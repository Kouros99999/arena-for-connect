const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assessDay, runFor } = require('./streaks.js');

test('assessDay: clean day extends, auto-fail or low eval resets, no contacts holds', () => {
  assert.deepEqual(assessDay({ handled: 5, evals: [90, 88] }, 3), { streak: 4, clean: true });
  assert.deepEqual(assessDay({ handled: 5, evals: [] }, 3), { streak: 4, clean: true });
  assert.deepEqual(assessDay({ handled: 5, evals: [90, 70] }, 3), { streak: 0, clean: false });
  assert.deepEqual(assessDay({ handled: 5, evals: [0, 95], autofails: 1 }, 3), { streak: 0, clean: false });
  assert.deepEqual(assessDay({ handled: 0 }, 3), { streak: 3, clean: null });
  assert.deepEqual(assessDay(null, 3), { streak: 3, clean: null });
});

test('runFor assesses yesterday once per agent and pays the bonus from day 2', async () => {
  const NOW = Date.parse('2026-09-16T00:30:00.000Z');
  const days = { 'arn:x/agent/a|2026-09-15': { handled: 3, evals: [92] }, 'arn:x/agent/b|2026-09-15': { handled: 2, evals: [60] }, 'arn:x/agent/d|2026-09-15': { handled: 1, evals: [] } };
  const streaks = {}, applied = [];
  const store = {
    scanLiveFull: async () => [
      { pk: 'AGENT#arn:x/agent/a', streak: 4, team: 't', username: 'a' },
      { pk: 'AGENT#arn:x/agent/b', streak: 2, team: 't', username: 'b' },
      { pk: 'AGENT#arn:x/agent/c', streak: 1, team: 't', username: 'c' },                            // no contacts yesterday: held
      { pk: 'AGENT#arn:x/agent/d', streak: 0, team: 't', username: 'd' },                            // first clean day: streak 1, no bonus yet
      { pk: 'AGENT#arn:x/agent/e', streak: 9, team: 't', username: 'e', streakAssessed: '2026-09-15' }, // already done
    ],
    getDay: async (arn, day) => days[arn + '|' + day] || null,
    setStreak: async (arn, s, d) => { streaks[arn] = [s, d]; },
    apply: async (w) => { applied.push(w); },
  };
  const r = await runFor(NOW, { store });
  assert.deepEqual(r, { day: '2026-09-15', assessed: 4, extended: 2, reset: 1, held: 1, bonuses: 1 });
  assert.deepEqual(streaks['arn:x/agent/a'], [5, '2026-09-15']);
  assert.deepEqual(streaks['arn:x/agent/b'], [0, '2026-09-15']);
  assert.deepEqual(streaks['arn:x/agent/c'], [1, '2026-09-15']);
  assert.deepEqual(streaks['arn:x/agent/d'], [1, '2026-09-15']);
  assert.equal(streaks['arn:x/agent/e'], undefined);
  assert.equal(applied.length, 1);
  const ledger = applied[0].find((w) => w.op === 'put' && w.item.sk && w.item.sk.startsWith('EV#'));
  assert.equal(ledger.item.EventType, 'STREAK_DAY'); assert.equal(ledger.item.Day, 5); assert.equal(ledger.item.points, 25);
});
