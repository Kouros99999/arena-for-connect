// Captures product screenshots for the website from the demo pages (simulated data).
//
//   node web/make-shots.js [base url]      default http://localhost:8765 (node prototype/serve.js)
//
// Writes web/img/*.png at 1440x900, light theme, 2x device scale for crisp text, then a 1x copy for the hero.
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');

const base = (process.argv[2] || 'http://localhost:8765').replace(/\/$/, '');
const out = path.join(__dirname, 'img');
fs.mkdirSync(out, { recursive: true });

const shots = [
  { name: 'console', url: '/supervisor-console.html', w: 1440, h: 900, prep: "document.querySelector('#pause') && document.querySelector('#pause').click(); document.querySelector('.demo').hidden = true;" },
  { name: 'agent-panel', url: '/agent-panel.html', w: 1440, h: 900, prep: "document.querySelector('#pause') && document.querySelector('#pause').click(); document.querySelector('.demo').hidden = true;" },
  { name: 'report', url: '/report.html', w: 1440, h: 900, prep: "document.querySelector('#demoNote').hidden = true;" },
  { name: 'wallboard', url: '/wallboard.html', w: 1440, h: 900, prep: '' },
  { name: 'coaching', url: '/supervisor-console.html', w: 1440, h: 900, prep: "document.querySelector('#pause') && document.querySelector('#pause').click(); document.querySelector('.demo').hidden = true; document.querySelector('#coach').scrollIntoView({block:'center'});", clip: { x: 900, y: 0, width: 540, height: 900 } },
];

(async () => {
  const browser = await chromium.launch();
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(base + s.url, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    if (s.prep) await page.evaluate(s.prep);
    await page.waitForTimeout(600);
    const file = path.join(out, s.name + '.png');
    await page.screenshot({ path: file, clip: s.clip ? Object.assign({}, s.clip) : undefined, fullPage: false });
    console.log(s.name, Math.round(fs.statSync(file).size / 1024) + ' KB');
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
