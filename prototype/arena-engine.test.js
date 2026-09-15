// Run: node prototype/arena-engine.test.js
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Arena = require('./arena-engine.js');

test('quality outweighs speed at the default mix', () => {
  const m = Arena.DEFAULT_MIX;
  const fastCall = Arena.scoreEvent('CONTACT_HANDLED', { HandleTime: 200 }, m);
  const slowCall = Arena.scoreEvent('CONTACT_HANDLED', { HandleTime: 700 }, m);
  const goodEval = Arena.scoreEvent('EVALUATION_SUBMITTED', { Score: 95 }, m);
  assert.equal(fastCall, 12); assert.equal(slowCall, 6); assert.equal(goodEval, 30);
  assert.ok(goodEval > fastCall * 2, 'one 95 eval beats two fast calls');
});

test('auto-fail removes points and is never scaled by the mix', () => {
  const m = { quality: 90, productivity: 5, adherence: 5 };
  assert.equal(Arena.scoreEvent('EVALUATION_SUBMITTED', { AutoFail: true }, m), -40);
});

test('mix must add to 100; low quality warns but saves', () => {
  assert.equal(Arena.validateMix({ quality: 50, productivity: 35, adherence: 15 }).ok, true);
  assert.equal(Arena.validateMix({ quality: 50, productivity: 40, adherence: 15 }).ok, false);
  const low = Arena.validateMix({ quality: 30, productivity: 55, adherence: 15 });
  assert.equal(low.ok, true); assert.match(low.message, /rushing/);
});

test('mix scales its own family only', () => {
  const heavyQ = { quality: 100, productivity: 0, adherence: 0 };
  assert.equal(Arena.scoreEvent('EVALUATION_SUBMITTED', { Score: 90 }, heavyQ), 40);
  assert.equal(Arena.scoreEvent('CONTACT_HANDLED', { HandleTime: 300 }, heavyQ), 0);
});

test('levels', () => {
  assert.equal(Arena.levelFor(0).name, 'Rookie');
  assert.equal(Arena.levelFor(150).name, 'Starter');
  const l = Arena.levelFor(1000);
  assert.equal(l.name, 'Resolver'); assert.equal(l.next, 'Closer'); assert.equal(l.toNext, 400);
  assert.equal(Arena.levelFor(9999).next, null);
});

test('engine ingests events and updates the leaderboard', () => {
  const e = Arena.createEngine();
  const a = e.agents[3];
  const seen = []; e.on((r) => seen.push(r));
  e.ingest({ EventType: 'CONTACT_HANDLED', AgentARN: a.id, HandleTime: 300, Queue: 'Billing' });
  e.ingest({ EventType: 'EVALUATION_SUBMITTED', AgentARN: a.id, Score: 96 });
  assert.equal(a.today, 42); assert.equal(a.handled, 1); assert.deepEqual(a.evals, [96]);
  assert.equal(e.leaderboard('today')[0].agent.id, a.id);
  assert.equal(seen.length, 2); assert.equal(seen[1].points, 30);
  assert.equal(e.ingest({ EventType: 'KUDOS', AgentARN: 'nobody' }), null);
});

test('flags: quiet, rushing, auto-fail', () => {
  const e = Arena.seedTeam(Arena.createEngine(), 1000000000);
  const at = 1000000000;
  const liam = e.agents[7], kenji = e.agents[9], hannah = e.agents[4], priya = e.agents[0];
  assert.deepEqual(Arena.flagsFor(liam, e.agents, at).map((f) => f.level), ['quiet']);
  assert.deepEqual(Arena.flagsFor(kenji, e.agents, at).map((f) => f.level), ['warn']);
  assert.deepEqual(Arena.flagsFor(hannah, e.agents, at).map((f) => f.level), ['bad']);
  assert.deepEqual(Arena.flagsFor(priya, e.agents, at), []);
});

test('badges', () => {
  const e = Arena.seedTeam(Arena.createEngine());
  const b = Object.fromEntries(e.badges(e.agents[0]).map((x) => [x.id, x.earned]));
  assert.equal(b.streak7, true); assert.equal(b.team, true); assert.equal(b.first95, false); assert.equal(b.fifty, false);
});

test('simulator fires typed events through the engine', () => {
  const e = Arena.createEngine();
  const s = Arena.createSimulator(e);
  const r = s.fire('autofail', e.agents[1]);
  assert.equal(r.points, -40); assert.equal(e.agents[1].autofails, 1);
  assert.equal(s.fire('kudos', e.agents[1]).event.EventType, 'KUDOS');
  assert.equal(s.running, false);
});
