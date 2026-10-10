const assert = require('node:assert/strict');
const { test } = require('node:test');
const notify = require('./notify.js');

test('settings: defaults, masking and merging keep secrets whole and out of responses', () => {
  const d = notify.withDefaults(null);
  assert.equal(d.digestHour, 17); assert.deepEqual(d.events, { kudos: true, rewards: true, challenges: true, digest: true });
  const m = notify.merge(null, { slackUrl: 'https://hooks.slack.com/services/T/B/secret12', teamsUrl: '', digestHour: '26', events: { digest: false } });
  assert.equal(m.digestHour, 23); assert.equal(m.events.digest, false); assert.equal(m.events.kudos, true);
  const shown = notify.masked(m);
  assert.equal(shown.slackUrl, '…cret12'); assert.equal(shown.slackSet, true); assert.equal(shown.teamsSet, false);
  assert.equal(notify.merge(m, { slackUrl: '…cret12' }).slackUrl, 'https://hooks.slack.com/services/T/B/secret12', 'a masked value sent back changes nothing');
  assert.equal(notify.merge(m, { slackUrl: '' }).slackUrl, '', 'an empty string clears it');
  assert.throws(() => notify.merge(m, { teamsUrl: 'ftp://nope' }), /https/);
});

test('messages are built once and rendered per channel', () => {
  const m = notify.message({ kind: 'kudos', from: 'Marcus', to: 'Priya', note: 'great save' });
  assert.equal(m.title, 'Kudos'); assert.match(m.lines[0], /Marcus → Priya/);
  assert.equal(notify.renderSlack(m).text, '*Kudos*\nMarcus → Priya: “great save”');
  const t = notify.renderTeams(m);
  assert.equal(t['@type'], 'MessageCard'); assert.equal(t.title, 'Kudos'); assert.equal(t.themeColor, '0F766E');
  const ended = notify.message({ kind: 'challengeEnded', challenge: { title: 'Race' }, results: { label: 'Priya leads', prizes: [{ name: 'Priya', points: 100, place: '1st place' }] } });
  assert.match(ended.lines[1], /Priya: 100 pts for 1st place/);
  const digest = notify.message({ kind: 'digest', digest: { team: 'Billing', points: 1200, handled: 80, qa: 87, sentiment: 1.3, kudos: 4, top: [{ name: 'Priya', points: 200 }], challenges: [{ title: 'Race', label: 'Priya leads' }], flagged: 2, rewardsPending: 1 } });
  assert.equal(digest.title, 'Arena daily digest · Billing'); assert.match(digest.lines[0], /evaluation 87% · sentiment \+1\.3/); assert.match(digest.lines[1], /1\. Priya/); assert.match(digest.lines[3], /2 agents flagged/);
  assert.equal(notify.message({ kind: 'unknown' }), null);
});

test('send posts to each configured channel, honours the event switches, and emails only the digest', async () => {
  const posts = [], published = [];
  const fetch = async (url, init) => { posts.push([url, JSON.parse(init.body)]); return { ok: true }; };
  const cfg = { slackUrl: 'https://hooks.slack.com/a', teamsUrl: 'https://x.webhook.office.com/b', email: 'lead@example.com', events: { kudos: true, rewards: false, challenges: true, digest: true } };
  const used = await notify.send(cfg, { kind: 'kudos', from: 'A', to: 'B', note: 'n' }, { fetch, publish: async (p) => published.push(p) });
  assert.deepEqual(used, ['slack', 'teams']); assert.equal(posts.length, 2); assert.equal(posts[0][0], 'https://hooks.slack.com/a'); assert.equal(posts[1][1]['@type'], 'MessageCard');
  assert.deepEqual(await notify.send(cfg, { kind: 'rewardRequested', agentName: 'A', what: 'x', cost: 5 }, { fetch }), [], 'rewards are switched off');
  const d = await notify.send(cfg, { kind: 'digest', digest: { team: 't', points: 1, handled: 1, qa: null, sentiment: null, kudos: 0, top: [], challenges: [], flagged: 0, rewardsPending: 0 } }, { fetch, publish: async (p) => published.push(p) });
  assert.deepEqual(d, ['slack', 'teams', 'email']); assert.equal(published.length, 1); assert.match(published[0].Subject, /daily digest/); assert.equal(published[0].MessageAttributes.to.StringValue, 'lead@example.com');
  await assert.rejects(() => notify.send(cfg, { kind: 'test', team: 't' }, { fetch: async () => ({ ok: false, status: 404 }) }), /404/);
});
