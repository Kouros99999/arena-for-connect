/*
 * Arena ingest Lambda for the Amazon Connect agent event stream.
 *
 * Trigger: Kinesis Data Stream event source mapping (agent event stream).
 * One stream carries both signals the leaderboard needs:
 *   STATE_CHANGE / LOGIN / LOGOUT        -> AGENT_STATE_CHANGE
 *   a contact flipping to ENDED in the    -> CONTACT_HANDLED with HandleTime from
 *   agent's snapshot                         ConnectedToAgentTimestamp
 * so no separate contact record stream is needed.
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

function decode(record) { return JSON.parse(Buffer.from(record.kinesis.data, 'base64').toString('utf8')); }

exports.handler = async (event) => {
  const mix = await currentMix();
  const failures = [];
  for (const record of event.Records || []) {
    try {
      for (const ev of translate(decode(record))) {
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
exports.decode = decode;
