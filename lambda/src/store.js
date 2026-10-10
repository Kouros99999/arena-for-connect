/*
 * DynamoDB layer shared by the ingest Lambda and the API Lambda.
 *
 * Table: arena (single table, on-demand)
 *   pk=AGENT#<arn>  sk=LIVE               agentState, lastEvent, username, team, streak
 *   pk=AGENT#<arn>  sk=DAY#2026-09-15     points, handled, ahtSum, evals[], autofails, kudosReceived, escalations,
 *                                          sentSum, sentCount (customer sentiment), csatSum, csatCount (survey scores)
 *   pk=CONTACT#<id> sk=AGENT              who handled a contact; lets Contact Lens analysis find the agent. ttl 14 days
 *   pk=TEAMITEMS#<team> sk=CH#|RW#|KD#|CO# challenges, rewards, kudos feed, coaching plans
 *   pk=AGENT#<arn>  sk=WEEK#2026-W38      same shape, weekly
 *   pk=AGENT#<arn>  sk=EV#<ts>#<type>     ledger row, ttl 90 days
 *   pk=CONFIG       sk=MIX                scoring mix
 *   pk=CONFIG       sk=NOTIFY#<team>      where the team hears about Arena (webhooks, email, digest hour)
 *   pk=DIGEST       sk=<team>#<day>       digest sent marker
 *   gsi1: gsi1pk=TEAM#<team>#DAY#<date> | TEAM#<team>#WEEK#<week> | TEAM#<team>#LIVE, gsi1sk=AGENT#<arn>
 */
'use strict';

const TABLE = process.env.TABLE || 'arena';
const clock = require('./clock.js');
const TTL_DAYS = +(process.env.TTL_DAYS || 90);

let ddb, cmds;
function db() {
  if (ddb) return ddb;
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const lib = require('@aws-sdk/lib-dynamodb');
  cmds = lib;
  ddb = lib.DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  return ddb;
}

// ---------- pure helpers ----------
// Day and week keys are calendar periods in the stack's time zone (clock.js, ARENA_TZ; UTC by default).
const dayKey = (iso) => clock.dayKey(iso);
const weekKey = (iso) => clock.weekKey(iso);
const keys = {
  agent: (arn) => 'AGENT#' + arn,
  team: (team, kind, period) => `TEAM#${team}#${kind}${period ? '#' + period : ''}`,
  teamItems: (team) => 'TEAMITEMS#' + team,   // challenges (CH#), rewards (RW#), kudos feed (KD#)
};

