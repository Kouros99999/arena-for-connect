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
  assert.deepEqual(Arena.flagsFor(kenji, e.agents, at).map((f) => f.label), ['Volume high, QA low', 'Customer sentiment low']);
  assert.deepEqual(Arena.flagsFor(hannah, e.agents, at).map((f) => f.level), ['bad']);
  assert.deepEqual(Arena.flagsFor(priya, e.agents, at), []);
});

test('badges', () => {
  const e = Arena.seedTeam(Arena.createEngine());
  const b = Object.fromEntries(e.badges(e.agents[0]).map((x) => [x.id, x.earned]));
  assert.equal(b.streak7, true); assert.equal(b.team, true); assert.equal(b.first95, false); assert.equal(b.fifty, false);
});

test('challengeProgress measures from agent data', () => {
  const agents = [{ handled: 10, escalations: 1, today: 300, evals: [90, 88], kudosReceived: 3 }, { handled: 10, escalations: 0, today: 200, evals: [70], kudosReceived: 1 }];
  const esc = Arena.challengeProgress({ template: 'esc', target: '5%' }, agents);
  assert.equal(esc.value, '5.0%'); assert.equal(esc.onTrack, true); assert.equal(esc.measured, true);
  assert.equal(Arena.challengeProgress({ template: 'esc', target: 5 }, [{ handled: 0 }]).measured, false);
  const qa = Arena.challengeProgress({ template: 'qa', target: 85 }, agents);
  assert.equal(qa.value, '1/2'); assert.equal(qa.onTrack, false);
  const contest = Arena.challengeProgress({ template: 'contest', target: 1000 }, agents);
  assert.equal(contest.progress, 0.5); assert.equal(contest.onTrack, false);
  const kudos = Arena.challengeProgress({ template: 'kudos', target: 3 }, agents);
  assert.equal(kudos.value, '1/2');
  assert.equal(Arena.challengeProgress({ template: 'fcr', target: 80 }, agents).measured, false);
});

test('local engine: challenges, rewards and kudos feed', async () => {
  const e = Arena.seedTeam(Arena.createEngine());
  const list = await e.challenges();
  assert.equal(list.length, 5); assert.ok(list[0].progress);
  const made = await e.createChallenge({ template: 'contest', target: 500, startsAt: '2099-01-01', endsAt: '2099-01-05' });
  assert.equal(made.state, 'scheduled'); assert.equal(made.reward, 250);
  assert.equal((await e.endChallenge(made.id)).state, 'ended');
  const pending = await e.rewards('pending'); assert.equal(pending.length, 2);
  await assert.rejects(() => e.requestReward(e.agents[0].id, 'lunch'), /needs 8,000/);
  const rw = await e.requestReward(e.agents[3].id, 'parking'); assert.equal(rw.status, 'pending');
  const before = e.agents[3].week;
  await e.decideReward(rw.id, 'approved', 'Dana'); assert.equal(e.agents[3].week, before - 1500);
  assert.equal(await e.kudos(e.agents[1].id, 'nice', 'Priya'), true);
  const feed = await e.kudosFeed(5); assert.equal(feed[0].note, 'nice'); assert.equal(feed[0].toName, e.agents[1].name);
  assert.equal(e.stats().escalationRate !== null, true);
});

test('connect: query string beats config, config beats simulator', () => {
  assert.equal(Arena.connect('', {}).remote, false);
  const viaConfig = Arena.connect('', { api: '/api', team: 'Billing team' });
  assert.equal(viaConfig.remote, true); assert.equal(viaConfig.engine.remote, true);
  const viaQuery = Arena.connect('?api=http://x/api&team=Support&agent=a9', { api: '/api', team: 'Billing team' });
  assert.equal(viaQuery.agentId, 'a9');
});

test('simulator fires typed events through the engine', () => {
  const e = Arena.createEngine();
  const s = Arena.createSimulator(e);
  const r = s.fire('autofail', e.agents[1]);
  assert.equal(r.points, -40); assert.equal(e.agents[1].autofails, 1);
  assert.equal(s.fire('kudos', e.agents[1]).event.EventType, 'KUDOS');
  assert.equal(s.running, false);
});

