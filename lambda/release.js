// Builds a self-contained release of the Arena stack for AWS Marketplace or any customer account.
//
//   node lambda/release.js <version> [--bucket <public artifacts bucket>] [--region us-east-1] [--no-upload]
//
// Produces release/<version>/arena.zip (all Lambda code, one archive), release/<version>/template.yaml
// (every CodeUri rewritten to the public S3 location) and release/<version>/site.zip (the pages).
// With --bucket it uploads all three to s3://<bucket>/arena/<version>/. The bucket policy grants public
// read on arena/* so a customer's CloudFormation can fetch the code from another account; Marketplace copies from there.
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
// Release notes are part of a release: the website's notes page and "latest version" line are built from this file.
const notesFile = path.join(root, 'web', 'releases.json');
const notes = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
const entry = notes.find((n) => n.version === version);
if (!entry || !Array.isArray(entry.changes) || !entry.changes.length) {
  console.error(`No release notes for ${version}.\nAdd an entry at the top of web/releases.json (version, date, title, summary, changes, upgrade) and run this again.\nThe notes page at arenaforconnect.com/releases.html and the landing page's "latest version" line come from that file.`);
  process.exit(1);
}
if (notes[0].version !== version && !args.includes('--allow-older')) { console.error(`web/releases.json lists ${notes[0].version} first, not ${version}. Put the newest version at the top, or pass --allow-older to rebuild an earlier one.`); process.exit(1); }
const out = path.join(root, 'release', version);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });

fs.writeFileSync(path.join(out, 'RELEASE_NOTES.json'), JSON.stringify(entry, null, 2) + '\n');   // the notes ship beside the template

// 1. Lambda code: src/ plus the shared engine, zipped with files at the archive root.
fs.copyFileSync(path.join(root, 'prototype', 'arena-engine.js'), path.join(__dirname, 'src', 'arena-engine.js'));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-rel-'));
for (const f of fs.readdirSync(path.join(__dirname, 'src'))) if (!f.endsWith('.test.js')) fs.copyFileSync(path.join(__dirname, 'src', f), path.join(stage, f));
zip(stage, path.join(out, 'arena.zip'));

// 2. Pages.
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-site-'));
for (const f of ['agent-panel.html', 'supervisor-console.html', 'wallboard.html', 'report.html', 'arena-engine.js', 'arena-auth.js']) fs.copyFileSync(path.join(root, 'prototype', f), path.join(site, f));
zip(site, path.join(out, 'site.zip'));

// 3. Template with every CodeUri pointing at the published archive.
const codeUri = bucket ? `s3://${bucket}/arena/${version}/arena.zip` : `./arena.zip`;
let tpl = fs.readFileSync(path.join(__dirname, 'template.yaml'), 'utf8');
const before = (tpl.match(/CodeUri: src\//g) || []).length;
tpl = tpl.replace(/CodeUri: src\/[^\n]*/g, `CodeUri: ${codeUri}`);
tpl = tpl.replace(/^Description: (.*)$/m, `Description: Arena for Amazon Connect v${version}. $1`);
// Point the site installer at this release's site.zip by default, so a plain launch installs the pages too.
if (bucket) {
  const siteUrl = `https://${bucket}.s3.${region}.amazonaws.com/arena/${version}/site.zip`;
  tpl = tpl.replace(/(  SiteArchiveUrl:\n    Type: String\n    Default: )''/, `$1'${siteUrl}'`);
}
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
  // Public read comes from the bucket policy on arena/*, not per-object ACLs (ACLs are disabled on new buckets).
  for (const f of fs.readdirSync(out)) aws('s3', 'cp', path.join(out, f), `s3://${bucket}/arena/${version}/${f}`, '--cache-control', 'public, max-age=31536000, immutable');
  console.log(`published to s3://${bucket}/arena/${version}/`);
  console.log(`template URL: https://${bucket}.s3.${region}.amazonaws.com/arena/${version}/template.yaml`);
  console.log(`\nNext: commit and push. The push publishes the ${version} notes to https://arenaforconnect.com/releases.html.`);
} else if (bucket) console.log('upload skipped (--no-upload)');
else console.log('no --bucket given: template references ./arena.zip; run `aws cloudformation package` on it or pass --bucket to publish');

function zip(dir, dest) {
  // PowerShell on Windows, zip elsewhere. Files land at the archive root either way.
  if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path "${dir}\\*" -DestinationPath "${dest}" -CompressionLevel Optimal -Force`]);
  else execFileSync('zip', ['-qr', dest, '.'], { cwd: dir });
}