/** Build the writes for one scored event. Pure, returned as plain objects so it can be tested. */
function planWrites(ev, points, now) {
  now = now || Date.now();
  const pk = keys.agent(ev.AgentARN), ts = ev.EventTimestamp, team = ev.Team || 'unassigned';
  const isContact = ev.EventType === 'CONTACT_HANDLED', isEval = ev.EventType === 'EVALUATION_SUBMITTED';
  const isSent = ev.EventType === 'SENTIMENT_SCORED', isCsat = ev.EventType === 'CSAT_RECEIVED', isAdh = ev.EventType === 'ADHERENCE_SCORED', isBackfill = ev.EventType === 'BACKFILL_DAY';
  const writes = [];

  // Optional idempotency marker. A conditional put that fails aborts the rest of the plan.
  if (ev.DedupKey) writes.push({ op: 'put', item: { pk, sk: `SEEN#${ev.DedupKey}`, at: ts, ttl: Math.floor(now / 1000) + TTL_DAYS * 86400 }, condition: 'attribute_not_exists(pk)' });

  writes.push({ op: 'put', item: { pk, sk: `EV#${ts}#${ev.EventType}`, ...ev, points, ttl: Math.floor(now / 1000) + TTL_DAYS * 86400 } });

  const liveSet = ['lastEvent = :ts', 'team = :team', 'username = if_not_exists(username, :user)'];
  if (ev.State) liveSet.push('agentState = :state');
  if (ev.Name) liveSet.push('displayName = :name');
  writes.push({ op: 'update', key: { pk, sk: 'LIVE' },
    expr: 'SET ' + liveSet.join(', ') + ', gsi1pk = :g1, gsi1sk = :g2',
    values: { ':ts': ts, ':team': team, ':user': ev.Username || ev.AgentARN, ':g1': keys.team(team, 'LIVE'), ':g2': pk, ...(ev.State ? { ':state': ev.State } : {}), ...(ev.Name ? { ':name': ev.Name } : {}) } });

  // Kudos also land on a team feed so the console and wallboard can list them without scanning agents.
  if (ev.EventType === 'KUDOS') writes.push({ op: 'put', item: { pk: keys.teamItems(team), sk: `KD#${ts}#${ev.AgentARN.split('/').pop()}`, at: ts, from: ev.From, to: ev.AgentARN, toName: ev.ToName || ev.Username || ev.AgentARN.split('/').pop(), note: ev.Note, ttl: Math.floor(now / 1000) + TTL_DAYS * 86400 } });

  if (points !== 0 || isContact || isEval || isSent || isCsat || isAdh || isBackfill || ev.EventType === 'KUDOS') {
    for (const [kind, period] of [['DAY', dayKey(ts)], ['WEEK', weekKey(ts)]]) {
      const values = { ':p': points, ':h': isContact ? 1 : isBackfill ? ev.Handled || 0 : 0, ':aht': isContact ? ev.HandleTime || 0 : isBackfill ? ev.AhtSum || 0 : 0,
        ':esc': isContact && ev.Escalated ? 1 : 0, ':af': isEval && ev.AutoFail ? 1 : 0, ':k': ev.EventType === 'KUDOS' ? 1 : 0,
        ':ss': isSent ? ev.Sentiment : 0, ':sc': isSent ? 1 : 0, ':cs': isCsat ? ev.Score : 0, ':cc': isCsat ? 1 : 0,
        ':ah': isAdh ? ev.AdherentHours || 0 : 0, ':as': isAdh ? ev.Adherence || 0 : 0, ':ac': isAdh ? 1 : 0,
        ':g1': keys.team(team, kind, period), ':g2': pk, ':user': ev.Username || ev.AgentARN, ':empty': [] };
      let expr = 'SET gsi1pk = :g1, gsi1sk = :g2, username = if_not_exists(username, :user)';
      if (isEval) { expr += ', evals = list_append(if_not_exists(evals, :empty), :ev)'; values[':ev'] = [ev.AutoFail ? 0 : ev.Score]; }
      else if (isBackfill && ev.Evaluations > 0 && ev.EvalScore != null) { expr += ', evals = list_append(if_not_exists(evals, :empty), :ev)'; values[':ev'] = Array.from({ length: Math.min(10, ev.Evaluations) }, () => ev.EvalScore); }
      else expr += ', evals = if_not_exists(evals, :empty)';
      expr += ' ADD points :p, handled :h, ahtSum :aht, escalations :esc, autofails :af, kudosReceived :k, sentSum :ss, sentCount :sc, csatSum :cs, csatCount :cc, adherenceHours :ah, adhSum :as, adhCount :ac';
      writes.push({ op: 'update', key: { pk, sk: `${kind}#${period}` }, expr, values });
    }
  }
  // Remember who handled the contact so analysis that arrives later (and names only the contact) can be scored for the right agent.
  if (isContact && ev.ContactId) writes.push({ op: 'put', item: { pk: 'CONTACT#' + ev.ContactId, sk: 'AGENT', agent: ev.AgentARN, team, username: ev.Username, name: ev.Name, at: ts, ttl: Math.floor(now / 1000) + 14 * 86400 } });
  return writes;
}

