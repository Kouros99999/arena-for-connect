/*
 * Arena ingest Lambda for Contact Lens performance evaluations.
 *
 * Trigger: EventBridge "Object Created" from the customer's evaluations bucket
 *          (Connect writes one JSON per submitted evaluation under Evaluations/YYYY/MM/DD/).
 * Output:  one EVALUATION_SUBMITTED event per file, scored by the shared engine, deduped on evaluationId.
 *
 * The output file carries the agent's user id, not an ARN, so the ARN is rebuilt from
 * region, account and instance id to match what the agent event stream uses.
 */
'use strict';
const Arena = require('./arena-engine.js');
const store = require('./store.js');

const REGION = process.env.AWS_REGION || 'us-east-1';
const ACCOUNT = process.env.ACCOUNT_ID || '';

let s3;
async function readObject(bucket, key) {
  if (!s3) { const { S3Client } = require('@aws-sdk/client-s3'); s3 = { client: new S3Client({}), GetObjectCommand: require('@aws-sdk/client-s3').GetObjectCommand }; }
  const r = await s3.client.send(new s3.GetObjectCommand({ Bucket: bucket, Key: key }));
  return JSON.parse(await r.Body.transformToString());
}

let mixCache = { at: 0, mix: Arena.DEFAULT_MIX };
async function currentMix() {
  if (Date.now() - mixCache.at < 60000) return mixCache.mix;
  try { mixCache = { at: Date.now(), mix: (await store.getMix()) || Arena.DEFAULT_MIX }; }
  catch (e) { mixCache.at = Date.now(); }
  return mixCache.mix;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Turn one evaluation output document into an Arena event. Pure.
 * Tolerant of the two field spellings Connect has used for the total score.
 */
function translate(doc, opts) {
  opts = opts || {};
  const total = doc.evaluationFormTotalScore || doc.evaluationTotalScore || doc.totalScore || doc.score || {};
  const pct = num(total.percentage);
  const autoFail = total.automaticFail === true || total.autoFail === true;
  if (pct === null && !autoFail) return null;
  const agentId = doc.agentId || doc.agentArn;
  if (!agentId || !doc.evaluationId) return null;
  const arn = String(agentId).startsWith('arn:') ? agentId
    : `arn:aws:connect:${opts.region || REGION}:${opts.account || ACCOUNT}:instance/${doc.instanceId}/agent/${agentId}`;
  const ts = doc.evaluationSubmitTimestamp || doc.evaluationEndTimestamp || new Date().toISOString();
  return {
    EventType: 'EVALUATION_SUBMITTED', AgentARN: arn, EventTimestamp: ts,
    Score: autoFail ? 0 : Math.round(pct), AutoFail: autoFail || undefined,
    Reason: autoFail ? failReason(doc) : undefined,
    ContactId: doc.contactId, EvaluationId: doc.evaluationId, Form: doc.evaluationDefinitionTitle || doc.evaluationFormTitle,
    Evaluator: doc.evaluator, DedupKey: 'EVAL#' + doc.evaluationId,
  };
}

/** First auto-failed question title, for the agent's points feed. */
function failReason(doc) {
  for (const s of doc.sections || []) for (const q of s.questions || []) {
    const sc = q.score || {};
    if (sc.automaticFail === true || sc.autoFail === true) return q.questionTitle || q.title || 'policy';
  }
  return 'policy';
}

/** Accepts an EventBridge S3 event or an S3 notification event; returns [{bucket,key}]. */
function objects(event) {
  if (event.detail && event.detail.bucket) return [{ bucket: event.detail.bucket.name, key: decodeURIComponent(event.detail.object.key) }];
  return (event.Records || []).filter((r) => r.s3).map((r) => ({ bucket: r.s3.bucket.name, key: decodeURIComponent(r.s3.object.key.replace(/\+/g, ' ')) }));
}

exports.handler = async (event) => {
  const mix = await currentMix();
  let scored = 0, skipped = 0;
  for (const { bucket, key } of objects(event)) {
    if (!key.endsWith('.json')) { skipped++; continue; }
    const doc = await readObject(bucket, key);
    const ev = translate(doc);
    if (!ev) { console.warn('no score in', key); skipped++; continue; }
    const live = await store.getLive(ev.AgentARN);
    if (live) { ev.Team = live.team; ev.Username = live.username; }
    const points = Arena.scoreEvent('EVALUATION_SUBMITTED', ev, mix);
    const applied = await store.apply(store.planWrites(ev, points));
    if (applied) scored++; else { skipped++; console.info('duplicate evaluation', doc.evaluationId); }
  }
  return { scored, skipped };
};

exports.translate = translate;
exports.objects = objects;
