/*
 * Arena read/write API. One Lambda behind an HTTP API (payload v2).
 *
 *   GET  /teams/{team}/agents?date=YYYY-MM-DD   agents in engine shape (today + week + live), for all three pages
 *   GET  /agents/{arn}/events?limit=20          points ledger for the agent panel feed
 *   GET  /config/mix                            scoring mix
 *   PUT  /config/mix                            { quality, productivity, adherence } validated by the engine
 *   POST /kudos                                 { to, from, note, team } scores and stores a KUDOS event
 *   GET  /teams/{team}/history?days=30          results report: this period against the one before (supervisors)
 *   GET  /teams/{team}/coaching                 coaching plans; agents see only their own, without the supervisor's private note
 *   POST /teams/{team}/coaching                 { agentId, reason, note, action, dueAt } opens a plan with a 14-day baseline (supervisors)
 *   PUT  /teams/{team}/coaching/{id}            supervisors edit or close; the agent may only acknowledge
 *   POST /teams/{team}/metrics                  { agentId, metric: csat|sentiment, score, contactId? } for survey tools without a stream (supervisors)
 *   GET/PUT /teams/{team}/notifications         Slack and Teams webhooks, digest email and hour, event switches (supervisors)
 *   POST /teams/{team}/notifications/test       posts "Arena connected" to the configured channels (supervisors)
 *   GET/PUT /teams/{team}/budget                monthly reward budget in points; approvals stop at the cap, alerts at 25/50/75/100% (supervisors)
 *   Days, weeks and months are calendar periods in the stack's Timezone (clock.js).
 *   Challenges run over their whole period; races, duels and team-vs-team carry standings; ending one freezes results and pays prizes.
 *
 * Auth: HTTP API JWT authorizer (Cognito or the customer's IdP) is configured in the template.
 * The workspace app sends the agent's token; the API trusts the token's claims, never a body field, for identity.
 * Supervisors (group "supervisors") may read and act on any team. Everyone else is scoped to the team in their
 * custom:team claim and to their own ledger (custom:agentArn). Kudos are capped per sender per day and may not
 * be sent to oneself or outside the sender's team. Wallboard (kiosk) responses shorten names per DISPLAY_NAMES.
 */
'use strict';
const Arena = require('./arena-engine.js');
const store = require('./store.js');
const notify = require('./notify.js');
const challenges = require('./challenges.js');
const clock = require('./clock.js');

const ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const KUDOS_DAILY_LIMIT = Math.max(1, +(process.env.KUDOS_DAILY_LIMIT || 5));
const DISPLAY_NAMES = process.env.DISPLAY_NAMES || 'full';   // full | first | initials, for sign-in-free wallboards
const json = (status, body) => ({ statusCode: status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': ORIGIN, 'cache-control': 'no-store' }, body: JSON.stringify(body) });

function route(method, path) {
  const m = (re) => path.match(re);
  let x;
  if (method === 'GET' && (x = m(/^\/teams\/([^/]+)\/agents$/))) return { name: 'teamAgents', team: decodeURIComponent(x[1]) };
  if (method === 'GET' && (x = m(/^\/teams\/([^/]+)\/challenges$/))) return { name: 'listChallenges', team: decodeURIComponent(x[1]) };
  if (method === 'POST' && (x = m(/^\/teams\/([^/]+)\/challenges$/))) return { name: 'createChallenge', team: decodeURIComponent(x[1]) };
  if (method === 'PUT' && (x = m(/^\/teams\/([^/]+)\/challenges\/([^/]+)$/))) return { name: 'updateChallenge', team: decodeURIComponent(x[1]), id: decodeURIComponent(x[2]) };
  if (method === 'GET' && (x = m(/^\/teams\/([^/]+)\/rewards$/))) return { name: 'listRewards', team: decodeURIComponent(x[1]) };
  if (method === 'POST' && (x = m(/^\/teams\/([^/]+)\/rewards$/))) return { name: 'requestReward', team: decodeURIComponent(x[1]) };
  if (method === 'PUT' && (x = m(/^\/teams\/([^/]+)\/rewards\/([^/]+)$/))) return { name: 'decideReward', team: decodeURIComponent(x[1]), id: decodeURIComponent(x[2]) };
  if (method === 'GET' && (x = m(/^\/teams\/([^/]+)\/kudos$/))) return { name: 'kudosFeed', team: decodeURIComponent(x[1]) };
  if (method === 'GET' && (x = m(/^\/teams\/([^/]+)\/kiosk$/))) return { name: 'listKiosk', team: decodeURIComponent(x[1]) };
  if (method === 'POST' && (x = m(/^\/teams\/([^/]+)\/kiosk$/))) return { name: 'createKiosk', team: decodeURIComponent(x[1]) };
  if (method === 'DELETE' && (x = m(/^\/teams\/([^/]+)\/kiosk\/([^/]+)$/))) return { name: 'revokeKiosk', team: decodeURIComponent(x[1]), token: decodeURIComponent(x[2]) };
  if (method === 'GET' && (x = m(/^\/teams\/([^/]+)\/history$/))) return { name: 'history', team: decodeURIComponent(x[1]) };
  if (method === 'GET' && (x = m(/^\/teams\/([^/]+)\/coaching$/))) return { name: 'listCoaching', team: decodeURIComponent(x[1]) };
  if (method === 'POST' && (x = m(/^\/teams\/([^/]+)\/coaching$/))) return { name: 'createCoaching', team: decodeURIComponent(x[1]) };
  if (method === 'PUT' && (x = m(/^\/teams\/([^/]+)\/coaching\/([^/]+)$/))) return { name: 'updateCoaching', team: decodeURIComponent(x[1]), id: decodeURIComponent(x[2]) };
  if (method === 'POST' && (x = m(/^\/teams\/([^/]+)\/metrics$/))) return { name: 'recordMetric', team: decodeURIComponent(x[1]) };
  if (method === 'GET' && (x = m(/^\/teams\/([^/]+)\/notifications$/))) return { name: 'getNotify', team: decodeURIComponent(x[1]) };
  if (method === 'PUT' && (x = m(/^\/teams\/([^/]+)\/notifications$/))) return { name: 'putNotify', team: decodeURIComponent(x[1]) };
  if (method === 'POST' && (x = m(/^\/teams\/([^/]+)\/notifications\/test$/))) return { name: 'testNotify', team: decodeURIComponent(x[1]) };
  if (method === 'GET' && (x = m(/^\/teams\/([^/]+)\/budget$/))) return { name: 'getBudget', team: decodeURIComponent(x[1]) };
  if (method === 'PUT' && (x = m(/^\/teams\/([^/]+)\/budget$/))) return { name: 'putBudget', team: decodeURIComponent(x[1]) };
  if (method === 'DELETE' && (x = m(/^\/agents\/(.+)$/))) return { name: 'deleteAgent', arn: decodeURIComponent(x[1]) };
  // Kiosk: unauthenticated at the gateway, the token is the credential. Read-only, wallboard only.
  if (method === 'GET' && (x = m(/^\/kiosk\/([^/]+)\/(agents|challenges|kudos)$/))) return { name: 'kiosk', token: decodeURIComponent(x[1]), what: x[2] };
  if (method === 'GET' && (x = m(/^\/agents\/(.+)\/events$/))) return { name: 'agentEvents', arn: decodeURIComponent(x[1]) };
  if (method === 'GET' && path === '/config/mix') return { name: 'getMix' };
  if (method === 'PUT' && path === '/config/mix') return { name: 'putMix' };
  if (method === 'POST' && path === '/kudos') return { name: 'kudos' };
  if (method === 'GET' && path === '/health') return { name: 'health' };
  return null;
}

function makeHandler(deps) {
  const s = deps.store || store, now = deps.now || (() => new Date());
  const sendFn = deps.send || notify.send;
  // Fire-and-forget notifications: a dead webhook must never fail the request that triggered it.
  const tell = async (team, ev) => { try { const cfg = await s.getNotify(team); if (cfg) await sendFn(cfg, ev, deps); } catch (e) { console.warn('notify failed', e.message); } };
    /** Where the team's reward budget stands this month. */
  const budgetFor = async (team) => { const b = await s.getBudget(team), month = clock.monthKey(now()); const sp = b && b.monthly ? await s.getSpend(team, month) : { spent: 0, alerted: [] }; return Object.assign(Arena.budgetSummary(b ? b.monthly : 0, sp.spent, month), { alerted: sp.alerted }); };
  return async (event) => {
    const method = event.requestContext && event.requestContext.http ? event.requestContext.http.method : event.httpMethod;
    const path = event.rawPath || event.path || '/';
    const qs = event.queryStringParameters || {};
    const claims = (event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.jwt && event.requestContext.authorizer.jwt.claims) || {};
    if (method === 'OPTIONS') return json(204, {});
    const r = route(method, path);
    if (!r) return json(404, { error: 'not found' });
    // Team routes: supervisors see every team, everyone else only the team on their token.
    if (r.team && !teamAccess(claims, r.team)) return json(403, { error: 'not your team' });
    try {
      switch (r.name) {
        case 'health': return json(200, { ok: true, at: now().toISOString() });
        case 'teamAgents': {
          // A requested date is a local day; it is read at local noon so the day and week keys land on that day.
          const iso = (qs.date && clock.isDay(qs.date) ? new Date(clock.startOfDay(qs.date) + 12 * 3600000).toISOString() : now().toISOString());
          const agents = await s.getTeam(r.team, iso);
          return json(200, { team: r.team, date: store.dayKey(iso), week: store.weekKey(iso), timezone: clock.TZ, agents });
        }
        case 'agentEvents': {
          if (!isSupervisor(claims) && claims['custom:agentArn'] !== r.arn) return json(403, { error: 'not your ledger' });
          const limit = Math.min(100, +(qs.limit || 20));
          const items = await s.listEvents(r.arn, limit);
          return json(200, { agent: r.arn, events: items.map((i) => ({ type: i.EventType, at: i.EventTimestamp, points: i.points, queue: i.Queue, score: i.Score, autoFail: i.AutoFail, from: i.From, note: i.Note, handleTime: i.HandleTime, sentiment: i.Sentiment, day: i.Day })) });
        }
        case 'getMix': return json(200, { mix: (await s.getMix()) || Arena.DEFAULT_MIX });
        case 'putMix': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const body = parse(event);
          const mix = { quality: +body.quality, productivity: +body.productivity, adherence: +body.adherence };
          const v = Arena.validateMix(mix);
          if (!v.ok) return json(400, { error: v.message });
          await s.putMix(mix);
          return json(200, { mix, warning: v.message || undefined });
        }
        case 'listChallenges': {
          const list = await challenges.challengesFor(s, r.team, now(), { supervisor: isSupervisor(claims), viewer: claims['custom:agentArn'] });
          return json(200, { team: r.team, challenges: list });
        }
        case 'createChallenge': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const b = parse(event), t = Arena.TEMPLATES[b.template];
          if (!t) return json(400, { error: 'unknown template' });
          const today = clock.dayKey(now()), id = now().getTime().toString(36) + Math.random().toString(36).slice(2, 6);
          const v = challenges.challengeFields(b, t, today);
          if (!v.ok) return json(400, { error: v.error });
          if (b.template === 'duel') {
            const team = await s.getTeam(r.team, now().toISOString());
            if (!v.fields.agents.every((a) => team.some((x) => x.id === a))) return json(400, { error: 'both agents must be on this team' });
          }
          const c = Object.assign({ id }, v.fields, { createdAt: now().toISOString(), createdBy: who(claims) });
          c.state = c.startsAt > today ? 'scheduled' : 'active';
          await s.putTeamItem(r.team, `CH#${c.createdAt}#${id}`, c);
          if (c.state === 'active') await tell(r.team, { kind: 'challengeStarted', challenge: c });
          return json(201, { challenge: c });
        }
        case 'updateChallenge': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const b = parse(event);
          const item = (await s.listTeamItems(r.team, 'CH#', 50)).find((c) => c.id === r.id);
          if (!item) return json(404, { error: 'not found' });
          if (item.results) return json(409, { error: 'this challenge has already finished' });
          const fields = { updatedAt: now().toISOString(), updatedBy: who(claims) };
          // A supervisor may disqualify or reinstate agents while a race or duel runs.
          if (Array.isArray(b.excluded)) fields.excluded = b.excluded.map(String).slice(0, 100);
          if (b.state === 'ended') {
            if (fields.excluded) await s.updateTeamItem(r.team, item.sk, fields);
            const results = await challenges.finalize(s, r.team, Object.assign({}, item, fields), now(), { notify: tell });
            return json(200, { challenge: Object.assign(strip(item), fields, { state: 'ended', results, progress: Object.assign({}, results, { frozen: true }) }) });
          }
          const updated = await s.updateTeamItem(r.team, item.sk, fields);
          const list = await challenges.challengesFor(s, r.team, now(), { supervisor: true });
          return json(200, { challenge: list.find((c) => c.id === r.id) || strip(updated) });
        }
        case 'listRewards': {
          const status = qs.status;
          const items = (await s.listTeamItems(r.team, 'RW#', 100, true)).map(strip).filter((x) => !status || x.status === status);
          const budget = isSupervisor(claims) ? await budgetFor(r.team) : undefined;
          return json(200, { team: r.team, rewards: items, catalog: Arena.CATALOG, budget });
        }
        case 'requestReward': {
          const b = parse(event);
          const agentId = claims['custom:agentArn'] || b.agentId;
          const item = Arena.CATALOG.find((c) => c.id === b.catalogId);
          if (!agentId || !item) return json(400, { error: 'agentId and a catalog item are required' });
          const agent = (await s.getTeam(r.team, now().toISOString())).find((a) => a.id === agentId);
          if (!agent) return json(404, { error: 'agent not on this team' });
          if (agent.week < item.cost) return json(400, { error: `needs ${item.cost.toLocaleString()} pts this week, has ${agent.week.toLocaleString()}` });
          const at = now().toISOString(), id = now().getTime().toString(36) + Math.random().toString(36).slice(2, 6);
          const reward = { id, agentId, agentName: agent.name, catalogId: item.id, what: item.name, cost: item.cost, status: 'pending', requestedAt: at, requestedBy: who(claims) };
          await s.putTeamItem(r.team, `RW#${at}#${id}`, reward);
          await tell(r.team, { kind: 'rewardRequested', agentName: agent.name, what: item.name, cost: item.cost });
          return json(201, { reward });
        }
        case 'decideReward': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const b = parse(event);
          if (!['approved', 'declined'].includes(b.status)) return json(400, { error: 'status must be approved or declined' });
          const item = (await s.listTeamItems(r.team, 'RW#', 100)).find((x) => x.id === r.id);
          if (!item) return json(404, { error: 'not found' });
          if (item.status !== 'pending') return json(409, { error: 'already ' + item.status });
          let budget;
          if (b.status === 'approved') {
            // The monthly budget is a hard stop: raise it in the console if this reward should still go out.
            budget = await budgetFor(r.team);
            if (budget.capped && budget.spent + item.cost > budget.monthly) return json(409, { error: `approving this would put the team over its ${budget.monthly.toLocaleString()} pt reward budget for ${budget.month} (${budget.spent.toLocaleString()} spent)`, budget });
          }
          const updated = await s.updateTeamItem(r.team, item.sk, { status: b.status, decidedAt: now().toISOString(), decidedBy: who(claims) });
          if (b.status === 'approved') {
            await s.spendPoints(item.agentId, now().toISOString(), item.cost);
            if (budget.capped) {
              const spent = await s.addSpend(r.team, budget.month, item.cost);
              for (const pct of Arena.budgetAlerts(budget.monthly, spent, budget.alerted)) { await s.markBudgetAlert(r.team, budget.month, pct); await tell(r.team, { kind: 'budgetAlert', pct, spent, monthly: budget.monthly, month: budget.month }); }
              budget = Arena.budgetSummary(budget.monthly, spent, budget.month);
            }
          }
          await tell(r.team, { kind: 'rewardDecided', agentName: item.agentName, what: item.what, status: b.status });
          return json(200, { reward: strip(updated), budget });
        }
        case 'kudosFeed': {
          const limit = Math.min(50, +(qs.limit || 10));
          const items = (await s.listTeamItems(r.team, 'KD#', limit, true)).map(strip);
          return json(200, { team: r.team, kudos: items });
        }
        case 'listKiosk': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const items = (await s.listKiosks(r.team)).map((k) => ({ token: k.token, team: k.team, label: k.label, createdAt: k.createdAt, createdBy: k.createdBy, expiresAt: k.expiresAt }));
          return json(200, { team: r.team, kiosks: items });
        }
        case 'createKiosk': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const b = parse(event);
          const token = require('crypto').randomBytes(24).toString('base64url');
          const days = Math.min(365, Math.max(1, +(b.days || 90)));
          const kiosk = { label: String(b.label || 'Wallboard').slice(0, 60), createdAt: now().toISOString(), createdBy: who(claims), expiresAt: new Date(now().getTime() + days * 86400000).toISOString(), ttl: Math.floor(now().getTime() / 1000) + days * 86400 };
          await s.putKiosk(token, r.team, kiosk);
          return json(201, { kiosk: Object.assign({ token, team: r.team }, kiosk, { ttl: undefined }) });
        }
        case 'revokeKiosk': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const k = await s.getKiosk(r.token);
          if (!k || k.team !== r.team) return json(404, { error: 'not found' });
          await s.deleteKiosk(r.token);
          return json(200, { revoked: true });
        }
        case 'kiosk': {
          const k = await s.getKiosk(r.token);
          if (!k || (k.expiresAt && k.expiresAt < now().toISOString())) return json(401, { error: 'kiosk link is invalid or expired' });
          const iso = now().toISOString();
          if (r.what === 'agents') return json(200, { team: k.team, date: store.dayKey(iso), week: store.weekKey(iso), agents: (await s.getTeam(k.team, iso)).map(forWallboard) });
          if (r.what === 'kudos') return json(200, { team: k.team, kudos: (await s.listTeamItems(k.team, 'KD#', Math.min(50, +(qs.limit || 10)), true)).map(strip).map((k2) => Object.assign({}, k2, { from: displayName(k2.from), toName: displayName(k2.toName) })) });
          const list = (await challenges.challengesFor(s, k.team, now(), { supervisor: false })).map((c) => (c.progress && c.progress.standings ? Object.assign({}, c, { progress: Object.assign({}, c.progress, { standings: { metrics: c.progress.standings.metrics, rows: c.progress.standings.rows.map((row) => Object.assign({}, row, { name: displayName(row.name) })) } }) }) : c));
          return json(200, { team: k.team, challenges: list });
        }
        case 'history': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const period = [7, 14, 30, 90].includes(+qs.days) ? +qs.days : 30;
          const today = clock.dayKey(now());
          const dates = []; for (let i = 2 * period - 1; i >= 0; i--) dates.push(addDays(today, -i));
          const [byDate, live] = await Promise.all([s.getTeamDays(r.team, dates), s.getTeamLive(r.team)]);
          const names = {}; for (const l of live) names[l.pk.replace(/^AGENT#/, '')] = l.displayName || l.username;
          const days = dates.map((date) => ({ date, rows: (byDate[date] || []).map((row) => dayRow(row, names)) }));
          return json(200, { team: r.team, report: Arena.historyReport(days, period) });
        }
        case 'listCoaching': {
          const sup = isSupervisor(claims), mine = claims['custom:agentArn'];
          let items = (await s.listTeamItems(r.team, 'CO#', 200, true)).map(strip);
          if (!sup) items = mine ? items.filter((c) => c.agentId === mine).map(forAgent) : [];
          if (qs.status) items = items.filter((c) => c.status === qs.status);
          if (qs.agent) items = items.filter((c) => c.agentId === qs.agent);
          const today = clock.dayKey(now());
          // "since" is what the agent's numbers look like after the plan was opened: the evidence for closing it.
          const coaching = await Promise.all(items.slice(0, 100).map(async (c) => Object.assign({}, c, {
            since: c.status === 'done' ? c.result || null : await windowFor(s, c.agentId, addDays(clock.dayKey(c.createdAt), 1), today) })));
          return json(200, { team: r.team, coaching });
        }
        case 'createCoaching': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const b = parse(event);
          if (!b.agentId) return json(400, { error: 'agentId is required' });
          const agent = (await s.getTeam(r.team, now().toISOString())).find((a) => a.id === b.agentId);
          if (!agent) return json(404, { error: 'agent not on this team' });
          const at = now().toISOString(), day = clock.dayKey(now()), id = now().getTime().toString(36) + Math.random().toString(36).slice(2, 6);
          const item = { id, agentId: b.agentId, agentName: agent.name, reason: String(b.reason || '').slice(0, 200), note: String(b.note || '').slice(0, 2000),
            action: String(b.action || '').slice(0, 500), dueAt: isDay(b.dueAt) ? b.dueAt : '', status: 'open', createdAt: at, createdBy: who(claims),
            baseline: await windowFor(s, b.agentId, addDays(day, -13), day) };
          await s.putTeamItem(r.team, `CO#${at}#${id}`, item);
          return json(201, { coaching: Object.assign({}, item, { since: null }) });
        }
        case 'updateCoaching': {
          const sup = isSupervisor(claims), mine = claims['custom:agentArn'];
          const item = (await s.listTeamItems(r.team, 'CO#', 200)).find((c) => c.id === r.id);
          if (!item) return json(404, { error: 'not found' });
          const owner = !!mine && mine === item.agentId;
          if (!sup && !owner) return json(403, { error: 'not your coaching plan' });
          const b = parse(event), fields = {}, at = now().toISOString();
          if (sup) {
            if (b.note !== undefined) fields.note = String(b.note).slice(0, 2000);
            if (b.action !== undefined) fields.action = String(b.action).slice(0, 500);
            if (b.dueAt !== undefined) fields.dueAt = isDay(b.dueAt) ? b.dueAt : '';
            if (b.outcome !== undefined) fields.outcome = String(b.outcome).slice(0, 500);
            if (b.status === 'done' && item.status !== 'done') Object.assign(fields, { status: 'done', closedAt: at, closedBy: who(claims),
              result: await windowFor(s, item.agentId, addDays(clock.dayKey(item.createdAt), 1), clock.dayKey(at)) });
            if (b.status === 'open' && item.status === 'done') fields.status = 'open';
          }
          if (owner && b.acknowledged && !item.acknowledgedAt) fields.acknowledgedAt = at;
          const view = (c) => { const v = strip(c); return Object.assign(sup ? v : forAgent(v), { since: v.status === 'done' ? v.result || null : undefined }); };
          if (!Object.keys(fields).length) return json(200, { coaching: view(item) });
          fields.updatedAt = at;
          const updated = await s.updateTeamItem(r.team, item.sk, fields);
          return json(200, { coaching: view(updated) });
        }
        case 'recordMetric': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const b = parse(event), score = Number(b.score);
          if (!b.agentId || !['csat', 'sentiment'].includes(b.metric) || b.score === undefined || b.score === null || b.score === '' || !Number.isFinite(score)) return json(400, { error: 'agentId, metric (csat or sentiment) and a numeric score are required' });
          if (b.metric === 'csat' && (score < 1 || score > 5)) return json(400, { error: 'csat score must be between 1 and 5' });
          if (b.metric === 'sentiment' && (score < -5 || score > 5)) return json(400, { error: 'sentiment score must be between -5 and 5' });
          const live = await s.getLive(b.agentId), rounded = Math.round(score * 10) / 10;
          const ev = Object.assign(b.metric === 'csat' ? { EventType: 'CSAT_RECEIVED', Score: rounded } : { EventType: 'SENTIMENT_SCORED', Sentiment: rounded },
            { AgentARN: b.agentId, EventTimestamp: now().toISOString(), Team: (live && live.team) || r.team, Username: live ? live.username : undefined,
              ContactId: b.contactId || undefined, Source: 'api', RecordedBy: who(claims),
              DedupKey: b.contactId ? (b.metric === 'csat' ? 'CSAT#' : 'SENT#') + b.contactId : undefined });
          const points = Arena.scoreEvent(ev.EventType, ev, (await s.getMix()) || Arena.DEFAULT_MIX);
          const applied = await s.apply(store.planWrites(ev, points, now().getTime()));
          if (applied === false) return json(200, { ok: true, duplicate: true, points: 0 });
          return json(201, { ok: true, points });
        }
        case 'deleteAgent': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const deleted = await s.deleteAgent(r.arn);
          console.info(JSON.stringify({ audit: 'deleteAgent', arn: r.arn, rows: deleted, by: who(claims), at: now().toISOString() }));
          return json(200, { deleted, agent: r.arn });
        }
        case 'kudos': {
          const body = parse(event);
          if (!body.to || !body.note) return json(400, { error: 'to and note are required' });
          const sup = isSupervisor(claims), me = claims['custom:agentArn'];
          if (me && me === body.to) return json(400, { error: 'kudos go to a teammate, not to yourself' });
          // Agents send within their own team; the recipient must actually be on it.
          const team = sup ? body.team : claims['custom:team'];
          if (!team) return json(403, { error: 'no team on your sign-in' });
          if (!sup && body.team && body.team !== team) return json(403, { error: 'not your team' });
          const recipient = (await s.getTeam(team, now().toISOString())).find((a) => a.id === body.to);
          if (!recipient) return json(404, { error: 'recipient is not on this team' });
          const sender = claims.sub || me || claims['cognito:username'] || 'anonymous';
          const day = clock.dayKey(now());
          if (!(await s.bumpKudosCount(sender, day, KUDOS_DAILY_LIMIT, now().getTime()))) return json(429, { error: `kudos limit of ${KUDOS_DAILY_LIMIT} a day reached` });
          const from = claims.name || claims['cognito:username'] || claims.username || claims.sub || 'A teammate';
          const ev = { EventType: 'KUDOS', AgentARN: body.to, EventTimestamp: now().toISOString(), From: from, FromId: sender, Note: String(body.note).slice(0, 140), Team: team, Username: recipient.username, ToName: recipient.name };
          const points = Arena.scoreEvent('KUDOS', ev, Arena.DEFAULT_MIX);
          await s.apply(store.planWrites(ev, points, now().getTime()));
          await tell(team, { kind: 'kudos', from, to: recipient.name, note: ev.Note });
          return json(201, { ok: true, points });
        }
        case 'getNotify': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          return json(200, { team: r.team, notifications: notify.masked(await s.getNotify(r.team)) });
        }
        case 'putNotify': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          let merged;
          try { merged = notify.merge(await s.getNotify(r.team), parse(event)); } catch (e) { return json(400, { error: e.message }); }
          await s.putNotify(r.team, merged);
          return json(200, { team: r.team, notifications: notify.masked(merged) });
        }
        case 'getBudget': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          return json(200, { team: r.team, budget: await budgetFor(r.team) });
        }
        case 'putBudget': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const b = parse(event), monthly = Math.round(Number(b.monthly));
          if (!Number.isFinite(monthly) || monthly < 0 || monthly > 10000000) return json(400, { error: 'monthly must be a number of points, 0 to switch the cap off' });
          await s.putBudget(r.team, monthly);
          return json(200, { team: r.team, budget: await budgetFor(r.team) });
        }
        case 'testNotify': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const cfg = await s.getNotify(r.team);
          if (!cfg || !(cfg.slackUrl || cfg.teamsUrl || cfg.email)) return json(400, { error: 'add a Slack or Teams webhook, or an email, first' });
          try { const sent = await sendFn(cfg, { kind: 'test', team: r.team }, deps); return json(200, { ok: true, sent }); }
          catch (e) { return json(502, { error: 'a channel refused the message: ' + e.message }); }
        }
      }
    } catch (err) {
      console.error(err);
      return json(500, { error: 'internal' });
    }
  };
}

