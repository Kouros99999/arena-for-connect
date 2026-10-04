/*
 * Arena ingest Lambda for Contact Lens conversational analytics.
 *
 * Trigger: EventBridge "Object Created" from the bucket Connect writes analysis output to
 *          (Analysis/Voice/YYYY/MM/DD/<contactId>_analysis_<time>.json, and Analysis/Chat/...).
 * Output:  one SENTIMENT_SCORED event per analysed contact, carrying the customer's overall
 *          sentiment (-5..5), scored by the shared engine and deduped on the contact id.
 *
 * The analysis file names the contact but not the agent, so the agent comes from the
 * CONTACT#<id> marker the agent-event ingest writes when the contact is handled. If the
 * analysis lands first the function fails on purpose and EventBridge retries it.
 */
'use strict';
const Arena = require('./arena-engine.js');
const store = require('./store.js');

let s3;
async function readObject(bucket, key) {
  if (!s3) { const sdk = require('@aws-sdk/client-s3'); s3 = { client: new sdk.S3Client({}), GetObjectCommand: sdk.GetObjectCommand }; }
  const r = await s3.client.send(new s3.GetObjectCommand({ Bucket: bucket, Key: key }));
  return JSON.parse(await r.Body.transformToString());
}

let mixCache = { at: 0, mix: Arena.DEFAULT_MIX };
async function currentMix(s) {
  if (Date.now() - mixCache.at < 60000) return mixCache.mix;
  try { mixCache = { at: Date.now(), mix: (await s.getMix()) || Arena.DEFAULT_MIX }; }
  catch (e) { mixCache.at = Date.now(); }
  return mixCache.mix;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Turn one Contact Lens analysis document into an Arena event without an agent yet. Pure. */
function translate(doc, nowIso) {
  const contactId = doc && doc.CustomerMetadata && doc.CustomerMetadata.ContactId;
  const overall = doc && doc.ConversationCharacteristics && doc.ConversationCharacteristics.Sentiment && doc.ConversationCharacteristics.Sentiment.OverallSentiment;
  const customer = overall ? num(overall.CUSTOMER) : null;
  if (!contactId || customer === null) return null;
  const clamp = Math.max(-5, Math.min(5, customer));
  return {
    EventType: 'SENTIMENT_SCORED', EventTimestamp: nowIso || new Date().toISOString(), ContactId: contactId,
    Sentiment: Math.round(clamp * 10) / 10, AgentSentiment: num(overall.AGENT) === null ? undefined : Math.round(overall.AGENT * 10) / 10,
    Channel: doc.Channel, DedupKey: 'SENT#' + contactId,
  };
}

/** Accepts an EventBridge S3 event or an S3 notification event; returns [{bucket,key}]. */
function objects(event) {
  if (event.detail && event.detail.bucket) return [{ bucket: event.detail.bucket.name, key: decodeURIComponent(event.detail.object.key) }];
  return (event.Records || []).filter((r) => r.s3).map((r) => ({ bucket: r.s3.bucket.name, key: decodeURIComponent(r.s3.object.key.replace(/\+/g, ' ')) }));
}

exports.handler = async (event, context, deps) => {
  const s = (deps && deps.store) || store, read = (deps && deps.readObject) || readObject;
  const mix = await currentMix(s);
  let scored = 0, skipped = 0;
  for (const { bucket, key } of objects(event)) {
    // Connect writes a redacted copy beside the original; one score per contact is enough.
    if (!key.endsWith('.json') || /\/Redacted\//i.test(key)) { skipped++; continue; }
    const ev = translate(await read(bucket, key));
    if (!ev) { console.warn('no sentiment in', key); skipped++; continue; }
    const contact = await s.getContact(ev.ContactId);
    if (!contact) throw new Error('contact ' + ev.ContactId + ' not seen on the agent event stream yet; retrying');
    Object.assign(ev, { AgentARN: contact.agent, Team: contact.team, Username: contact.username, Name: contact.name });
    const points = Arena.scoreEvent('SENTIMENT_SCORED', ev, mix);
    const applied = await s.apply(store.planWrites(ev, points));
    if (applied === false) { skipped++; console.info('duplicate analysis', ev.ContactId); } else scored++;
  }
  return { scored, skipped };
};

exports.translate = translate;
exports.objects = objects;