/** Applies a plan in order. Returns false (and stops) if a conditional write finds the item already there. */
async function apply(writes) {
  const d = db();
  for (const w of writes) {
    if (w.op === 'put') {
      try { await d.send(new cmds.PutCommand({ TableName: TABLE, Item: w.item, ConditionExpression: w.condition })); }
      catch (e) { if (e.name === 'ConditionalCheckFailedException') return false; throw e; }
    } else await d.send(new cmds.UpdateCommand({ TableName: TABLE, Key: w.key, UpdateExpression: w.expr, ExpressionAttributeValues: w.values }));
  }
  return true;
}

/** A LIVE row for an agent the stream has not seen yet (backfill). Leaves lastEvent alone so metering ignores them until they work. */
async function seedLive(arn, f) {
  const team = f.team || 'unassigned';
  await db().send(new cmds.UpdateCommand({ TableName: TABLE, Key: { pk: keys.agent(arn), sk: 'LIVE' },
    UpdateExpression: 'SET team = if_not_exists(team, :team), username = if_not_exists(username, :u), displayName = if_not_exists(displayName, :n), gsi1pk = if_not_exists(gsi1pk, :g1), gsi1sk = if_not_exists(gsi1sk, :g2)',
    ExpressionAttributeValues: { ':team': team, ':u': f.username || arn, ':n': f.displayName || f.username || arn.split('/').pop(), ':g1': keys.team(team, 'LIVE'), ':g2': keys.agent(arn) } }));
}
// ---------- pending evaluation acknowledgements: pk ACK, sk <evaluationId> ----------
async function putAck(a) { await db().send(new cmds.PutCommand({ TableName: TABLE, Item: Object.assign({ pk: 'ACK', sk: a.evaluationId, ttl: Math.floor(Date.now() / 1000) + 45 * 86400 }, a) })); }
async function deleteAck(evaluationId) { await db().send(new cmds.DeleteCommand({ TableName: TABLE, Key: { pk: 'ACK', sk: evaluationId } })); }
async function listAcks() {
  const d = db(); const out = []; let ExclusiveStartKey;
  do {
    const r = await d.send(new cmds.QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': 'ACK' }, ExclusiveStartKey }));
    out.push(...(r.Items || [])); ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}
/** LIVE row for one agent, or null. Used to attach team and username to events that do not carry them. */
async function getLive(arn) {
  const r = await db().send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: keys.agent(arn), sk: 'LIVE' } }));
  return r.Item || null;
}

