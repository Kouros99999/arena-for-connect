/*
 * Warehouse export and the data read API.
 *
 * Rows are per agent per local day: what the results report and personal bests are built from. The same
 * function feeds two outputs:
 *   - a nightly file per team in the stack's export bucket, newline-delimited JSON under
 *     days/dt=<day>/<team>.json, which Databricks Auto Loader, Athena, Snowflake and the like read as-is;
 *   - GET /data/<key>/days?from&to[&team], the read API for a warehouse or BI tool, authenticated by a data key
 *     a supervisor mints in the console (same mechanism as wallboard links, kind "data", all teams).
 * Nothing here contains customer data: identifiers, names and team come from Connect, the rest are Arena's numbers.
 */
'use strict';
const Arena = require('./arena-engine.js');
const store = require('./store.js');
const clock = require('./clock.js');

const BUCKET = process.env.EXPORT_BUCKET || '';
const MAX_DAYS = 92;

let s3c;
function s3() {
  if (s3c) return s3c;
  const sdk = require('@aws-sdk/client-s3');
  s3c = { client: new sdk.S3Client({}), PutObjectCommand: sdk.PutObjectCommand };
  return s3c;
}

/** Pure: one stored DAY row -> one export row. */
function toRow(row, team, day, names) {
  const id = row.pk.replace(/^AGENT#/, '');
  const t = Arena.summarizeRows([{ id, points: row.points || 0, handled: row.handled || 0, ahtSum: row.ahtSum || 0, evals: row.evals || [], autofails: row.autofails || 0, escalations: row.escalations || 0,
    kudosReceived: row.kudosReceived || 0, sentSum: row.sentSum || 0, sentCount: row.sentCount || 0, csatSum: row.csatSum || 0, csatCount: row.csatCount || 0, adhSum: row.adhSum || 0, adhCount: row.adhCount || 0, adherenceHours: row.adherenceHours || 0 }]);
  return { day, team, agentArn: id, agentId: id.split('/').pop(), username: row.username || null, name: (names && names[id]) || row.username || null,
    points: t.points, contactsHandled: t.handled, avgHandleTimeSeconds: t.aht, evaluations: t.evaluations, evaluationAvg: t.qa, autoFails: t.autofails, escalations: t.escalations,
    kudosReceived: t.kudos, sentimentAvg: t.sentiment, surveyAvg: t.csat, adherencePct: t.adherence, adherentHours: t.adherenceHours };
}

/** Export rows for one day, every team or one team. */
async function rowsFor(s, day, team) {
  const teams = team ? [team] : await s.listTeams();
  const out = [];
  for (const t of teams) {
    const live = await s.getTeamLive(t);
    const names = {}; for (const l of live) names[l.pk.replace(/^AGENT#/, '')] = l.displayName || l.username;
    const days = await s.getTeamDays(t, [day]);
    for (const row of days[day] || []) out.push(toRow(row, t, day, names));
  }
  return out;
}

/** Rows for a date range, inclusive, capped at MAX_DAYS. */
async function rowsBetween(s, from, to, team) {
  const out = [];
  let d = from, n = 0;
  while (d <= to && n++ < MAX_DAYS) { out.push(...(await rowsFor(s, d, team))); d = clock.addDays(d, 1); }
  return out;
}

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';

/** Nightly: write yesterday's rows, one file per team, and a manifest. Idempotent: the same key is overwritten with the same content. */
async function runFor(now, deps) {
  deps = deps || {};
  const s = deps.store || store, bucket = deps.bucket || BUCKET;
  if (!bucket) return { skipped: 'no export bucket' };
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const day = clock.addDays(clock.dayKey(nowMs), -1);
  const teams = await s.listTeams();
  const put = deps.put || (async (Key, Body, ContentType) => { const c = s3(); await c.client.send(new c.PutObjectCommand({ Bucket: bucket, Key, Body, ContentType })); });
  const files = [];
  for (const t of teams) {
    const rows = await rowsFor(s, day, t);
    if (!rows.length) continue;
    const key = `days/dt=${day}/${slug(t)}.json`;
    await put(key, jsonl(rows), 'application/x-ndjson');
    files.push({ key, team: t, rows: rows.length });
  }
  await put(`manifests/${day}.json`, JSON.stringify({ day, exportedAt: new Date(nowMs).toISOString(), files }, null, 2), 'application/json');
  return { day, teams: teams.length, files: files.length, rows: files.reduce((n, f) => n + f.rows, 0) };
}

exports.handler = async (event, context, deps) => {
  const r = await runFor((deps && deps.now) ? deps.now() : Date.now(), deps);
  console.log(JSON.stringify(r));
  return r;
};
exports.runFor = runFor;
exports.rowsFor = rowsFor;
exports.rowsBetween = rowsBetween;
exports.toRow = toRow;
exports.jsonl = jsonl;
exports.MAX_DAYS = MAX_DAYS;
