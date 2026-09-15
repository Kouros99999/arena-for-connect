// Uploads the three pages to the stack's site bucket and invalidates CloudFront.
// Usage: node lambda/deploy-pages.js <stack name> [--team "Billing team"] [--region us-east-1]
// Needs the AWS CLI on PATH with credentials for the target account.
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const args = process.argv.slice(2);
const stack = args.find((a) => !a.startsWith('--'));
if (!stack) { console.error('usage: node lambda/deploy-pages.js <stack name> [--team NAME] [--region REGION]'); process.exit(1); }
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const region = opt('region', process.env.AWS_REGION || 'us-east-1');
const team = opt('team', '');

const aws = (...a) => execFileSync('aws', [...a, '--region', region], { encoding: 'utf8' }).trim();
const outputs = JSON.parse(aws('cloudformation', 'describe-stacks', '--stack-name', stack, '--query', 'Stacks[0].Outputs', '--output', 'json'));
const out = (k) => (outputs.find((o) => o.OutputKey === k) || {}).OutputValue;
const bucket = out('SiteBucket'), dist = out('DistributionId'), site = out('SiteUrl');
if (!bucket || !dist) { console.error('stack has no SiteBucket/DistributionId outputs; deploy the template first'); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-site-'));
const src = path.join(__dirname, '..', 'prototype');
for (const f of ['agent-panel.html', 'supervisor-console.html', 'wallboard.html', 'arena-engine.js']) fs.copyFileSync(path.join(src, f), path.join(tmp, f));
fs.writeFileSync(path.join(tmp, 'config.js'), `window.ARENA_CONFIG = ${JSON.stringify({ api: '/api', team })};\n`);
fs.writeFileSync(path.join(tmp, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Arena for Amazon Connect</title>
<style>body{font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5}a{display:block;margin:.4rem 0}</style>
<h1>Arena for Amazon Connect</h1>
<a href="agent-panel.html">Agent panel</a><a href="supervisor-console.html">Supervisor console</a><a href="wallboard.html">Wallboard</a>\n`);

console.log('uploading to s3://' + bucket);
aws('s3', 'sync', tmp, 's3://' + bucket, '--delete', '--cache-control', 'public, max-age=300');
// config.js must never be cached long: it is what an operator changes.
aws('s3', 'cp', path.join(tmp, 'config.js'), 's3://' + bucket + '/config.js', '--cache-control', 'no-cache', '--content-type', 'text/javascript');
console.log('invalidating', dist);
aws('cloudfront', 'create-invalidation', '--distribution-id', dist, '--paths', '/*', '--output', 'text');
console.log('\nSite:', site);
console.log('Agent workspace app URL:', site + '/agent-panel.html');
console.log('Supervisor console:      ', site + '/supervisor-console.html');
console.log('Wallboard:               ', site + '/wallboard.html');