async function queryGsi(gsi1pk) {
  const d = db(); const out = []; let ExclusiveStartKey;
  do {
    const r = await d.send(new cmds.QueryCommand({ TableName: TABLE, IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :k', ExpressionAttributeValues: { ':k': gsi1pk }, ExclusiveStartKey }));
    out.push(...(r.Items || [])); ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

/** Merge LIVE, DAY and WEEK rows into the agent shape the engine and pages already use. */
function mergeTeam(live, day, week) {
  const byArn = new Map();
  const get = (pk) => { if (!byArn.has(pk)) byArn.set(pk, { id: pk.replace(/^AGENT#/, ''), today: 0, week: 0, handled: 0, ahtSum: 0, evals: [], autofails: 0, kudosReceived: 0, escalations: 0, streak: 0, adherenceHours: 0, state: 'Offline', lastEvent: 0 }); return byArn.get(pk); };
  for (const r of live) { const a = get(r.pk); a.name = r.displayName || r.username; a.username = r.username; a.state = r.agentState || 'Offline'; a.lastEvent = r.lastEvent ? Date.parse(r.lastEvent) : 0; a.streak = r.streak || 0; a.team = r.team; a.personalBest = !!(r.prefs && r.prefs.personalBest); }
  for (const r of day) { const a = get(r.pk); Object.assign(a, { today: r.points || 0, handled: r.handled || 0, ahtSum: r.ahtSum || 0, evals: r.evals || [], autofails: r.autofails || 0, kudosReceived: r.kudosReceived || 0, escalations: r.escalations || 0,
    sentSum: r.sentSum || 0, sentCount: r.sentCount || 0, csatSum: r.csatSum || 0, csatCount: r.csatCount || 0, adherenceHours: r.adherenceHours || 0, adhSum: r.adhSum || 0, adhCount: r.adhCount || 0 }); a.name = a.name || r.username; }
  for (const r of week) { const a = get(r.pk); a.week = r.points || 0; a.name = a.name || r.username; }
  return [...byArn.values()].map((a) => { a.name = a.name || a.id.split('/').pop(); return a; });
}

async function getTeam(team, iso) {
  const [live, day, week] = await Promise.all([
    queryGsi(keys.team(team, 'LIVE')), queryGsi(keys.team(team, 'DAY', dayKey(iso))), queryGsi(keys.team(team, 'WEEK', weekKey(iso))),
  ]);
  return mergeTeam(live, day, week);
}

/** Who handled a contact, or null if the agent event stream has not reported it (yet). */
async function getContact(contactId) {
  const r = await db().send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: 'CONTACT#' + contactId, sk: 'AGENT' } }));
  return r.Item || null;
}
const getTeamLive = (team) => queryGsi(keys.team(team, 'LIVE'));
/** Day rows for a team on each of the given dates: { 'YYYY-MM-DD': [rows] }. One small query per day, twenty at a time. */
async function getTeamDays(team, dates) {
  const out = {};
  for (let i = 0; i < dates.length; i += 20)
    await Promise.all(dates.slice(i, i + 20).map(async (d) => { out[d] = await queryGsi(keys.team(team, 'DAY', d)); }));
  return out;
}
/** One agent's day rows between two dates, inclusive. A single query on the agent's partition. */
async function getAgentDays(arn, fromDay, toDay) {
  const r = await db().send(new cmds.QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk AND sk BETWEEN :a AND :b',
    ExpressionAttributeValues: { ':pk': keys.agent(arn), ':a': 'DAY#' + fromDay, ':b': 'DAY#' + toDay } }));
  return r.Items || [];
}

async function listEvents(arn, limit) {
  const d = db();
  const r = await d.send(new cmds.QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :ev)',
    ExpressionAttributeValues: { ':pk': keys.agent(arn), ':ev': 'EV#' }, ScanIndexForward: false, Limit: limit || 20 }));
  return r.Items || [];
}

// ---------- team items: challenges, rewards, kudos feed ----------
async function listTeamItems(team, prefix, limit, newestFirst) {
  const r = await db().send(new cmds.QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
    ExpressionAttributeValues: { ':pk': keys.teamItems(team), ':p': prefix }, ScanIndexForward: !newestFirst, Limit: limit || 50 }));
  return r.Items || [];
}
async function putTeamItem(team, sk, item) {
  await db().send(new cmds.PutCommand({ TableName: TABLE, Item: Object.assign({ pk: keys.teamItems(team), sk }, item) }));
  return item;
}
async function getTeamItem(team, sk) {
  const r = await db().send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: keys.teamItems(team), sk } }));
  return r.Item || null;
}
/** Update named fields on a team item. Returns the updated item or null if it does not exist. */
async function updateTeamItem(team, sk, fields) {
  const names = {}, values = {}, sets = [];
  Object.entries(fields).forEach(([k, v], i) => { names['#f' + i] = k; values[':v' + i] = v; sets.push(`#f${i} = :v${i}`); });
  try {
    const r = await db().send(new cmds.UpdateCommand({ TableName: TABLE, Key: { pk: keys.teamItems(team), sk }, UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeNames: names, ExpressionAttributeValues: values, ConditionExpression: 'attribute_exists(pk)', ReturnValues: 'ALL_NEW' }));
    return r.Attributes;
  } catch (e) { if (e.name === 'ConditionalCheckFailedException') return null; throw e; }
}
/** Spend points from an agent's week total (reward approval). */
async function spendPoints(arn, iso, cost) {
  await db().send(new cmds.UpdateCommand({ TableName: TABLE, Key: { pk: keys.agent(arn), sk: `WEEK#${weekKey(iso)}` }, UpdateExpression: 'ADD points :c', ExpressionAttributeValues: { ':c': -cost } }));
}