function parse(event) { try { return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body || '{}'); } catch { return {}; } }
const strip = (item) => { const { pk, sk, ttl, ...rest } = item || {}; return rest; };
const isDay = clock.isDay, addDays = clock.addDays;
/** A stored day row in the shape the engine's history functions read. */
const dayRow = (row, names) => { const id = row.pk.replace(/^AGENT#/, ''); return { id, name: names[id] || row.username || id.split('/').pop(), points: row.points || 0, handled: row.handled || 0, ahtSum: row.ahtSum || 0,
  evals: row.evals || [], autofails: row.autofails || 0, escalations: row.escalations || 0, kudosReceived: row.kudosReceived || 0,
  sentSum: row.sentSum || 0, sentCount: row.sentCount || 0, csatSum: row.csatSum || 0, csatCount: row.csatCount || 0, adherenceHours: row.adherenceHours || 0, adhSum: row.adhSum || 0, adhCount: row.adhCount || 0 }; };
/** One agent's averages over a date window, or null when there is nothing in it. Used as a coaching baseline and as the "since" evidence. */
async function windowFor(s, arn, from, to) {
  if (from > to) return null;
  const rows = await s.getAgentDays(arn, from, to);
  if (!rows.length) return null;
  const t = Arena.summarizeRows(rows.map((r) => dayRow(r, {})));
  return { qa: t.qa, sentiment: t.sentiment, csat: t.csat, adherence: t.adherence, handled: t.handled, aht: t.aht, autofails: t.autofails, days: rows.length };
}
/** What the coached agent may see: everything except the supervisor's private note. */
const forAgent = (c) => { const { note, ...rest } = c; return rest; };
const who = (claims) => claims.name || claims['cognito:username'] || claims.username || claims.sub || 'supervisor';
/** Supervisors reach every team; agents only the team on their token. With AUTH_MODE=none everyone is a supervisor. */
function teamAccess(claims, team) {
  if (isSupervisor(claims)) return true;
  const mine = claims['custom:team'];
  return !!mine && mine === team;
}
/** Shorten a person's name for a screen that anyone walking past can read. */
function displayName(name) {
  if (!name || DISPLAY_NAMES === 'full') return name;
  const parts = String(name).trim().split(/\s+/);
  if (DISPLAY_NAMES === 'first') return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0] + '.' : parts[0];
  return parts.map((p) => p[0]).join('').toUpperCase().slice(0, 3);
}
const forWallboard = (a) => { const { username, ...rest } = a; return Object.assign(rest, { name: displayName(a.name) }); };
function isSupervisor(claims) {
  const groups = claims['cognito:groups'] || claims.groups || [];
  const list = Array.isArray(groups) ? groups : String(groups).replace(/[\[\]]/g, '').split(/[ ,]+/);
  return list.includes('supervisors') || process.env.AUTH_MODE === 'none';
}

exports.handler = makeHandler({});
exports.makeHandler = makeHandler;
exports.route = route;
