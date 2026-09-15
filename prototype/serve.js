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