// ---------- agent data deletion ----------
/** Every row in an agent's partition, plus their reward requests, coaching plans and kudos addressed to them on the team feed. Returns the keys. */
async function agentRowKeys(arn, team) {
  const d = db(); const keysOut = []; let ExclusiveStartKey;
  do {
    const r = await d.send(new cmds.QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': keys.agent(arn) }, ProjectionExpression: 'pk, sk', ExclusiveStartKey }));
    keysOut.push(...(r.Items || [])); ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  if (team) {
    for (const item of await listTeamItems(team, 'RW#', 500)) if (item.agentId === arn) keysOut.push({ pk: item.pk, sk: item.sk });
    for (const item of await listTeamItems(team, 'KD#', 500)) if (item.to === arn) keysOut.push({ pk: item.pk, sk: item.sk });
    for (const item of await listTeamItems(team, 'CO#', 500)) if (item.agentId === arn) keysOut.push({ pk: item.pk, sk: item.sk });
  }
  return keysOut;
}
async function deleteKeys(keysIn) {
  const d = db(); let deleted = 0;
  for (let i = 0; i < keysIn.length; i += 25) {
    const chunk = keysIn.slice(i, i + 25);
    let req = { [TABLE]: chunk.map((k) => ({ DeleteRequest: { Key: { pk: k.pk, sk: k.sk } } })) };
    while (req && Object.keys(req).length) { const r = await d.send(new cmds.BatchWriteCommand({ RequestItems: req })); req = r.UnprocessedItems; }
    deleted += chunk.length;
  }
  return deleted;
}
/** Remove everything Arena holds about one agent. Returns how many rows went. */
async function deleteAgent(arn) {
  const live = await getLive(arn);
  const k = await agentRowKeys(arn, live && live.team);
  return deleteKeys(k);
}

// ---------- kudos limits ----------
/** Count one more kudos from a sender today, unless they are already at the limit. Atomic: a race cannot slip past the cap. */
async function bumpKudosCount(sender, day, limit, now) {
  try {
    await db().send(new cmds.UpdateCommand({ TableName: TABLE, Key: { pk: 'KUDOSFROM#' + sender, sk: 'DAY#' + day },
      UpdateExpression: 'ADD #c :one SET #t = :ttl', ConditionExpression: 'attribute_not_exists(#c) OR #c < :limit',
      ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' }, ExpressionAttributeValues: { ':one': 1, ':limit': limit, ':ttl': Math.floor((now || Date.now()) / 1000) + 7 * 86400 } }));
    return true;
  } catch (e) { if (e.name === 'ConditionalCheckFailedException') return false; throw e; }
}

// ---------- kiosk tokens: read-only wallboard access without sign-in ----------
const KIOSK_PREFIX = 'KIOSK#';
async function putKiosk(token, team, fields) {
  await db().send(new cmds.PutCommand({ TableName: TABLE, Item: Object.assign({ pk: 'KIOSK', sk: KIOSK_PREFIX + token, token, team }, fields) }));
}
async function getKiosk(token) {
  const r = await db().send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: 'KIOSK', sk: KIOSK_PREFIX + token } }));
  return r.Item || null;
}
async function listKiosks(team) {
  const r = await db().send(new cmds.QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': 'KIOSK' } }));
  return (r.Items || []).filter((k) => !team || k.team === team);
}
async function deleteKiosk(token) { await db().send(new cmds.DeleteCommand({ TableName: TABLE, Key: { pk: 'KIOSK', sk: KIOSK_PREFIX + token } })); }

// ---------- metering ----------
/** Every agent LIVE row, across all teams. Small table scan; agents number in the hundreds. */
async function scanLive() {
  const d = db(); const out = []; let ExclusiveStartKey;
  do {
    const r = await d.send(new cmds.ScanCommand({ TableName: TABLE, FilterExpression: 'sk = :live AND begins_with(pk, :a)', ExpressionAttributeValues: { ':live': 'LIVE', ':a': 'AGENT#' }, ProjectionExpression: 'pk, lastEvent', ExclusiveStartKey }));
    out.push(...(r.Items || [])); ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}
/** LIVE rows with all attributes, for the streak job. */
async function scanLiveFull() {
  const d = db(); const out = []; let ExclusiveStartKey;
  do {
    const r = await d.send(new cmds.ScanCommand({ TableName: TABLE, FilterExpression: 'sk = :live AND begins_with(pk, :a)', ExpressionAttributeValues: { ':live': 'LIVE', ':a': 'AGENT#' }, ExclusiveStartKey }));
    out.push(...(r.Items || [])); ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}
async function getDay(arn, day) { const r = await db().send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: keys.agent(arn), sk: 'DAY#' + day } })); return r.Item || null; }
async function setStreak(arn, streak, assessedDay) {
  await db().send(new cmds.UpdateCommand({ TableName: TABLE, Key: { pk: keys.agent(arn), sk: 'LIVE' }, UpdateExpression: 'SET streak = :s, streakAssessed = :d', ExpressionAttributeValues: { ':s': streak, ':d': assessedDay } }));
}
async function getMeter(day) { const r = await db().send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: 'METER', sk: 'DAY#' + day } })); return r.Item || null; }
async function putMeter(day, fields) { await db().send(new cmds.PutCommand({ TableName: TABLE, Item: Object.assign({ pk: 'METER', sk: 'DAY#' + day, day }, fields) })); }

