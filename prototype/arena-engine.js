/*
 * Arena scoring engine.
 * Shared by the agent panel, supervisor console and wallboard.
 * Plain script: defines window.Arena in a browser, module.exports in node.
 *
 * Events mirror what Amazon Connect emits so the browser simulator and a
 * real Kinesis/S3 consumer feed the same code path:
 *   CONTACT_HANDLED        from a contact record        { HandleTime, Queue }
 *   EVALUATION_SUBMITTED   from Contact Lens evaluation { Score, AutoFail }
 *   AGENT_STATE_CHANGE     from the agent event stream  { State }
 *   KUDOS                  app-native                   { From, Note }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Arena = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Configuration ----------
  const DEFAULT_MIX = { quality: 50, productivity: 35, adherence: 15 };
  const QUALITY_FLOOR = 40; // below this the mix is accepted but warned: agents can win by rushing

  // Base points at the default mix. The mix scales each family up or down.
  const BASE = {
    contact: (aht) => (aht <= 360 ? 12 : aht <= 540 ? 10 : 6),
    evaluation: (pct) => (pct >= 95 ? 30 : pct >= 85 ? 20 : pct >= 70 ? 10 : 0),
    adherenceHour: 5,
    autofail: -40, // never scaled: a fail is a fail
    kudos: 8,
    streakDay: 25,
  };

  const LEVELS = [
    { at: 0, name: 'Rookie' }, { at: 150, name: 'Starter' }, { at: 400, name: 'Steady' },
    { at: 800, name: 'Resolver' }, { at: 1400, name: 'Closer' }, { at: 2200, name: 'Anchor' }, { at: 3300, name: 'Legend' },
  ];

  const BADGES = [
    { id: 'streak7', name: '7-day streak', test: (a) => a.streak >= 7 },
    { id: 'first95', name: 'First 95', test: (a) => a.evals.some((e) => e >= 95) },
    { id: 'fifty', name: '50 contacts', test: (a) => a.handled >= 50 },
    { id: 'team', name: 'Team player', test: (a) => a.kudosReceived >= 1 },
    { id: 'clean', name: 'Zero escalations', test: (a) => a.handled >= 10 && a.escalations === 0 },
  ];

  const FLAGS = {
    quietMinutes: 40,
    volumeRatio: 1.6, // contacts handled vs team mean
    lowQa: 75,
  };

  // Challenge templates. Progress is always computed from agent data, never self-reported.
  const TEMPLATES = {
    esc: { title: 'Keep escalations under target', unit: '%', defaultTarget: 5, reward: 150, needs: 'contacts' },
    qa: { title: 'Every evaluation at or above a score', unit: 'score', defaultTarget: 85, reward: 100, needs: 'evaluations' },
    contest: { title: 'Team points target', unit: 'pts', defaultTarget: 1000, reward: 250, needs: 'points' },
    kudos: { title: 'Kudos received per agent', unit: 'each', defaultTarget: 3, reward: 50, needs: 'kudos' },
    fcr: { title: 'First-contact resolution on a queue', unit: '%', defaultTarget: 80, reward: 150, needs: 'contact lens categories (not yet fed)' },
  };

  // What points buy. Cost is in points; the supervisor approves each redemption.
  const CATALOG = [
    { id: 'gift25', name: '$25 gift card', cost: 2500 },
    { id: 'halfday', name: 'Half-day Friday', cost: 5000 },
    { id: 'lunch', name: 'Team lunch (team pool)', cost: 8000 },
    { id: 'parking', name: 'Prime parking spot, one week', cost: 1500 },
  ];

  /** Measure a challenge against the current team. Pure: same function runs in the browser and in the API. */
  function challengeProgress(ch, agents) {
    const t = Number(String(ch.target).replace(/[^0-9.]/g, '')) || 0;
    const handled = agents.reduce((s, a) => s + (a.handled || 0), 0);
    const esc = agents.reduce((s, a) => s + (a.escalations || 0), 0);
    const points = agents.reduce((s, a) => s + (a.today || 0), 0);
    const clamp = (x) => Math.max(0, Math.min(1, x));
    switch (ch.template) {
      case 'esc': { const rate = handled ? (esc / handled) * 100 : 0; return { value: rate.toFixed(1) + '%', label: handled ? rate.toFixed(1) + '% now' : 'no contacts yet', progress: handled ? clamp(1 - rate / Math.max(t, 0.1)) : 0, onTrack: rate <= t, measured: handled > 0 }; }
      case 'qa': { const withEvals = agents.filter((a) => (a.evals || []).some((e) => e > 0)); const clean = withEvals.filter((a) => a.evals.filter((e) => e > 0).every((e) => e >= t)); return { value: `${clean.length}/${withEvals.length}`, label: withEvals.length ? `${clean.length} of ${withEvals.length} agents clean` : 'no evaluations yet', progress: withEvals.length ? clean.length / withEvals.length : 0, onTrack: withEvals.length > 0 && clean.length === withEvals.length, measured: withEvals.length > 0 }; }
      case 'contest': return { value: points.toLocaleString(), label: `${points.toLocaleString()} of ${t.toLocaleString()} pts`, progress: t ? clamp(points / t) : 0, onTrack: points >= t, measured: true };
      case 'kudos': { const met = agents.filter((a) => (a.kudosReceived || 0) >= t).length; return { value: `${met}/${agents.length}`, label: `${met} of ${agents.length} agents at ${t}+`, progress: agents.length ? met / agents.length : 0, onTrack: agents.length > 0 && met === agents.length, measured: true }; }
      default: return { value: '—', label: 'needs ' + (TEMPLATES[ch.template] ? TEMPLATES[ch.template].needs : 'data'), progress: 0, onTrack: false, measured: false };
    }
  }

  const NAMES = ['Priya Natarajan', 'Marcus Bell', 'Aisha Rahman', 'Diego Fuentes', 'Hannah Kim', 'Tomás Reyes',
    'Grace Achieng', "Liam O'Neill", 'Sofia Rossi', 'Kenji Watanabe', 'Zara Malik', 'Ethan Cole'];
  const HUES = [172, 28, 262, 200, 340, 96, 48, 300, 12, 220, 150, 80];

  // ---------- Helpers ----------
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const initials = (n) => n.split(' ').map((w) => w[0]).join('').slice(0, 2);

  function makeAgent(i, name, hue, seed) {
    return Object.assign({
      id: 'agent-' + i, name, hue, initials: initials(name),
      today: 0, week: 0, handled: 0, ahtSum: 0, evals: [], autofails: 0,
      kudosReceived: 0, escalations: 0, streak: 0, adherenceHours: 0,
      lastEvent: Date.now(), state: 'Available',
    }, seed || {});
  }

  function scoreEvent(type, data, mix) {
    const q = mix.quality / DEFAULT_MIX.quality;
    const p = mix.productivity / DEFAULT_MIX.productivity;
    const a = mix.adherence / DEFAULT_MIX.adherence;
    switch (type) {
      case 'CONTACT_HANDLED': return Math.round(BASE.contact(data.HandleTime) * p);
      case 'EVALUATION_SUBMITTED': return data.AutoFail ? BASE.autofail : Math.round(BASE.evaluation(data.Score) * q);
      case 'ADHERENCE_HOUR': return Math.round(BASE.adherenceHour * a);
      case 'KUDOS': return BASE.kudos;
      case 'STREAK_DAY': return BASE.streakDay;
      default: return 0;
    }
  }

  function validateMix(mix) {
    const sum = mix.quality + mix.productivity + mix.adherence;
    if (sum !== 100) return { ok: false, message: `Weights add to ${sum}%. They need to add to 100% before saving.` };
    if (mix.quality < QUALITY_FLOOR) return { ok: true, message: `Quality under ${QUALITY_FLOOR}% lets agents win by rushing. Recommended: 50% or more.` };
    return { ok: true, message: '' };
  }

  function levelFor(points) {
    let i = LEVELS.length - 1;
    while (i > 0 && points < LEVELS[i].at) i--;
    const cur = LEVELS[i], next = LEVELS[i + 1] || null;
    const lo = cur.at, hi = next ? next.at : cur.at + 1000;
    return {
      index: i + 1, name: cur.name, next: next ? next.name : null,
      toNext: next ? next.at - points : 0,
      progress: Math.min(1, (points - lo) / (hi - lo)),
    };
  }

  const qaAvg = (agent) => { const e = agent.evals.filter((x) => x > 0); return e.length ? Math.round(mean(e)) : null; };
  const aht = (agent) => (agent.handled ? Math.round(agent.ahtSum / agent.handled) : 0);
  const badgesFor = (agent) => BADGES.map((b) => ({ id: b.id, name: b.name, earned: !!b.test(agent) }));

  function flagsFor(agent, team, now) {
    now = now || Date.now();
    const out = [];
    const quietMs = now - agent.lastEvent;
    const teamMean = mean(team.map((t) => t.handled)) || 0;
    const q = qaAvg(agent);
    if (agent.state === 'Available' && quietMs > FLAGS.quietMinutes * 60000)
      out.push({ level: 'quiet', label: `Quiet ${Math.round(quietMs / 60000)} min`, why: `No agent events for ${FLAGS.quietMinutes}+ minutes while in Available state.` });
    if (agent.handled > teamMean * FLAGS.volumeRatio && q !== null && q < FLAGS.lowQa)
      out.push({ level: 'warn', label: 'Volume high, QA low', why: `${agent.handled} contacts at ${aht(agent)}s AHT with ${q}% QA. Possible rushing. Review a sample.` });
    if (agent.autofails > 0)
      out.push({ level: 'bad', label: 'Auto-fail today', why: `${agent.autofails} evaluation auto-fail${agent.autofails > 1 ? 's' : ''}. ${-BASE.autofail} pts removed each. Coaching note suggested.` });
    return out;
  }

  // ---------- Engine ----------
  function createEngine(opts) {
    opts = opts || {};
    let mix = Object.assign({}, DEFAULT_MIX, opts.mix || {});
    const agents = opts.agents || NAMES.map((n, i) => makeAgent(i, n, HUES[i]));
    const listeners = [];
    const byId = (id) => agents.find((a) => a.id === id);
    // In-memory challenges, rewards and kudos feed. The remote engine replaces these with API calls.
    const local = { challenges: [], rewards: [], kudos: [] };
    const newId = () => Math.random().toString(36).slice(2, 10);
    const withProgress = (ch) => Object.assign({}, ch, { progress: challengeProgress(ch, agents) });

    function ingest(ev) {
      const agent = byId(ev.AgentARN || ev.agentId);
      if (!agent) return null;
      const type = ev.EventType;
      const pts = scoreEvent(type, ev, mix);
      agent.lastEvent = ev.EventTimestamp ? Date.parse(ev.EventTimestamp) : Date.now();
      if (type === 'CONTACT_HANDLED') { agent.handled++; agent.ahtSum += ev.HandleTime || 0; if (ev.Escalated) agent.escalations++; }
      if (type === 'EVALUATION_SUBMITTED') { if (ev.AutoFail) { agent.autofails++; agent.evals.push(0); } else agent.evals.push(ev.Score); }
      if (type === 'KUDOS') { agent.kudosReceived++; local.kudos.unshift({ at: ev.EventTimestamp || new Date().toISOString(), from: ev.From, to: agent.id, toName: agent.name, note: ev.Note }); local.kudos.length = Math.min(local.kudos.length, 50); }
      if (type === 'ADHERENCE_HOUR') agent.adherenceHours++;
      if (type === 'AGENT_STATE_CHANGE') agent.state = ev.State;
      agent.today += pts; agent.week += pts;
      const result = { event: ev, agent, points: pts, words: describe(type, ev) };
      listeners.forEach((fn) => fn(result));
      return result;
    }

    function describe(type, ev) {
      if (type === 'CONTACT_HANDLED') return `Handled <b>${ev.Queue || 'a'}</b> contact, ${Math.round((ev.HandleTime || 0) / 60)} min`;
      if (type === 'EVALUATION_SUBMITTED') return ev.AutoFail ? `Evaluation <b>auto-fail</b>: ${ev.Reason || 'policy'}` : `Evaluation scored <b>${ev.Score}%</b>`;
      if (type === 'KUDOS') return `Kudos from <b>${ev.From}</b>: “${ev.Note}”`;
      if (type === 'ADHERENCE_HOUR') return 'Hour in adherence';
      if (type === 'STREAK_DAY') return `Streak bonus, day ${ev.Day}`;
      return type;
    }

    function leaderboard(range) {
      const key = range === 'week' ? 'week' : 'today';
      return [...agents].sort((a, b) => b[key] - a[key]).map((a, i) => Object.assign({ rank: i + 1, points: a[key], qa: qaAvg(a), aht: aht(a) }, { agent: a }));
    }

    function stats() {
      const qs = agents.map(qaAvg).filter((x) => x !== null);
      const handled = agents.reduce((s, a) => s + a.handled, 0), esc = agents.reduce((s, a) => s + (a.escalations || 0), 0);
      return {
        agents: agents.length,
        online: agents.filter((a) => a.state !== 'Offline').length,
        points: agents.reduce((s, a) => s + a.today, 0),
        handled, escalations: esc,
        escalationRate: handled ? (esc / handled) * 100 : null,   // percent, null until a contact exists
        qa: qs.length ? Math.round(mean(qs)) : null,
        flagged: agents.flatMap((a) => flagsFor(a, agents)).length,
      };
    }

    // ---- challenges, rewards, kudos (local implementations; same names on the remote engine) ----
    const challenges = async () => local.challenges.map(withProgress);
    const createChallenge = async (ch) => {
      const t = TEMPLATES[ch.template] || TEMPLATES.contest;
      const now = new Date().toISOString().slice(0, 10);
      const c = { id: newId(), template: ch.template, title: ch.title || t.title, scope: ch.scope || 'Team', target: ch.target != null ? ch.target : t.defaultTarget,
        reward: ch.reward != null ? ch.reward : t.reward, startsAt: ch.startsAt || now, endsAt: ch.endsAt || now, createdAt: new Date().toISOString(), createdBy: ch.createdBy || 'supervisor' };
      c.state = c.startsAt > now ? 'scheduled' : 'active';
      local.challenges.push(c); return withProgress(c);
    };
    const endChallenge = async (id) => { const c = local.challenges.find((x) => x.id === id); if (c) c.state = 'ended'; return c; };
    const rewards = async (status) => local.rewards.filter((r) => !status || r.status === status);
    const requestReward = async (agentId, catalogId, by) => {
      const a = byId(agentId), item = CATALOG.find((c) => c.id === catalogId);
      if (!a || !item) throw new Error('unknown agent or reward');
      if (a.week < item.cost) throw new Error(`needs ${item.cost.toLocaleString()} pts, has ${a.week.toLocaleString()}`);
      const r = { id: newId(), agentId, agentName: a.name, catalogId, what: item.name, cost: item.cost, status: 'pending', requestedAt: new Date().toISOString(), requestedBy: by || a.name };
      local.rewards.unshift(r); return r;
    };
    const decideReward = async (id, status, by) => { const r = local.rewards.find((x) => x.id === id); if (!r) throw new Error('unknown reward'); r.status = status; r.decidedAt = new Date().toISOString(); r.decidedBy = by || 'supervisor'; if (status === 'approved') { const a = byId(r.agentId); if (a) a.week -= r.cost; } return r; };
    const kudosFeed = async (limit) => local.kudos.slice(0, limit || 10);

    function preview(m) {
      return {
        eval90: scoreEvent('EVALUATION_SUBMITTED', { Score: 90 }, m),
        contact7min: scoreEvent('CONTACT_HANDLED', { HandleTime: 420 }, m),
        autofail: BASE.autofail,
        adherenceHour: scoreEvent('ADHERENCE_HOUR', {}, m),
      };
    }

    return {
      agents, byId, ingest,
      on: (fn) => listeners.push(fn),
      leaderboard, stats, preview,
      getMix: () => Object.assign({}, mix),
      setMix: (m) => { const v = validateMix(m); if (v.ok) mix = Object.assign({}, m); return v; },
      flags: (a) => flagsFor(a, agents),
      badges: badgesFor, level: (a) => levelFor(a.week), qaAvg, aht,
      challenges, createChallenge, endChallenge, rewards, requestReward, decideReward, kudosFeed,
      kudos: async (to, note, from) => { const a = byId(to); if (!a) return false; ingest({ EventType: 'KUDOS', AgentARN: to, EventTimestamp: new Date().toISOString(), From: from || 'A teammate', Note: note }); return true; },
      _local: local,
    };
  }

  // ---------- Simulator: stands in for Kinesis + S3 until the real feed exists ----------
  function createSimulator(engine, opts) {
    opts = opts || {};
    let timer = null, perTenSeconds = opts.rate || 4, exclude = opts.exclude || [];
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const queues = ['Billing', 'Support', 'Retention'];
    const notes = ['great save', 'thanks for the handoff', 'nice de-escalation', 'carried the queue', 'calm under pressure'];

    function fire(type, agent) {
      agent = agent || pick(engine.agents.filter((a) => !exclude.includes(a.id)));
      const base = { AgentARN: agent.id, EventTimestamp: new Date().toISOString() };
      if (type === 'contact') return engine.ingest(Object.assign(base, { EventType: 'CONTACT_HANDLED', Queue: pick(queues), HandleTime: 200 + Math.floor(Math.random() * 500), Escalated: Math.random() < 0.04 }));
      if (type === 'eval') return engine.ingest(Object.assign(base, { EventType: 'EVALUATION_SUBMITTED', Score: 70 + Math.floor(Math.random() * 30) }));
      if (type === 'autofail') return engine.ingest(Object.assign(base, { EventType: 'EVALUATION_SUBMITTED', AutoFail: true, Reason: 'missed verification' }));
      if (type === 'kudos') { const from = pick(engine.agents.filter((a) => a.id !== agent.id)); return engine.ingest(Object.assign(base, { EventType: 'KUDOS', From: opts.fullNames ? from.name : from.name.split(' ')[0], Note: pick(notes) })); }
      return null;
    }
    function tick() { const r = Math.random(); fire(r < 0.6 ? 'contact' : r < 0.85 ? 'eval' : r < 0.96 ? 'kudos' : 'autofail'); }
    function start() { stop(); timer = setInterval(tick, 10000 / perTenSeconds); }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    return { fire, start, stop, setRate: (r) => { perTenSeconds = r; if (timer) start(); }, get running() { return !!timer; } };
  }

  // Deterministic-ish seed so every page opens with the same stories in it.
  function seedTeam(engine, now) {
    now = now || Date.now();
    engine.agents.forEach((a, i) => {
      a.today = 60 + ((i * 37) % 120); a.week = 700 + ((i * 131) % 500);
      a.handled = 4 + (i % 6); a.ahtSum = a.handled * (300 + (i * 23) % 200); a.evals = [80 + (i * 7) % 15];
      a.lastEvent = now - ((i * 5) % 20) * 60000; a.streak = 3 + (i % 5);
    });
    const you = engine.agents[0]; you.today = 118; you.evals = [92]; you.streak = 7; you.kudosReceived = 1;
    const liam = engine.agents[7]; liam.lastEvent = now - 52 * 60000;
    const kenji = engine.agents[9]; kenji.handled = 19; kenji.ahtSum = 19 * 170; kenji.evals = [68, 71]; kenji.today = 190;
    const hannah = engine.agents[4]; hannah.autofails = 1; hannah.evals = [0, 88];
    // Demo challenges, rewards and kudos so every page opens with something to show.
    const today = new Date(now).toISOString().slice(0, 10), fri = new Date(now + 4 * 86400000).toISOString().slice(0, 10), mon = new Date(now + 6 * 86400000).toISOString().slice(0, 10);
    engine._local.challenges.push(
      { id: 'c-esc', template: 'esc', title: 'Billing queue: keep escalations under 5%', scope: 'Team', target: 5, reward: 150, startsAt: today, endsAt: fri, state: 'active', createdAt: new Date(now).toISOString() },
      { id: 'c-qa', template: 'qa', title: 'Every evaluation 85 or better', scope: 'Individual, opt-in', target: 85, reward: 100, startsAt: today, endsAt: fri, state: 'active', createdAt: new Date(now).toISOString() },
      { id: 'c-contest', template: 'contest', title: 'Billing vs Support: most points', scope: 'Head-to-head', target: 2000, reward: 250, startsAt: mon, endsAt: mon, state: 'scheduled', createdAt: new Date(now).toISOString() });
    engine.agents[2].week = 2600; engine.agents[3].week = 5200; engine.agents[3].escalations = 1;
    engine._local.rewards.push(
      { id: 'r1', agentId: engine.agents[2].id, agentName: engine.agents[2].name, catalogId: 'gift25', what: '$25 gift card', cost: 2500, status: 'pending', requestedAt: new Date(now - 3600000).toISOString() },
      { id: 'r2', agentId: engine.agents[3].id, agentName: engine.agents[3].name, catalogId: 'halfday', what: 'Half-day Friday', cost: 5000, status: 'pending', requestedAt: new Date(now - 7200000).toISOString() });
    engine._local.kudos.push(
      { at: new Date(now - 1200000).toISOString(), from: 'Marcus Bell', to: engine.agents[6].id, toName: engine.agents[6].name, note: 'took my overflow call' },
      { at: new Date(now - 2400000).toISOString(), from: 'Supervisor Dana', to: you.id, toName: you.name, note: 'calm under pressure' });
    return engine;
  }

  // ---------- Remote engine: same interface as createEngine, data from the Arena API ----------
  // Pages call Arena.connect() and get either a local simulated engine or a polling remote one,
  // depending on ?api=<base url>&team=<routing profile>[&agent=<arn>][&token=<jwt>] in the page URL.
  function createRemoteEngine(opts) {
    const base = opts.api.replace(/\/$/, ''), team = opts.team || 'unassigned';
    // Token comes from a static value or, when sign-in is configured, from a provider that can refresh it.
    const tokenProvider = opts.tokenProvider || (async () => opts.token || null);
    // Every call waits for sign-in to finish first, so nothing fires during the token exchange.
    const headersFor = async () => { if (opts.ready) await opts.ready(); const t = await tokenProvider(); return Object.assign({ 'content-type': 'application/json' }, t ? { authorization: 'Bearer ' + t } : {}); };
    const engine = createEngine({ agents: [] });
    const listeners = [];
    let mix = Object.assign({}, DEFAULT_MIX), lastSeen = {}, timer = null;
    const hueFor = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

    async function refresh() {
      const r = await fetch(`${base}/teams/${encodeURIComponent(team)}/agents`, { headers: await headersFor() });
      if (!r.ok) throw new Error('arena api ' + r.status);
      const body = await r.json();
      engine.agents.length = 0;
      for (const a of body.agents) { a.hue = hueFor(a.id); a.initials = initials(a.name || '?'); engine.agents.push(a); }
      // The signed-in agent may have no rows yet (nothing scored today). Show them at zero rather than nothing.
      const self = typeof opts.self === 'function' ? opts.self() : opts.self;
      if (self && self.id && !engine.agents.some((a) => a.id === self.id)) {
        engine.agents.push(makeAgent(engine.agents.length, self.name || self.id.split('/').pop(), hueFor(self.id), { id: self.id, team, lastEvent: 0, state: 'Offline', placeholder: true }));
      }
      for (const a of engine.agents) {
        const prev = lastSeen[a.id];
        if (prev !== undefined && prev !== a.today) listeners.forEach((fn) => fn({ agent: a, points: a.today - prev, event: { EventType: 'REFRESH', AgentARN: a.id }, words: 'Points updated' }));
        lastSeen[a.id] = a.today;
      }
      return engine.agents;
    }
    async function events(agentId, limit) {
      const r = await fetch(`${base}/agents/${encodeURIComponent(agentId)}/events?limit=${limit || 10}`, { headers: await headersFor() });
      return r.ok ? (await r.json()).events : [];
    }
    async function loadMix() { const r = await fetch(`${base}/config/mix`, { headers: await headersFor() }); if (r.ok) mix = (await r.json()).mix; return mix; }
    async function saveMix(m) {
      const r = await fetch(`${base}/config/mix`, { method: 'PUT', headers: await headersFor(), body: JSON.stringify(m) });
      const body = await r.json();
      if (r.ok) mix = body.mix;
      return { ok: r.ok, message: body.error || body.warning || '' };
    }
    async function kudos(to, note) { const a = engine.byId(to); const r = await fetch(`${base}/kudos`, { method: 'POST', headers: await headersFor(), body: JSON.stringify({ to, note, team, toName: a && a.name, toUsername: a && a.username }) }); return r.ok; }
    const teamPath = () => `${base}/teams/${encodeURIComponent(team)}`;
    async function call(method, path, body) {
      const r = await fetch(path, { method, headers: await headersFor(), body: body ? JSON.stringify(body) : undefined });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ('arena api ' + r.status));
      return data;
    }
    const challenges = async () => (await call('GET', `${teamPath()}/challenges`)).challenges;
    const createChallenge = async (ch) => (await call('POST', `${teamPath()}/challenges`, ch)).challenge;
    const endChallenge = async (id) => (await call('PUT', `${teamPath()}/challenges/${encodeURIComponent(id)}`, { state: 'ended' })).challenge;
    const rewards = async (status) => (await call('GET', `${teamPath()}/rewards${status ? '?status=' + status : ''}`)).rewards;
    const requestReward = async (agentId, catalogId) => (await call('POST', `${teamPath()}/rewards`, { agentId, catalogId })).reward;
    const decideReward = async (id, status) => (await call('PUT', `${teamPath()}/rewards/${encodeURIComponent(id)}`, { status })).reward;
    const kudosFeed = async (limit) => (await call('GET', `${teamPath()}/kudos?limit=${limit || 10}`)).kudos;
    async function start(seconds) { stop(); if (opts.ready) await opts.ready(); timer = setInterval(() => refresh().catch(console.error), (seconds || 5) * 1000); return refresh(); }
    function stop() { if (timer) clearInterval(timer); timer = null; }

    return Object.assign({}, engine, {
      remote: true, team, refresh, events, loadMix, saveMix, kudos, start, stop,
      challenges, createChallenge, endChallenge, rewards, requestReward, decideReward, kudosFeed,
      on: (fn) => listeners.push(fn),
      getMix: () => Object.assign({}, mix),
      setMix: (m) => { const v = validateMix(m); if (v.ok) saveMix(m); return v; },
      ingest: () => { throw new Error('remote engine is read-only; events arrive from the stream'); },
    });
  }

  // Query string wins, then window.ARENA_CONFIG (written by config.js at deploy time), then the simulator.
  function connect(search, config, auth) {
    const p = new URLSearchParams(search !== undefined ? search : (typeof location !== 'undefined' ? location.search : ''));
    const c = config || (typeof window !== 'undefined' && window.ARENA_CONFIG) || {};
    const a = auth || (typeof ArenaAuth !== 'undefined' ? ArenaAuth : null);
    const signedIn = !!(a && c.auth && a.enabled());
    const api = p.get('api') || c.api, token = p.get('token') || c.token;
    if (api) {
      // With sign-in, identity and team come from the token's custom claims unless the URL overrides them.
      const claims = () => (signedIn && a.claims()) || {};
      const engine = createRemoteEngine({ api, token, tokenProvider: signedIn ? () => a.token() : undefined, ready: signedIn ? () => a.ready() : undefined,
        get team() { return p.get('team') || c.team || claims()['custom:team'] || 'unassigned'; },
        self: () => { const cl = claims(); const id = p.get('agent') || c.agent || cl['custom:agentArn']; return id ? { id, name: cl.name || cl['cognito:username'] || undefined } : null; } });
      return { engine, remote: true, signedIn, get agentId() { return p.get('agent') || c.agent || claims()['custom:agentArn'] || null; },
        get isSupervisor() { return signedIn ? a.isSupervisor(claims()) : true; } };
    }
    const engine = seedTeam(createEngine());
    return { engine, agentId: engine.agents[0].id, remote: false };
  }

  return { createEngine, createRemoteEngine, connect, createSimulator, seedTeam, scoreEvent, validateMix, levelFor, flagsFor, badgesFor, challengeProgress,
    DEFAULT_MIX, QUALITY_FLOOR, BASE, LEVELS, BADGES, FLAGS, TEMPLATES, CATALOG, NAMES, HUES };
});
