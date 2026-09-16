// Builds a self-contained release of the Arena stack for AWS Marketplace or any customer account.
//
//   node lambda/release.js <version> [--bucket <public artifacts bucket>] [--region us-east-1] [--no-upload]
//
// Produces release/<version>/arena.zip (all Lambda code, one archive), release/<version>/template.yaml
// (every CodeUri rewritten to the public S3 location) and release/<version>/site.zip (the pages).
// With --bucket it uploads all three to s3://<bucket>/arena/<version>/ with a public-read ACL so a
// customer's CloudFormation can fetch the code from a different account. Marketplace copies from there.
//
// Needs the AWS CLI on PATH for the upload step. The build itself needs only node.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) { console.error('usage: node lambda/release.js <x.y.z> [--bucket B] [--region R] [--no-upload]'); process.exit(1); }
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const bucket = opt('bucket', process.env.ARENA_RELEASE_BUCKET || ''), region = opt('region', process.env.AWS_REGION || 'us-east-1');
const upload = !args.includes('--no-upload') && !!bucket;

const root = path.join(__dirname, '..');
const out = path.join(root, 'release', version);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });

// 1. Lambda code: src/ plus the shared engine, zipped with files at the archive root.
fs.copyFileSync(path.join(root, 'prototype', 'arena-engine.js'), path.join(__dirname, 'src', 'arena-engine.js'));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-rel-'));
for (const f of fs.readdirSync(path.join(__dirname, 'src'))) if (!f.endsWith('.test.js')) fs.copyFileSync(path.join(__dirname, 'src', f), path.join(stage, f));
zip(stage, path.join(out, 'arena.zip'));

// 2. Pages.
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-site-'));
for (const f of ['agent-panel.html', 'supervisor-console.html', 'wallboard.html', 'arena-engine.js', 'arena-auth.js']) fs.copyFileSync(path.join(root, 'prototype', f), path.join(site, f));
zip(site, path.join(out, 'site.zip'));

// 3. Template with every CodeUri pointing at the published archive.
const codeUri = bucket ? `s3://${bucket}/arena/${version}/arena.zip` : `./arena.zip`;
let tpl = fs.readFileSync(path.join(__dirname, 'template.yaml'), 'utf8');
const before = (tpl.match(/CodeUri: src\//g) || []).length;
tpl = tpl.replace(/CodeUri: src\/[^\n]*/g, `CodeUri: ${codeUri}`);
tpl = tpl.replace(/^Description: (.*)$/m, `Description: Arena for Amazon Connect v${version}. $1`);
fs.writeFileSync(path.join(out, 'template.yaml'), tpl);

// 4. Checksums so a reviewer can verify what they downloaded.
const crypto = require('crypto');
const sums = ['arena.zip', 'site.zip', 'template.yaml'].map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(out, f))).digest('hex')}  ${f}`).join('\n') + '\n';
fs.writeFileSync(path.join(out, 'SHA256SUMS'), sums);

console.log(`release ${version}: ${before} functions -> ${codeUri}`);
console.log(fs.readdirSync(out).map((f) => `  ${f}  ${fs.statSync(path.join(out, f)).size} bytes`).join('\n'));

// 5. Publish.
if (upload) {
  const aws = (...a) => execFileSync('aws', [...a, '--region', region], { encoding: 'utf8' }).trim();
  for (const f of fs.readdirSync(out)) aws('s3', 'cp', path.join(out, f), `s3://${bucket}/arena/${version}/${f}`, '--acl', 'public-read', '--cache-control', 'public, max-age=31536000, immutable');
  console.log(`published to s3://${bucket}/arena/${version}/`);
  console.log(`template URL: https://${bucket}.s3.${region}.amazonaws.com/arena/${version}/template.yaml`);
} else if (bucket) console.log('upload skipped (--no-upload)');
else console.log('no --bucket given: template references ./arena.zip; run `aws cloudformation package` on it or pass --bucket to publish');

function zip(dir, dest) {
  // PowerShell on Windows, zip elsewhere. Files land at the archive root either way.
  if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path "${dir}\\*" -DestinationPath "${dest}" -CompressionLevel Optimal -Force`]);
  else execFileSync('zip', ['-qr', dest, '.'], { cwd: dir });
}
