/*
 * DynamoDB layer shared by the ingest Lambda and the API Lambda.
 *
 * Table: arena (single table, on-demand)
 *   pk=AGENT#<arn>  sk=LIVE               agentState, lastEvent, username, team, streak
 *   pk=AGENT#<arn>  sk=DAY#2026-09-15     points, handled, ahtSum, evals[], autofails, kudosReceived, escalations
 *   pk=AGENT#<arn>  sk=WEEK#2026-W38      same shape, weekly
 *   pk=AGENT#<arn>  sk=EV#<ts>#<type>     ledger row, ttl 90 days
 *   pk=CONFIG       sk=MIX                scoring mix
 *   gsi1: gsi1pk=TEAM#<team>#DAY#<date> | TEAM#<team>#WEEK#<week> | TEAM#<team>#LIVE, gsi1sk=AGENT#<arn>
 */
'use strict';

const TABLE = process.env.TABLE || 'arena';
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
function dayKey(iso) { return iso.slice(0, 10); }
function weekKey(iso) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}
const keys = {
  agent: (arn) => 'AGENT#' + arn,
  team: (team, kind, period) => `TEAM#${team}#${kind}${period ? '#' + period : ''}`,
};

/** Build the writes for one scored event. Pure, returned as plain objects so it can be tested. */
function planWrites(ev, points, now) {
  now = now || Date.now();
  const pk = keys.agent(ev.AgentARN), ts = ev.EventTimestamp, team = ev.Team || 'unassigned';
  const isContact = ev.EventType === 'CONTACT_HANDLED', isEval = ev.EventType === 'EVALUATION_SUBMITTED';
  const writes = [];

  writes.push({ op: 'put', item: { pk, sk: `EV#${ts}#${ev.EventType}`, ...ev, points, ttl: Math.floor(now / 1000) + TTL_DAYS * 86400 } });

  const liveSet = ['lastEvent = :ts', 'team = :team', 'username = if_not_exists(username, :user)'];
  if (ev.State) liveSet.push('agentState = :state');
  writes.push({ op: 'update', key: { pk, sk: 'LIVE' },
    expr: 'SET ' + liveSet.join(', ') + ', gsi1pk = :g1, gsi1sk = :g2',
    values: { ':ts': ts, ':team': team, ':user': ev.Username || ev.AgentARN, ':g1': keys.team(team, 'LIVE'), ':g2': pk, ...(ev.State ? { ':state': ev.State } : {}) } });

  if (points !== 0 || isContact || isEval || ev.EventType === 'KUDOS') {
    for (const [kind, period] of [['DAY', dayKey(ts)], ['WEEK', weekKey(ts)]]) {
      const values = { ':p': points, ':h': isContact ? 1 : 0, ':aht': isContact ? ev.HandleTime || 0 : 0,
        ':esc': isContact && ev.Escalated ? 1 : 0, ':af': isEval && ev.AutoFail ? 1 : 0, ':k': ev.EventType === 'KUDOS' ? 1 : 0,
        ':g1': keys.team(team, kind, period), ':g2': pk, ':user': ev.Username || ev.AgentARN, ':empty': [] };
      let expr = 'SET gsi1pk = :g1, gsi1sk = :g2, username = if_not_exists(username, :user)';
      if (isEval) { expr += ', evals = list_append(if_not_exists(evals, :empty), :ev)'; values[':ev'] = [ev.AutoFail ? 0 : ev.Score]; }
      else expr += ', evals = if_not_exists(evals, :empty)';
      expr += ' ADD points :p, handled :h, ahtSum :aht, escalations :esc, autofails :af, kudosReceived :k';
      writes.push({ op: 'update', key: { pk, sk: `${kind}#${period}` }, expr, values });
    }
  }
  return writes;
}

async function apply(writes) {
  const d = db();
  for (const w of writes) {
    if (w.op === 'put') await d.send(new cmds.PutCommand({ TableName: TABLE, Item: w.item }));
    else await d.send(new cmds.UpdateCommand({ TableName: TABLE, Key: w.key, UpdateExpression: w.expr, ExpressionAttributeValues: w.values }));
  }
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
  for (const r of live) { const a = get(r.pk); a.name = r.username; a.state = r.agentState || 'Offline'; a.lastEvent = r.lastEvent ? Date.parse(r.lastEvent) : 0; a.streak = r.streak || 0; a.team = r.team; }
  for (const r of day) { const a = get(r.pk); Object.assign(a, { today: r.points || 0, handled: r.handled || 0, ahtSum: r.ahtSum || 0, evals: r.evals || [], autofails: r.autofails || 0, kudosReceived: r.kudosReceived || 0, escalations: r.escalations || 0 }); a.name = a.name || r.username; }
  for (const r of week) { const a = get(r.pk); a.week = r.points || 0; a.name = a.name || r.username; }
  return [...byArn.values()].map((a) => { a.name = a.name || a.id.split('/').pop(); return a; });
}

async function getTeam(team, iso) {
  const [live, day, week] = await Promise.all([
    queryGsi(keys.team(team, 'LIVE')), queryGsi(keys.team(team, 'DAY', dayKey(iso))), queryGsi(keys.team(team, 'WEEK', weekKey(iso))),
  ]);
  return mergeTeam(live, day, week);
}

async function listEvents(arn, limit) {
  const d = db();
  const r = await d.send(new cmds.QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :ev)',
    ExpressionAttributeValues: { ':pk': keys.agent(arn), ':ev': 'EV#' }, ScanIndexForward: false, Limit: limit || 20 }));
  return r.Items || [];
}

async function getMix() {
  const r = await db().send(new cmds.GetCommand({ TableName: TABLE, Key: { pk: 'CONFIG', sk: 'MIX' } }));
  return r.Item ? r.Item.mix : null;
}
async function putMix(mix) {
  await db().send(new cmds.PutCommand({ TableName: TABLE, Item: { pk: 'CONFIG', sk: 'MIX', mix, updatedAt: new Date().toISOString() } }));
}

module.exports = { TABLE, dayKey, weekKey, keys, planWrites, apply, getTeam, mergeTeam, listEvents, getMix, putMix };
