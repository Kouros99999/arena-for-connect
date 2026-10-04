// Records a short silent demo video of Arena from the live demo pages.
//
//   node web/make-video.js [outDir]        (needs playwright + ffmpeg on PATH)
//
// Produces <outDir>/arena-demo.mp4 (1280x720, H.264). Captions are burned in as an overlay bar,
// so the video works without sound. Not deployed with the site; upload the mp4 where it is needed.
'use strict';
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const SITE = process.env.ARENA_SITE || 'https://arenaforconnect.com';
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'release', 'video'));
const logo = fs.readFileSync(path.join(__dirname, 'logo.svg'), 'utf8');

const card = (title, lines) => `<!doctype html><meta charset="utf-8"><style>
html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#0b1f1d;color:#fff;font-family:"Segoe UI",system-ui,sans-serif;text-align:center}
.logo svg{width:150px;height:150px}h1{font-size:54px;margin:28px 0 10px;font-weight:650;letter-spacing:-.5px}p{font-size:27px;margin:8px 0;color:#b6d9d4}
</style><div><div class="logo">${logo}</div><h1>${title}</h1>${lines.map((l) => `<p>${l}</p>`).join('')}</div>`;

// One caption bar per page; later steps on the same page replace its text.
const caption = (text) => `(() => { let d = document.getElementById('arena-cap');
  if (!d) { d = document.createElement('div'); d.id = 'arena-cap';
    d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:rgba(11,31,29,.94);color:#fff;font:600 26px "Segoe UI",system-ui,sans-serif;padding:18px 28px;text-align:center;border-top:3px solid #FBBF24';
    document.body.appendChild(d); }
  d.textContent = ${JSON.stringify(text)}; })()`;
const scrollTo = (sel) => `document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ behavior: 'smooth', block: 'center' })`;

// Each scene is a title card or a page with one or more captioned steps. `run` is evaluated in the page before the step's pause.
const scenes = [
  { card: card('Arena for Amazon Connect', ['A fair, live leaderboard for your contact center']), ms: 3500 },
  { url: '/agent-panel.html', steps: [{ text: 'Agents see their points, level and streak inside the Connect workspace', ms: 9000 }] },
  { url: '/supervisor-console.html', steps: [
    { text: 'Supervisors get a live leaderboard, with quality measured on every contact', ms: 7500 },
    { text: 'A flag becomes a coaching plan, with numbers before and since', ms: 7500, run: scrollTo('#coach') },
    { text: 'Challenges and rewards are measured from Connect data, never self-reported', ms: 6000, run: scrollTo('#chals') },
  ] },
  { url: '/report.html', steps: [
    { text: 'A results report shows what changed, against the period before', ms: 6500 },
    { text: 'Every agent, before and after', ms: 6000, run: scrollTo('#agentTbl') },
  ] },
  { url: '/wallboard.html', steps: [{ text: 'A wallboard keeps the whole floor in the game', ms: 8000 }] },
  { card: card('Quality outweighs speed, by design', ['Runs entirely in your own AWS account', 'arenaforconnect.com']), ms: 5500 },
];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: 'light', recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  const started = Date.now();
  let lead = null;                         // how long the recording ran before the first scene was on screen
  for (const s of scenes) {
    if (s.card) { await page.setContent(s.card); if (lead === null) lead = (Date.now() - started) / 1000; await page.waitForTimeout(s.ms); continue; }
    await page.goto(SITE + s.url, { waitUntil: 'load' });
    for (const st of s.steps) {
      await page.evaluate(caption(st.text));
      if (st.run) await page.evaluate(st.run);
      await page.waitForTimeout(st.ms);
    }
  }
  const video = page.video();
  await ctx.close(); await browser.close();
  const webm = await video.path(), mp4 = path.join(out, 'arena-demo.mp4');
  // Trim the blank lead-in the recorder captures while the first page is being set up.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, (lead || 0) + 0.3).toFixed(2)), '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', '-an', mp4]);
  fs.unlinkSync(webm);
  console.log(mp4, Math.round(fs.statSync(mp4).size / 1024) + ' KB');
})().catch((e) => { console.error(e); process.exit(1); });
