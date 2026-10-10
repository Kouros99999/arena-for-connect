/*
 * Where a team hears about Arena: Slack and Microsoft Teams incoming webhooks, and email through SNS.
 *
 * Settings live per team in the table (CONFIG / NOTIFY#<team>): slackUrl, teamsUrl, email, digestHour (UTC),
 * events { kudos, rewards, challenges, digest }. Webhook URLs are secrets; the API never returns them whole.
 * Every message is built once as { title, lines } and rendered per channel.
 */
'use strict';

const DEFAULTS = { slackUrl: '', teamsUrl: '', email: '', digestHour: 17, events: { kudos: true, rewards: true, challenges: true, digest: true } };
const TOPIC = process.env.DIGEST_TOPIC_ARN || '';

let snsClient;
function sns() {
  if (snsClient) return snsClient;
  const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
  snsClient = { client: new SNSClient({}), PublishCommand };
  return snsClient;
}

/** Settings with defaults applied. Pure. */
function withDefaults(cfg) {
  const c = Object.assign({}, DEFAULTS, cfg || {});
  c.events = Object.assign({}, DEFAULTS.events, (cfg && cfg.events) || {});
  c.digestHour = Math.min(23, Math.max(0, Math.round(Number(c.digestHour)) || 0));
  return c;
}
/** What the console may see: whether each channel is set and the last characters of each URL. Pure. */
function masked(cfg) {
  const c = withDefaults(cfg);
  const tail = (u) => (u ? '…' + u.slice(-6) : '');
  return { slackUrl: tail(c.slackUrl), teamsUrl: tail(c.teamsUrl), slackSet: !!c.slackUrl, teamsSet: !!c.teamsUrl, email: c.email, digestHour: c.digestHour, events: c.events };
}
/** Merge a settings update into the stored settings, keeping URLs the caller did not change. Pure. */
function merge(stored, update) {
  const c = withDefaults(stored), u = update || {};
  for (const k of ['slackUrl', 'teamsUrl']) if (typeof u[k] === 'string' && !u[k].startsWith('…')) { const v = u[k].trim(); if (v && !/^https:\/\//.test(v)) throw new Error(k + ' must be an https URL'); c[k] = v; }
  if (typeof u.email === 'string') c.email = u.email.trim().slice(0, 120);
  if (u.digestHour !== undefined) c.digestHour = Math.min(23, Math.max(0, Math.round(Number(u.digestHour)) || 0));
  if (u.events && typeof u.events === 'object') for (const k of Object.keys(DEFAULTS.events)) if (u.events[k] !== undefined) c.events[k] = !!u.events[k];
  return c;
}

// ---------- messages ----------
const fmtS = (v) => (v > 0 ? '+' : '') + v.toFixed(1);
/** Build the message for an event. Pure. Returns { title, lines } or null when nothing should be said. */
function message(ev) {
  switch (ev.kind) {
    case 'kudos': return { title: 'Kudos', lines: [`${ev.from} → ${ev.to}: “${ev.note}”`] };
    case 'rewardRequested': return { title: 'Reward requested', lines: [`${ev.agentName} asked for ${ev.what} (${ev.cost.toLocaleString()} pts). Approve it in the console.`] };
    case 'rewardDecided': return { title: ev.status === 'approved' ? 'Reward approved' : 'Reward declined', lines: [`${ev.agentName}: ${ev.what}${ev.status === 'approved' ? '. Time to make it happen.' : '.'}`] };
    case 'challengeStarted': return { title: 'New challenge', lines: [`${ev.challenge.title} · ${ev.challenge.startsAt === ev.challenge.endsAt ? ev.challenge.endsAt : ev.challenge.startsAt + ' to ' + ev.challenge.endsAt}`] };
    case 'challengeEnded': {
      const r = ev.results || {}, lines = [`${ev.challenge.title} has ended: ${r.label || r.value || 'no result'}.`];
      for (const p of (r.prizes || []).slice(0, 5)) lines.push(`${p.name}: ${p.points} pts${p.place && p.place !== 'held' ? ' for ' + p.place : ''}`);
      if ((r.prizes || []).length > 5) lines.push(`and ${r.prizes.length - 5} more`);
      return { title: 'Challenge over', lines };
    }
    case 'digest': {
      const d = ev.digest, lines = [];
      lines.push(`Today: ${d.points.toLocaleString()} pts · ${d.handled} contacts · evaluation ${d.qa === null ? '—' : d.qa + '%'} · sentiment ${d.sentiment === null ? '—' : fmtS(d.sentiment)} · ${d.kudos} kudos`);
      d.top.forEach((t, i) => lines.push(`${i + 1}. ${t.name} · ${t.points.toLocaleString()} pts`));
      for (const c of d.challenges) lines.push(`Challenge: ${c.title} · ${c.label}`);
      if (d.flagged) lines.push(`${d.flagged} agent${d.flagged === 1 ? '' : 's'} flagged in the console`);
      if (d.rewardsPending) lines.push(`${d.rewardsPending} reward request${d.rewardsPending === 1 ? '' : 's'} waiting for approval`);
      return { title: `Arena daily digest · ${d.team}`, lines };
    }
    case 'test': return { title: 'Arena connected', lines: ['This channel will receive kudos, reward requests, challenge results and the daily digest for ' + ev.team + '.'] };
    default: return null;
  }
}
/** Which event switch covers an event kind. Pure. */
const eventKey = (kind) => ({ kudos: 'kudos', rewardRequested: 'rewards', rewardDecided: 'rewards', challengeStarted: 'challenges', challengeEnded: 'challenges', digest: 'digest', test: null })[kind];

// ---------- channels ----------
const renderSlack = (m) => ({ text: `*${m.title}*\n` + m.lines.join('\n') });
const renderTeams = (m) => ({ '@type': 'MessageCard', '@context': 'https://schema.org/extensions', summary: m.title, themeColor: '0F766E', title: m.title, text: m.lines.join('<br>') });

async function post(url, body, fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('webhook responded ' + r.status);
}

/** Send one event to every channel the team has turned on. Returns the channel names used. */
async function send(cfg, ev, deps) {
  const c = withDefaults(cfg), m = message(ev);
  if (!m) return [];
  const key = eventKey(ev.kind);
  if (key && !c.events[key]) return [];
  const used = [], fetchImpl = deps && deps.fetch;
  if (c.slackUrl) { await post(c.slackUrl, renderSlack(m), fetchImpl); used.push('slack'); }
  if (c.teamsUrl) { await post(c.teamsUrl, renderTeams(m), fetchImpl); used.push('teams'); }
  if (c.email && (ev.kind === 'digest' || ev.kind === 'test') && (TOPIC || (deps && deps.publish))) {
    const publish = (deps && deps.publish) || (async (p) => { const s = sns(); await s.client.send(new s.PublishCommand(p)); });
    await publish({ TopicArn: TOPIC, Subject: m.title.slice(0, 99), Message: m.lines.join('\n') + '\n\nSent to ' + c.email + ' by Arena.', MessageAttributes: { to: { DataType: 'String', StringValue: c.email } } });
    used.push('email');
  }
  return used;
}

module.exports = { DEFAULTS, withDefaults, masked, merge, message, eventKey, send, renderSlack, renderTeams };
