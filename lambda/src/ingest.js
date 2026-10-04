/*
 * Arena ingest Lambda for the Amazon Connect agent event stream.
 *
 * Trigger: Kinesis Data Stream event source mapping (agent event stream).
 * One stream carries both signals the leaderboard needs:
 *   STATE_CHANGE / LOGIN / LOGOUT        -> AGENT_STATE_CHANGE
 *   a contact flipping to ENDED in the    -> CONTACT_HANDLED with HandleTime from
 *   agent's snapshot                         ConnectedToAgentTimestamp
 * so no separate contact record stream is needed.
 *
 * Optional: point Connect's contact record stream at the same Kinesis stream and set
 * CSAT_ATTRIBUTE to the contact attribute your survey flow writes (default "csat").
 * Each contact record that carries it becomes a CSAT_RECEIVED event for the agent.
 */
'use strict';
const Arena = require('./arena-engine.js');
const store = require('./store.js');

let mixCache = { at: 0, mix: Arena.DEFAULT_MIX };
async function currentMix() {
  if (Date.now() - mixCache.at < 60000) return mixCache.mix;
  try { mixCache = { at: Date.now(), mix: (await store.getMix()) || Arena.DEFAULT_MIX }; }
  catch (e) { mixCache.at = Date.now(); }
  return mixCache.mix;
}

/** Turn one raw Connect agent event into zero or more Arena events. Pure, so it is unit-testable. */
function translate(raw) {
  const out = [];
  const arn = raw.AgentARN, ts = raw.EventTimestamp;
  const cur = raw.CurrentAgentSnapshot || {}, prev = raw.PreviousAgentSnapshot || {};
  const curState = cur.AgentStatus && cur.AgentStatus.Name, prevState = prev.AgentStatus && prev.AgentStatus.Name;
  const team = cur.Configuration && cur.Configuration.RoutingProfile && cur.Configuration.RoutingProfile.Name;
  const username = cur.Configuration && cur.Configuration.Username;
  const name = [cur.Configuration && cur.Configuration.FirstName, cur.Configuration && cur.Configuration.LastName].filter(Boolean).join(' ') || undefined;

  if (raw.EventType === 'LOGIN' || raw.EventType === 'LOGOUT' || (raw.EventType === 'STATE_CHANGE' && curState !== prevState)) {
    out.push({ EventType: 'AGENT_STATE_CHANGE', AgentARN: arn, EventTimestamp: ts, State: raw.EventType === 'LOGOUT' ? 'Offline' : curState || 'Unknown', Team: team, Username: username, Name: name });
  }

  // A contact that was not ENDED before and is ENDED now has just been handled.
  const prevById = Object.fromEntries((prev.Contacts || []).map((c) => [c.ContactId, c]));
  for (const c of cur.Contacts || []) {
    const before = prevById[c.ContactId];
    if (c.State === 'ENDED' && (!before || before.State !== 'ENDED') && c.ConnectedToAgentTimestamp) {
      const handle = Math.max(0, Math.round((Date.parse(ts) - Date.parse(c.ConnectedToAgentTimestamp)) / 1000));
      out.push({ EventType: 'CONTACT_HANDLED', AgentARN: arn, EventTimestamp: ts, ContactId: c.ContactId, Queue: c.Queue && c.Queue.Name, Channel: c.Channel, HandleTime: handle, Team: team, Username: username, Name: name });
    }
  }
  return out;
}

const CSAT_ATTRIBUTE = process.env.CSAT_ATTRIBUTE || 'csat';

/** A contact record (CTR) has no EventType and carries Agent and Attributes; an agent event has EventType and snapshots. */
const isContactRecord = (raw) => !!raw && !raw.EventType && !!raw.ContactId && (!!raw.AWSContactTraceRecordFormatVersion || !!raw.Agent);

/** Survey answers arrive on different scales. Everything is brought to 1..5: 0-10 is halved, 0-100 is divided by 20. */
function normalizeCsat(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n) || n < 0) return null;
  const five = n > 10 ? n / 20 : n > 5 ? n / 2 : n;
  return Math.round(Math.max(1, Math.min(5, five)) * 10) / 10;
}

/** Turn one contact record into a CSAT_RECEIVED event when it carries the survey attribute. Pure. */
function translateContactRecord(raw, attribute) {
  const agent = raw.Agent || {};
  const score = normalizeCsat((raw.Attributes || {})[attribute || CSAT_ATTRIBUTE]);
  if (!agent.ARN || score === null) return [];
  return [{ EventType: 'CSAT_RECEIVED', AgentARN: agent.ARN, EventTimestamp: raw.DisconnectTimestamp || raw.LastUpdateTimestamp || new Date().toISOString(),
    ContactId: raw.ContactId, Score: score, Queue: raw.Queue && raw.Queue.Name, Channel: raw.Channel,
    Team: agent.RoutingProfile && agent.RoutingProfile.Name, Username: agent.Username, DedupKey: 'CSAT#' + raw.ContactId }];
}

function decode(record) { return JSON.parse(Buffer.from(record.kinesis.data, 'base64').toString('utf8')); }

exports.handler = async (event) => {
  const mix = await currentMix();
  const failures = [];
  for (const record of event.Records || []) {
    try {
      const raw = decode(record);
      for (const ev of isContactRecord(raw) ? translateContactRecord(raw) : translate(raw)) {
        if (!ev.Team) { const live = await store.getLive(ev.AgentARN); if (live) { ev.Team = live.team; ev.Username = ev.Username || live.username; } }
        await store.apply(store.planWrites(ev, Arena.scoreEvent(ev.EventType, ev, mix)));
      }
    } catch (err) {
      console.error('record failed', record.kinesis && record.kinesis.sequenceNumber, err);
      failures.push({ itemIdentifier: record.kinesis.sequenceNumber });
    }
  }
  // Partial batch response: only the failed records are retried, the rest are checkpointed.
  return { batchItemFailures: failures };
};

exports.translate = translate;
exports.translateContactRecord = translateContactRecord;
exports.normalizeCsat = normalizeCsat;
exports.isContactRecord = isContactRecord;
exports.decode = decode;
