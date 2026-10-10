const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spotlight } = require('./spotlight.js');

test('a spotlight lands on the team feed as Arena and reaches the channels; a bad store never throws', async () => {
  const items = [], sent = [];
  const s = { putTeamItem: async (team, sk, item) => items.push({ team, sk, item }), getNotify: async () => ({ slackUrl: 'https://hooks.slack.com/x', events: { spotlights: true } }) };
  const ok = await spotlight(s, 'Billing', { kind: 'evaluation', score: 97, agent: 'arn/agent/p1', name: 'Priya N', at: '2026-09-15T10:00:00.000Z' }, { send: async (cfg, ev) => { sent.push(ev); return ['slack']; } });
  assert.equal(ok, true); assert.equal(items.length, 1);
  assert.equal(items[0].sk, 'KD#2026-09-15T10:00:00.000Z#spot-p1-evaluation'); assert.equal(items[0].item.from, 'Arena'); assert.equal(items[0].item.auto, true); assert.equal(items[0].item.note, 'Scored 97% on an evaluation');
  assert.deepEqual(sent[0], { kind: 'spotlight', who: 'Priya N', what: 'Scored 97% on an evaluation' });
  assert.equal(await spotlight(s, 'Billing', { kind: 'evaluation', score: 80, agent: 'a' }), false, 'not notable');
  assert.equal(await spotlight({ putTeamItem: async () => { throw new Error('down'); } }, 'Billing', { kind: 'streak', days: 10, agent: 'a' }), false, 'swallowed');
});
