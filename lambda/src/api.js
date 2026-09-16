/*
 * Arena read/write API. One Lambda behind an HTTP API (payload v2).
 *
 *   GET  /teams/{team}/agents?date=YYYY-MM-DD   agents in engine shape (today + week + live), for all three pages
 *   GET  /agents/{arn}/events?limit=20          points ledger for the agent panel feed
 *   GET  /config/mix                            scoring mix
 *   PUT  /config/mix                            { quality, productivity, adherence } validated by the engine
 *   POST /kudos                                 { to, from, note, team } scores and stores a KUDOS event
 *
 * Auth: HTTP API JWT authorizer (Cognito or the customer's IdP) is configured in the template.
 * The workspace app sends the agent's token; the API trusts the `sub` claim, never a body field, for identity.
 */
'use strict';
const Arena = require('./arena-engine.js');
const store = require('./store.js');

const ORIGIN = process.env.ALLOWED_ORIGIN || '*';
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
  return async (event) => {
    const method = event.requestContext && event.requestContext.http ? event.requestContext.http.method : event.httpMethod;
    const path = event.rawPath || event.path || '/';
    const qs = event.queryStringParameters || {};
    const claims = (event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.jwt && event.requestContext.authorizer.jwt.claims) || {};
    if (method === 'OPTIONS') return json(204, {});
    const r = route(method, path);
    if (!r) return json(404, { error: 'not found' });
    try {
      switch (r.name) {
        case 'health': return json(200, { ok: true, at: now().toISOString() });
        case 'teamAgents': {
          const iso = (qs.date ? qs.date + 'T00:00:00.000Z' : now().toISOString());
          const agents = await s.getTeam(r.team, iso);
          return json(200, { team: r.team, date: store.dayKey(iso), week: store.weekKey(iso), agents });
        }
        case 'agentEvents': {
          const limit = Math.min(100, +(qs.limit || 20));
          const items = await s.listEvents(r.arn, limit);
          return json(200, { agent: r.arn, events: items.map((i) => ({ type: i.EventType, at: i.EventTimestamp, points: i.points, queue: i.Queue, score: i.Score, autoFail: i.AutoFail, from: i.From, note: i.Note, handleTime: i.HandleTime })) });
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
          const [items, agents] = await Promise.all([s.listTeamItems(r.team, 'CH#', 50, true), s.getTeam(r.team, now().toISOString())]);
          const today = now().toISOString().slice(0, 10);
          const challenges = items.map(strip).map((c) => {
            const state = c.state === 'ended' ? 'ended' : c.startsAt > today ? 'scheduled' : c.endsAt < today ? 'ended' : 'active';
            return Object.assign({}, c, { state, progress: Arena.challengeProgress(c, agents) });
          });
          return json(200, { team: r.team, challenges });
        }
        case 'createChallenge': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const b = parse(event), t = Arena.TEMPLATES[b.template];
          if (!t) return json(400, { error: 'unknown template' });
          const today = now().toISOString().slice(0, 10), id = now().getTime().toString(36) + Math.random().toString(36).slice(2, 6);
          const c = { id, template: b.template, title: String(b.title || t.title).slice(0, 120), scope: String(b.scope || 'Team').slice(0, 60), target: b.target != null ? Number(String(b.target).replace(/[^0-9.]/g, '')) : t.defaultTarget,
            reward: b.reward != null ? Number(String(b.reward).replace(/[^0-9.]/g, '')) : t.reward, startsAt: b.startsAt || today, endsAt: b.endsAt || today, createdAt: now().toISOString(), createdBy: who(claims) };
          c.state = c.startsAt > today ? 'scheduled' : 'active';
          await s.putTeamItem(r.team, `CH#${c.createdAt}#${id}`, c);
          return json(201, { challenge: c });
        }
        case 'updateChallenge': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const b = parse(event);
          const item = (await s.listTeamItems(r.team, 'CH#', 50)).find((c) => c.id === r.id);
          if (!item) return json(404, { error: 'not found' });
          const updated = await s.updateTeamItem(r.team, item.sk, { state: b.state === 'ended' ? 'ended' : item.state, updatedAt: now().toISOString(), updatedBy: who(claims) });
          return json(200, { challenge: strip(updated) });
        }
        case 'listRewards': {
          const status = qs.status;
          const items = (await s.listTeamItems(r.team, 'RW#', 100, true)).map(strip).filter((x) => !status || x.status === status);
          return json(200, { team: r.team, rewards: items, catalog: Arena.CATALOG });
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
          return json(201, { reward });
        }
        case 'decideReward': {
          if (!isSupervisor(claims)) return json(403, { error: 'supervisors only' });
          const b = parse(event);
          if (!['approved', 'declined'].includes(b.status)) return json(400, { error: 'status must be approved or declined' });
          const item = (await s.listTeamItems(r.team, 'RW#', 100)).find((x) => x.id === r.id);
          if (!item) return json(404, { error: 'not found' });
          if (item.status !== 'pending') return json(409, { error: 'already ' + item.status });
          const updated = await s.updateTeamItem(r.team, item.sk, { status: b.status, decidedAt: now().toISOString(), decidedBy: who(claims) });
          if (b.status === 'approved') await s.spendPoints(item.agentId, now().toISOString(), item.cost);
          return json(200, { reward: strip(updated) });
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
          if (r.what === 'agents') return json(200, { team: k.team, date: store.dayKey(iso), week: store.weekKey(iso), agents: await s.getTeam(k.team, iso) });
          if (r.what === 'kudos') return json(200, { team: k.team, kudos: (await s.listTeamItems(k.team, 'KD#', Math.min(50, +(qs.limit || 10)), true)).map(strip) });
          const [items, agents] = await Promise.all([s.listTeamItems(k.team, 'CH#', 50, true), s.getTeam(k.team, iso)]);
          const today = iso.slice(0, 10);
          return json(200, { team: k.team, challenges: items.map(strip).map((c) => Object.assign({}, c, { state: c.state === 'ended' ? 'ended' : c.startsAt > today ? 'scheduled' : c.endsAt < today ? 'ended' : 'active', progress: Arena.challengeProgress(c, agents) })) });
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
          const from = claims.name || claims.username || claims.sub || body.from || 'A teammate';
          const ev = { EventType: 'KUDOS', AgentARN: body.to, EventTimestamp: now().toISOString(), From: from, Note: String(body.note).slice(0, 140), Team: body.team, Username: body.toUsername, ToName: body.toName };
          const points = Arena.scoreEvent('KUDOS', ev, Arena.DEFAULT_MIX);
          await s.apply(store.planWrites(ev, points, now().getTime()));
          return json(201, { ok: true, points });
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
const who = (claims) => claims.name || claims['cognito:username'] || claims.username || claims.sub || 'supervisor';
function isSupervisor(claims) {
  const groups = claims['cognito:groups'] || claims.groups || [];
  const list = Array.isArray(groups) ? groups : String(groups).replace(/[\[\]]/g, '').split(/[ ,]+/);
  return list.includes('supervisors') || process.env.AUTH_MODE === 'none';
}

exports.handler = makeHandler({});
exports.makeHandler = makeHandler;
exports.route = route;
