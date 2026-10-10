/*
 * Evaluation acknowledgements: points for an agent who reads and acknowledges their Contact Lens evaluation.
 *
 * Amazon Connect records the acknowledgement on the evaluation itself (DescribeContactEvaluation returns an
 * Acknowledgement block with who and when), but the evaluation export file lands at submit time, before the agent
 * has seen it. So the evaluations handler leaves a pending row per submitted evaluation (pk ACK) and this job, hourly,
 * asks Connect which of them have been acknowledged. Each acknowledged one becomes an EVALUATION_ACKNOWLEDGED event,
 * once (DedupKey ACK#<evaluationId>), on the day of the acknowledgement. Pending rows expire after ACK_DAYS.
 */
'use strict';
const Arena = require('./arena-engine.js');
const store = require('./store.js');
const { mixFor } = require('./mix.js');

const ACK_DAYS = +(process.env.ACK_DAYS || 30);

let cc;
function connect(region) {
  if (cc) return cc;
  const { ConnectClient, DescribeContactEvaluationCommand } = require('@aws-sdk/client-connect');
  cc = { client: new ConnectClient(region ? { region } : {}), DescribeContactEvaluationCommand };
  return cc;
}

/** Pure: the pending row plus Connect's answer -> the event to score, or null when not acknowledged yet. */
function toEvent(pending, evaluation) {
  const ack = evaluation && evaluation.Evaluation && evaluation.Evaluation.Acknowledgement;
  if (!ack || !ack.AcknowledgedTime) return null;
  const at = ack.AcknowledgedTime instanceof Date ? ack.AcknowledgedTime.toISOString() : new Date(ack.AcknowledgedTime).toISOString();
  return { EventType: 'EVALUATION_ACKNOWLEDGED', AgentARN: pending.agent, EventTimestamp: at, EvaluationId: pending.evaluationId, ContactId: pending.contactId,
    Score: pending.score, Team: pending.team, Username: pending.username, Name: pending.name, DedupKey: 'ACK#' + pending.evaluationId };
}

/** arn:aws:connect:region:acct:instance/<id>/agent/<id> -> { instanceId, region } */
function instanceOf(arn) {
  const m = /^arn:aws:connect:([a-z0-9-]+):\d+:instance\/([^/]+)\//.exec(arn || '');
  return m ? { region: m[1], instanceId: m[2] } : null;
}

async function runFor(now, deps) {
  deps = deps || {};
  const s = deps.store || store;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const pending = await s.listAcks();
  let checked = 0, scored = 0, expired = 0, points = 0;
  for (const p of pending) {
    if (nowMs - Date.parse(p.submittedAt) > ACK_DAYS * 86400000) { await s.deleteAck(p.evaluationId); expired++; continue; }
    const inst = instanceOf(p.agent);
    if (!inst) { await s.deleteAck(p.evaluationId); expired++; continue; }
    const c = deps.connect || connect(inst.region);
    let r;
    try { r = await c.client.send(new c.DescribeContactEvaluationCommand({ InstanceId: inst.instanceId, EvaluationId: p.evaluationId })); }
    catch (e) { if (e.name === 'ResourceNotFoundException') { await s.deleteAck(p.evaluationId); expired++; continue; } throw e; }
    checked++;
    const ev = toEvent(p, r);
    if (!ev) continue;
    const pts = Arena.scoreEvent('EVALUATION_ACKNOWLEDGED', ev, await mixFor(s, ev.Team));
    if (await s.apply(store.planWrites(ev, pts, nowMs)) !== false) { scored++; points += pts; }
    await s.deleteAck(p.evaluationId);
  }
  return { pending: pending.length, checked, scored, expired, points };
}

exports.handler = async (event, context, deps) => {
  const r = await runFor((deps && deps.now) ? deps.now() : Date.now(), deps);
  console.log(JSON.stringify(r));
  return r;
};
exports.runFor = runFor;
exports.toEvent = toEvent;
exports.instanceOf = instanceOf;
