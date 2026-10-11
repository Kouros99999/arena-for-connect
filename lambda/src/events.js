/*
 * Arena's canonical events: the only thing a platform connector has to produce.
 *
 * Every connector (Amazon Connect's stream and files today, the generic ingest endpoint, future Genesys or Five9
 * connectors) turns what its platform knows into these five scoring events plus the state change. Everything above
 * this layer, from points to the pages, is platform-neutral.
 *
 *   type                  fields
 *   CONTACT_HANDLED       contactId, handleTime (seconds), queue?, channel?, escalated?
 *   EVALUATION_SUBMITTED  evaluationId, score (0-100) or autoFail: true, form?, reason?
 *   SENTIMENT_SCORED      contactId, sentiment (-5..5)
 *   CSAT_RECEIVED         contactId, score (1-5, 0-10 or 0-100; normalised to 1-5)
 *   ADHERENCE_SCORED      day (YYYY-MM-DD), adherence (percent), adherentHours, scheduledHours?
 *   AGENT_STATE_CHANGE    state
 *   common                agent (the platform's id for the person), at (ISO time), team?, username?, name?
 *
 * normalize() validates one external event and returns the internal shape the store writes, with a DedupKey so a
 * connector may send the same thing twice. Pure.
 */
'use strict';

const TYPES = ['CONTACT_HANDLED', 'EVALUATION_SUBMITTED', 'SENTIMENT_SCORED', 'CSAT_RECEIVED', 'ADHERENCE_SCORED', 'AGENT_STATE_CHANGE'];
const str = (v, max) => (v == null ? undefined : String(v).trim().slice(0, max || 200) || undefined);
const num = (v) => (v === '' || v == null ? NaN : Number(v));
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 1-5, 0-10 and 0-100 survey scales all land on 1-5. */
function normalizeCsat(n) {
  if (!Number.isFinite(n)) return null;
  if (n > 10) return Math.max(1, Math.min(5, 1 + (n / 100) * 4));
  if (n > 5) return Math.max(1, Math.min(5, 1 + (n / 10) * 4));
  return Math.max(1, Math.min(5, n));
}

function normalize(e, nowIso) {
  if (!e || typeof e !== 'object') throw new Error('each event must be an object');
  const type = str(e.type, 40);
  if (!TYPES.includes(type)) throw new Error(`type must be one of ${TYPES.join(', ')}`);
  const agent = str(e.agent, 300);
  if (!agent) throw new Error('agent is required: the platform\'s id for the person');
  const at = e.at ? new Date(e.at) : new Date(nowIso || Date.now());
  if (isNaN(at)) throw new Error('at must be an ISO 8601 time');
  const out = { EventType: type, AgentARN: agent, EventTimestamp: at.toISOString(), Team: str(e.team, 120), Username: str(e.username, 120), Name: str(e.name, 120), Source: str(e.source, 40) || 'ingest' };
  switch (type) {
    case 'CONTACT_HANDLED': {
      const ht = num(e.handleTime);
      if (!Number.isFinite(ht) || ht < 0 || ht > 86400) throw new Error('handleTime must be seconds, 0 to 86400');
      out.ContactId = str(e.contactId, 200); out.HandleTime = Math.round(ht); out.Queue = str(e.queue, 120); out.Channel = str(e.channel, 40); out.Escalated = e.escalated === true || undefined;
      if (out.ContactId) out.DedupKey = 'CT#' + out.ContactId;
      break;
    }
    case 'EVALUATION_SUBMITTED': {
      const id = str(e.evaluationId, 200); if (!id) throw new Error('evaluationId is required');
      const autoFail = e.autoFail === true, score = num(e.score);
      if (!autoFail && (!Number.isFinite(score) || score < 0 || score > 100)) throw new Error('score must be 0 to 100, or autoFail true');
      out.EvaluationId = id; out.Score = autoFail ? 0 : Math.round(score); out.AutoFail = autoFail || undefined; out.Form = str(e.form, 120); out.Reason = autoFail ? str(e.reason, 200) || 'policy' : undefined; out.ContactId = str(e.contactId, 200);
      out.DedupKey = 'EVAL#' + id;
      break;
    }
    case 'SENTIMENT_SCORED': {
      const id = str(e.contactId, 200); if (!id) throw new Error('contactId is required');
      const s = num(e.sentiment); if (!Number.isFinite(s) || s < -5 || s > 5) throw new Error('sentiment must be -5 to 5');
      out.ContactId = id; out.Sentiment = Math.round(s * 10) / 10; out.DedupKey = 'SENT#' + id;
      break;
    }
    case 'CSAT_RECEIVED': {
      const id = str(e.contactId, 200); if (!id) throw new Error('contactId is required');
      const s = normalizeCsat(num(e.score)); if (s === null) throw new Error('score must be a number on a 1-5, 0-10 or 0-100 scale');
      out.ContactId = id; out.Score = Math.round(s * 10) / 10; out.DedupKey = 'CSAT#' + id;
      break;
    }
    case 'ADHERENCE_SCORED': {
      if (!isDay(e.day)) throw new Error('day must be YYYY-MM-DD');
      const pct = num(e.adherence), hrs = num(e.adherentHours);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('adherence must be a percentage');
      if (!Number.isFinite(hrs) || hrs < 0 || hrs > 24) throw new Error('adherentHours must be 0 to 24');
      out.Day = e.day; out.Adherence = Math.round(pct * 10) / 10; out.AdherentHours = Math.round(hrs * 10) / 10; out.ScheduledHours = Number.isFinite(num(e.scheduledHours)) ? Math.round(num(e.scheduledHours) * 10) / 10 : undefined;
      out.DedupKey = `ADH#${e.day}#${agent.split('/').pop()}`;
      if (!e.at) out.EventTimestamp = e.day + 'T23:59:59.000Z';
      break;
    }
    case 'AGENT_STATE_CHANGE': {
      out.State = str(e.state, 60) || 'Unknown';
      break;
    }
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

module.exports = { TYPES, normalize, normalizeCsat };