// ---------- notifications ----------
async function getNotify(team) {
  const r = await db().send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: 'CONFIG', sk: 'NOTIFY#' + team } }));
  return r.Item ? r.Item.settings : null;
}
async function putNotify(team, settings) {
  await db().send(new cmds.PutCommand({ TableName: TABLE, Item: { pk: 'CONFIG', sk: 'NOTIFY#' + team, team, settings, updatedAt: new Date().toISOString() } }));
}
async function getDigestMark(team, day) {
  const r = await db().send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: 'DIGEST', sk: team + '#' + day } }));
  return r.Item || null;
}
async function putDigestMark(team, day, channels) {
  await db().send(new cmds.PutCommand({ TableName: TABLE, Item: { pk: 'DIGEST', sk: team + '#' + day, team, day, channels, at: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + 14 * 86400 } }));
}
/** Distinct team names, from the LIVE rows. */
async function listTeams() {
  const rows = await scanLiveFull();
  return [...new Set(rows.map((r) => r.team).filter(Boolean))].sort();
}

// ---------- reward budgets: a monthly cap in points per team, spent on approval ----------
async function getBudget(team) {
  const r = await db().send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: 'CONFIG', sk: 'BUDGET#' + team } }));
  return r.Item ? { monthly: r.Item.monthly || 0 } : null;
}
async function putBudget(team, monthly) {
  await db().send(new cmds.PutCommand({ TableName: TABLE, Item: { pk: 'CONFIG', sk: 'BUDGET#' + team, team, monthly, updatedAt: new Date().toISOString() } }));
}
/** { spent, alerted: [pct...] } for a team's month, zeros when nothing was approved yet. */
async function getSpend(team, month) {
  const r = await db().send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: 'BUDGET#' + team, sk: month } }));
  return { spent: (r.Item && r.Item.spent) || 0, alerted: (r.Item && r.Item.alerted) || [] };
}
/** Adds an approved reward's cost to the month. Returns the new total. */
async function addSpend(team, month, cost) {
  const r = await db().send(new cmds.UpdateCommand({ TableName: TABLE, Key: { pk: 'BUDGET#' + team, sk: month }, UpdateExpression: 'ADD spent :c SET team = :t, #m = :m', ExpressionAttributeNames: { '#m': 'month' },
    ExpressionAttributeValues: { ':c': cost, ':t': team, ':m': month }, ReturnValues: 'ALL_NEW' }));
  return r.Attributes.spent;
}
async function markBudgetAlert(team, month, pct) {
  await db().send(new cmds.UpdateCommand({ TableName: TABLE, Key: { pk: 'BUDGET#' + team, sk: month }, UpdateExpression: 'SET alerted = list_append(if_not_exists(alerted, :e), :p)', ExpressionAttributeValues: { ':e': [], ':p': [pct] } }));
}
/** Once-a-day job markers (adherence import and the like): { pk: MARK, sk: <job>#<day> }. */
async function getMark(job, day) { const r = await db().send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: 'MARK', sk: job + '#' + day } })); return r.Item || null; }
async function putMark(job, day, fields) { await db().send(new cmds.PutCommand({ TableName: TABLE, Item: Object.assign({ pk: 'MARK', sk: job + '#' + day, job, day, at: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + 14 * 86400 }, fields || {}) })); }