test('customer sentiment and survey scores count as quality and never deduct', () => {
  const m = Arena.DEFAULT_MIX;
  assert.equal(Arena.scoreEvent('SENTIMENT_SCORED', { Sentiment: 3.2 }, m), 8);
  assert.equal(Arena.scoreEvent('SENTIMENT_SCORED', { Sentiment: 1 }, m), 5);
  assert.equal(Arena.scoreEvent('SENTIMENT_SCORED', { Sentiment: -4 }, m), 0);
  assert.equal(Arena.scoreEvent('CSAT_RECEIVED', { Score: 5 }, m), 10);
  assert.equal(Arena.scoreEvent('CSAT_RECEIVED', { Score: 1 }, m), 0);
  const heavy = { quality: 80, productivity: 10, adherence: 10 };
  assert.equal(Arena.scoreEvent('CSAT_RECEIVED', { Score: 5 }, heavy), 16, 'scales with the quality weight');
  assert.equal(Arena.scoreEvent('CONTACT_HANDLED', { HandleTime: 200 }, heavy), 3, 'productivity is scaled separately');
});

test('engine tracks sentiment and survey averages per agent and for the team', () => {
  const e = Arena.createEngine();
  const a = e.agents[0];
  e.ingest({ EventType: 'SENTIMENT_SCORED', AgentARN: a.id, Sentiment: 2 });
  e.ingest({ EventType: 'SENTIMENT_SCORED', AgentARN: a.id, Sentiment: -1 });
  e.ingest({ EventType: 'CSAT_RECEIVED', AgentARN: a.id, Score: 4 });
  assert.equal(e.sentimentAvg(a), 0.5); assert.equal(e.csatAvg(a), 4);
  assert.equal(a.today, 5 + 0 + 6);
  const row = e.leaderboard('today').find((r) => r.agent === a);
  assert.equal(row.sentiment, 0.5); assert.equal(row.csat, 4);
  assert.equal(e.stats().sentiment, 0.5); assert.equal(e.stats().csat, 4);
  assert.equal(e.sentimentAvg(e.agents[1]), null);
});

test('low sentiment flags only with enough analysed contacts', () => {
  const e = Arena.createEngine();
  const a = e.agents[0];
  a.sentCount = 4; a.sentSum = -8;
  assert.deepEqual(Arena.flagsFor(a, e.agents, Date.now()), []);
  a.sentCount = 5; a.sentSum = -6;
  assert.deepEqual(Arena.flagsFor(a, e.agents, Date.now()).map((f) => f.label), ['Customer sentiment low']);
});

test('summarizeRows averages evaluations without auto-fail zeros', () => {
  const s = Arena.summarizeRows([
    { id: 'a', points: 100, handled: 10, ahtSum: 4000, evals: [80, 0, 90], autofails: 1, escalations: 1, sentSum: 6, sentCount: 4, csatSum: 9, csatCount: 2 },
    { id: 'b', points: 50, handled: 0, evals: [] }]);
  assert.equal(s.qa, 85); assert.equal(s.evaluations, 2); assert.equal(s.aht, 400); assert.equal(s.escalationRate, 10);
  assert.equal(s.sentiment, 1.5); assert.equal(s.csat, 4.5); assert.equal(s.activeAgents, 2); assert.equal(s.autofails, 1);
  const empty = Arena.summarizeRows([]);
  assert.equal(empty.qa, null); assert.equal(empty.aht, null); assert.equal(empty.sentiment, null);
});

test('historyReport compares the newest period with the one before it', () => {
  const day = (date, qa, handled) => ({ date, rows: [{ id: 'a', name: 'Priya', points: handled * 10, handled, ahtSum: handled * 300, evals: [qa] }, { id: 'b', name: 'Marcus', points: 5, handled: 1, ahtSum: 500, evals: [] }] });
  const days = [day('2026-09-01', 70, 5), day('2026-09-02', 74, 5), day('2026-09-03', 84, 8), day('2026-09-04', 88, 8)];
  const r = Arena.historyReport(days.slice().reverse(), 2);
  assert.equal(r.from, '2026-09-03'); assert.equal(r.to, '2026-09-04'); assert.equal(r.series.length, 2);
  assert.equal(r.current.qa, 86); assert.equal(r.previous.qa, 72); assert.equal(r.change.qa, 14);
  assert.equal(r.change.handled, 6);
  const priya = r.agents[0];
  assert.equal(priya.name, 'Priya'); assert.equal(priya.qaChange, 14); assert.equal(priya.daysActive, 2);
  assert.equal(r.agents[1].qa, null); assert.equal(r.agents[1].qaChange, null);
});

test('historyReport with no earlier period reports no change rather than a false one', () => {
  const r = Arena.historyReport([{ date: '2026-09-04', rows: [{ id: 'a', points: 10, handled: 1, evals: [90] }] }], 7);
  assert.equal(r.previous, null); assert.equal(r.change.qa, null); assert.equal(r.current.qa, 90);
});

