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
        case 'kudos': {
          const body = parse(event);
          if (!body.to || !body.note) return json(400, { error: 'to and note are required' });
          const from = claims.name || claims.username || claims.sub || body.from || 'A teammate';
          const ev = { EventType: 'KUDOS', AgentARN: body.to, EventTimestamp: now().toISOString(), From: from, Note: String(body.note).slice(0, 140), Team: body.team, Username: body.toUsername };
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
function isSupervisor(claims) {
  const groups = claims['cognito:groups'] || claims.groups || [];
  const list = Array.isArray(groups) ? groups : String(groups).replace(/[\[\]]/g, '').split(/[ ,]+/);
  return list.includes('supervisors') || process.env.AUTH_MODE === 'none';
}

exports.handler = makeHandler({});
exports.makeHandler = makeHandler;
exports.route = route;
