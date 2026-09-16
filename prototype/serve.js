// Static server for the prototype folder plus a mock of the Arena API under /api,
// backed by the shared engine and simulator. Lets the pages run in remote mode locally:
//   node prototype/serve.js
//   http://localhost:8765/agent-panel.html?api=http://localhost:8765/api&team=Billing%20team&agent=agent-0
const http = require('http'), fs = require('fs'), path = require('path');
const Arena = require('./arena-engine.js');
const root = __dirname, port = +(process.env.PORT || 8765);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };

// ---- mock API state ----
const engine = Arena.seedTeam(Arena.createEngine());
engine.agents.forEach((a) => { a.team = 'Billing team'; });
const ledger = {};
engine.on((r) => { (ledger[r.agent.id] = ledger[r.agent.id] || []).unshift({ type: r.event.EventType, at: r.event.EventTimestamp || new Date().toISOString(), points: r.points, queue: r.event.Queue, score: r.event.Score, autoFail: r.event.AutoFail, from: r.event.From, note: r.event.Note, handleTime: r.event.HandleTime }); ledger[r.agent.id].length = Math.min(ledger[r.agent.id].length, 50); });
Arena.createSimulator(engine, { rate: 4, exclude: ['agent-7'] }).start();

function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS' }); res.end(JSON.stringify(body)); }
function body(req) { return new Promise((r) => { let s = ''; req.on('data', (c) => s += c); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); }); }

async function api(req, res, p) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  let m;
  if (req.method === 'GET' && (m = p.match(/^\/teams\/([^/]+)\/agents$/))) {
    const now = new Date().toISOString();
    return json(res, 200, { team: decodeURIComponent(m[1]), date: now.slice(0, 10), agents: engine.agents.map((a) => ({ ...a, hue: undefined, initials: undefined })) });
  }
  if (req.method === 'GET' && (m = p.match(/^\/agents\/(.+)\/events$/))) return json(res, 200, { agent: m[1], events: (ledger[decodeURIComponent(m[1])] || []).slice(0, 20) });
  // Challenges, rewards, kudos feed: the local engine already implements them.
  try {
    if (req.method === 'GET' && (m = p.match(/^\/teams\/([^/]+)\/challenges$/))) return json(res, 200, { challenges: await engine.challenges() });
    if (req.method === 'POST' && (m = p.match(/^\/teams\/([^/]+)\/challenges$/))) return json(res, 201, { challenge: await engine.createChallenge(await body(req)) });
    if (req.method === 'PUT' && (m = p.match(/^\/teams\/([^/]+)\/challenges\/([^/]+)$/))) return json(res, 200, { challenge: await engine.endChallenge(decodeURIComponent(m[2])) });
    if (req.method === 'GET' && (m = p.match(/^\/teams\/([^/]+)\/rewards$/))) { const st = (req.url.split('?')[1] || '').match(/status=([a-z]+)/); return json(res, 200, { rewards: await engine.rewards(st && st[1]), catalog: Arena.CATALOG }); }
    if (req.method === 'POST' && (m = p.match(/^\/teams\/([^/]+)\/rewards$/))) { const b = await body(req); return json(res, 201, { reward: await engine.requestReward(b.agentId, b.catalogId, b.by) }); }
    if (req.method === 'PUT' && (m = p.match(/^\/teams\/([^/]+)\/rewards\/([^/]+)$/))) { const b = await body(req); return json(res, 200, { reward: await engine.decideReward(decodeURIComponent(m[2]), b.status, 'mock supervisor') }); }
    if (req.method === 'GET' && (m = p.match(/^\/teams\/([^/]+)\/kudos$/))) { const l = (req.url.split('?')[1] || '').match(/limit=(\d+)/); return json(res, 200, { kudos: await engine.kudosFeed(l ? +l[1] : 10) }); }
    // Kiosk: any token that starts with "demo" works against the mock.
    if (req.method === 'POST' && (m = p.match(/^\/teams\/([^/]+)\/kiosk$/))) return json(res, 201, { kiosk: { token: 'demo-' + Math.random().toString(36).slice(2, 10), team: 'Billing team', label: 'Wallboard', expiresAt: new Date(Date.now() + 90 * 86400000).toISOString() } });
    if (req.method === 'GET' && (m = p.match(/^\/teams\/([^/]+)\/kiosk$/))) return json(res, 200, { kiosks: [] });
    if (req.method === 'GET' && (m = p.match(/^\/kiosk\/([^/]+)\/(agents|challenges|kudos)$/))) {
      if (!m[1].startsWith('demo')) return json(res, 401, { error: 'kiosk link is invalid or expired' });
      if (m[2] === 'agents') return json(res, 200, { team: 'Billing team', agents: engine.agents.map((a) => ({ ...a, hue: undefined, initials: undefined })) });
      if (m[2] === 'challenges') return json(res, 200, { team: 'Billing team', challenges: await engine.challenges() });
      return json(res, 200, { team: 'Billing team', kudos: await engine.kudosFeed(8) });
    }
    if (req.method === 'DELETE' && (m = p.match(/^\/agents\/(.+)$/))) return json(res, 200, { deleted: 0, agent: decodeURIComponent(m[1]) });
  } catch (e) { return json(res, 400, { error: e.message }); }
  if (req.method === 'GET' && p === '/config/mix') return json(res, 200, { mix: engine.getMix() });
  if (req.method === 'PUT' && p === '/config/mix') { const b = await body(req); const mix = { quality: +b.quality, productivity: +b.productivity, adherence: +b.adherence }; const v = engine.setMix(mix); return v.ok ? json(res, 200, { mix, warning: v.message || undefined }) : json(res, 400, { error: v.message }); }
  if (req.method === 'POST' && p === '/kudos') { const b = await body(req); const a = engine.byId(b.to); if (!a || !b.note) return json(res, 400, { error: 'to and note are required' }); const r = engine.ingest({ EventType: 'KUDOS', AgentARN: a.id, EventTimestamp: new Date().toISOString(), From: b.from || 'A teammate', Note: String(b.note).slice(0, 140) }); return json(res, 201, { ok: true, points: r.points }); }
  if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true });
  return json(res, 404, { error: 'not found' });
}

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/api')) return api(req, res, url.slice(4) || '/');
  // Local default: no config, so pages run the simulator unless the query string says otherwise.
  if (url === '/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('window.ARENA_CONFIG = {};'); }
  const p = path.join(root, url.replace(/^\/+/, '') || 'agent-panel.html');
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data);
  });
}).listen(port, () => console.log('arena prototype on http://localhost:' + port + '  (mock API at /api)'));
