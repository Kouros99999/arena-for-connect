// The website's release notes page and "latest version" line are built from releases.json,
// and lambda/release.js refuses to publish a version that has no entry. These checks keep the file honest.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs'), path = require('path');
const notes = JSON.parse(fs.readFileSync(path.join(__dirname, 'releases.json'), 'utf8'));
const parts = (v) => v.split('.').map(Number);
const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

test('every entry has a version, a date, a title, a summary and at least one change', () => {
  assert.ok(notes.length > 0);
  for (const n of notes) {
    assert.match(n.version, /^\d+\.\d+\.\d+$/, 'version ' + n.version);
    assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/, 'date for ' + n.version);
    assert.ok(!Number.isNaN(Date.parse(n.date)), 'real date for ' + n.version);
    assert.ok(n.title && n.summary, 'title and summary for ' + n.version);
    assert.ok(Array.isArray(n.changes) && n.changes.length > 0 && n.changes.every((c) => typeof c === 'string' && c.trim()), 'changes for ' + n.version);
    assert.ok(Array.isArray(n.upgrade), 'upgrade list (may be empty) for ' + n.version);
  }
});

test('entries are newest first, with no version listed twice', () => {
  for (let i = 1; i < notes.length; i++) {
    assert.ok(newer(notes[i - 1].version, notes[i].version), `${notes[i - 1].version} should be newer than ${notes[i].version}`);
    assert.ok(notes[i - 1].date >= notes[i].date, `${notes[i - 1].version} should not be dated before ${notes[i].version}`);
  }
});