// ---------- scoring mix: a stack-wide default (CONFIG / MIX) and optional per-team profiles (CONFIG / MIX#team) ----------
const mixKey = (team) => (team ? 'MIX#' + team : 'MIX');
/** { team: mix|null, default: mix|null } so callers can tell which one applies. */
async function getMixes(team) {
  const d = db();
  const def = await d.send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: 'CONFIG', sk: 'MIX' } }));
  const own = team ? await d.send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: 'CONFIG', sk: mixKey(team) } })) : { Item: null };
  return { team: own.Item ? own.Item.mix : null, default: def.Item ? def.Item.mix : null };
}
/** The mix that applies to a team: its own profile, else the default, else null (the engine's built-in weights). */
async function getMix(team) { const m = await getMixes(team); return m.team || m.default || null; }
async function putMix(mix, team) {
  await db().send(new cmds.PutCommand({ TableName: TABLE, Item: { pk: 'CONFIG', sk: mixKey(team), team: team || undefined, mix, updatedAt: new Date().toISOString() } }));
}
async function deleteMix(team) {
  if (!team) return;
  await db().send(new cmds.DeleteCommand({ TableName: TABLE, Key: { pk: 'CONFIG', sk: mixKey(team) } }));
}
/** Per-agent preferences on the LIVE row (personal-best mode). Returns false when the agent is unknown. */
async function putAgentPrefs(arn, prefs) {
  try {
    await db().send(new cmds.UpdateCommand({ TableName: TABLE, Key: { pk: keys.agent(arn), sk: 'LIVE' }, UpdateExpression: 'SET prefs = :p', ExpressionAttributeValues: { ':p': prefs }, ConditionExpression: 'attribute_exists(pk)' }));
    return true;
  } catch (e) { if (e.name === 'ConditionalCheckFailedException') return false; throw e; }
}

module.exports = { TABLE, dayKey, weekKey, keys, planWrites, apply, getLive, getTeam, mergeTeam, listEvents, getMix, getMixes, putMix, deleteMix, putAgentPrefs, seedLive, putAck, deleteAck, listAcks, getBudget, putBudget, getSpend, addSpend, markBudgetAlert, getMark, putMark,
  getContact, getTeamLive, getTeamDays, getAgentDays, bumpKudosCount, getNotify, putNotify, getDigestMark, putDigestMark, listTeams,
  listTeamItems, putTeamItem, getTeamItem, updateTeamItem, spendPoints, scanLive, getMeter, putMeter,
  agentRowKeys, deleteKeys, deleteAgent, putKiosk, getKiosk, listKiosks, deleteKiosk, scanLiveFull, getDay, setStreak };