test('local engine: demo history is stable and coaching closes the loop', async () => {
  const e = Arena.seedTeam(Arena.createEngine());
  const r1 = await e.history(14), r2 = await e.history(14);
  assert.deepEqual(r1.current, r2.current); assert.equal(r1.series.length, 14); assert.ok(r1.previous);
  const open = await e.coaching({ status: 'open' });
  assert.equal(open.length, 1); assert.equal(open[0].baseline.qa, 74); assert.ok(open[0].since);
  const kenji = e.agents[9];
  const c = await e.createCoaching({ agentId: kenji.id, reason: 'Volume high, QA low', action: 'Slow down on verification', dueAt: '2026-10-10' });
  assert.equal(c.status, 'open'); assert.equal(c.baseline.qa, 70); assert.equal(c.agentName, kenji.name);
  assert.equal((await e.coaching({ agentId: kenji.id })).length, 1);
  await e.updateCoaching(c.id, { acknowledged: true });
  e.ingest({ EventType: 'EVALUATION_SUBMITTED', AgentARN: kenji.id, Score: 96 });
  const done = await e.updateCoaching(c.id, { status: 'done', outcome: 'Back on track' });
  assert.equal(done.status, 'done'); assert.ok(done.acknowledgedAt); assert.equal(done.result.qa, 78); assert.equal(done.since.qa, 78);
  assert.equal((await e.coaching({ status: 'open' })).length, 1);
  await assert.rejects(() => e.createCoaching({ agentId: 'nobody' }), /unknown agent/);
});

test('kudos: a spike against the team mean is flagged, and the demo refuses self-kudos', async () => {
  const e = Arena.createEngine();
  const a = e.agents[0];
  a.kudosReceived = 5;
  assert.deepEqual(Arena.flagsFor(a, e.agents, Date.now()), [], 'five is under the threshold');
  a.kudosReceived = 6;
  assert.deepEqual(Arena.flagsFor(a, e.agents, Date.now()).map((f) => f.label), ['Kudos volume unusual']);
  e.agents.forEach((x) => { x.kudosReceived = 6; });
  assert.deepEqual(Arena.flagsFor(a, e.agents, Date.now()), [], 'not unusual when the whole team is at six');
  assert.equal(await e.kudos(a.id, 'to myself', a.name, a.id), false);
  assert.equal(await e.kudos(e.agents[1].id, 'to a teammate', a.name, a.id), true);
});

test('schedule adherence scores per adherent hour, weighted by the adherence slider, and never deducts', () => {
  const m = Arena.DEFAULT_MIX;
  assert.equal(Arena.scoreEvent('ADHERENCE_SCORED', { Adherence: 93, AdherentHours: 7.4 }, m), 37);
  assert.equal(Arena.scoreEvent('ADHERENCE_SCORED', { Adherence: 40, AdherentHours: 0 }, m), 0);
  assert.equal(Arena.scoreEvent('ADHERENCE_SCORED', { Adherence: 93, AdherentHours: 8 }, { quality: 50, productivity: 20, adherence: 30 }), 80);
  assert.equal(Arena.metricOf('adherence', { adhSum: 187, adhCount: 2 }), 93.5);
  assert.equal(Arena.metricOf('adherence', {}), null);
  assert.equal(Arena.METRICS.adherence.fmt(93.5), '94%');
  const t = Arena.summarizeRows([{ points: 1, adhSum: 90, adhCount: 1, adherenceHours: 7 }, { points: 1, adhSum: 80, adhCount: 1, adherenceHours: 6.5 }]);
  assert.equal(t.adherence, 85); assert.equal(t.adherenceHours, 13.5);
});

test('reward budget maths', () => {
  assert.deepEqual(Arena.budgetSummary(10000, 2500, '2026-10'), { month: '2026-10', monthly: 10000, spent: 2500, remaining: 7500, pct: 25, capped: true });
  assert.deepEqual(Arena.budgetSummary(0, 2500, '2026-10'), { month: '2026-10', monthly: 0, spent: 2500, remaining: null, pct: 0, capped: false });
  assert.deepEqual(Arena.budgetAlerts(10000, 2500, []), [25]);
  assert.deepEqual(Arena.budgetAlerts(10000, 7600, [25, 50]), [75]);
  assert.deepEqual(Arena.budgetAlerts(10000, 12000, [25, 50, 75]), [100]);
  assert.deepEqual(Arena.budgetAlerts(0, 12000, []), []);
});
