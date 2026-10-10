/*
 * Arena scoring engine.
 * Shared by the agent panel, supervisor console and wallboard.
 * Plain script: defines window.Arena in a browser, module.exports in node.
 *
 * Events mirror what Amazon Connect emits so the browser simulator and a
 * real Kinesis/S3 consumer feed the same code path:
 *   CONTACT_HANDLED        from a contact record        { HandleTime, Queue }
 *   EVALUATION_SUBMITTED   from Contact Lens evaluation { Score, AutoFail }
 *   AGENT_STATE_CHANGE     from the agent event stream  { State }
 *   SENTIMENT_SCORED       from Contact Lens analysis   { Sentiment }  customer overall sentiment, -5..5
 *   CSAT_RECEIVED          from a post-contact survey   { Score }      1..5
 *   KUDOS                  app-native                   { From, Note }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Arena = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Configuration ----------
  const DEFAULT_MIX = { quality: 50, productivity: 35, adherence: 15 };
  const QUALITY_FLOOR = 40; // below this the mix is accepted but warned: agents can win by rushing

  // Base points at the default mix. The mix scales each family up or down.
  const BASE = {
    contact: (aht) => (aht <= 360 ? 12 : aht <= 540 ? 10 : 6),
    evaluation: (pct) => (pct >= 95 ? 30 : pct >= 85 ? 20 : pct >= 70 ? 10 : 0),
    adherenceHour: 5,
    autofail: -40, // never scaled: a fail is a fail
    // Customer signals count as quality. A bad call never deducts: customers are sometimes unhappy for reasons no agent controls.
    sentiment: (s) => (s >= 2.5 ? 8 : s >= 1 ? 5 : s > -1 ? 2 : 0),
    csat: (n) => (n >= 5 ? 10 : n >= 4 ? 6 : n >= 3 ? 2 : 0),
    kudos: 8,
    streakDay: 25,
    evalAck: 5,        // reading and acknowledging your own evaluation: the coaching loop closes
  };

  const LEVELS = [
    { at: 0, name: 'Rookie' }, { at: 150, name: 'Starter' }, { at: 400, name: 'Steady' },
    { at: 800, name: 'Resolver' }, { at: 1400, name: 'Closer' }, { at: 2200, name: 'Anchor' }, { at: 3300, name: 'Legend' },
  ];

  const BADGES = [
    { id: 'streak7', name: '7-day streak', test: (a) => a.streak >= 7 },
    { id: 'first95', name: 'First 95', test: (a) => a.evals.some((e) => e >= 95) },
    { id: 'fifty', name: '50 contacts', test: (a) => a.handled >= 50 },
    { id: 'team', name: 'Team player', test: (a) => a.kudosReceived >= 1 },
    { id: 'clean', name: 'Zero escalations', test: (a) => a.handled >= 10 && a.escalations === 0 },
  ];

  const FLAGS = {
    quietMinutes: 40,
    volumeRatio: 1.6, // contacts handled vs team mean
    lowQa: 75,
    kudosSpike: 6,      // kudos received today at or above this, and three times the team mean, looks like trading
    lowSentiment: -1,   // average customer sentiment at or below this...
    sentimentMin: 5,    // ...across at least this many analysed contacts
  };

  // Challenge templates. Progress is always computed from agent data, never self-reported.
  const TEMPLATES = {
    esc: { title: 'Keep escalations under target', unit: '%', defaultTarget: 5, reward: 150, needs: 'contacts' },
    qa: { title: 'Every evaluation at or above a score', unit: 'score', defaultTarget: 85, reward: 100, needs: 'evaluations' },
    contest: { title: 'Team points target', unit: 'pts', defaultTarget: 1000, reward: 250, needs: 'points' },
    kudos: { title: 'Kudos received per agent', unit: 'each', defaultTarget: 3, reward: 50, needs: 'kudos' },
    race: { title: 'Agent race', unit: '', defaultTarget: 0, reward: 100, needs: 'ranked agents', ranked: true },
    duel: { title: 'Head-to-head', unit: '', defaultTarget: 0, reward: 100, needs: 'two agents', ranked: true },
    teams: { title: 'Team vs team', unit: '', defaultTarget: 0, reward: 150, needs: 'an opponent team' },
    fcr: { title: 'First-contact resolution on a queue', unit: '%', defaultTarget: 80, reward: 150, needs: 'contact lens categories (not yet fed)' },
  };

  // Measures a race, duel or team-vs-team can be run on. `of` reads an agent; `team` reads a whole team's rows.
  const METRICS = {
    points: { label: 'Points', higher: true, fmt: (v) => Math.round(v).toLocaleString() },
    handled: { label: 'Contacts handled', higher: true, fmt: (v) => Math.round(v).toLocaleString() },
    qa: { label: 'Evaluation average', higher: true, fmt: (v) => Math.round(v) + '%' },
    sentiment: { label: 'Customer sentiment', higher: true, fmt: (v) => (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toFixed(1) },
    csat: { label: 'Survey score', higher: true, fmt: (v) => (Math.round(v * 10) / 10).toFixed(1) },
    aht: { label: 'Handle time', higher: false, fmt: (v) => Math.floor(v / 60) + ':' + String(Math.round(v) % 60).padStart(2, '0') },
    escRate: { label: 'Escalation rate', higher: false, fmt: (v) => (Math.round(v * 10) / 10).toFixed(1) + '%' },
    kudos: { label: 'Kudos received', higher: true, fmt: (v) => Math.round(v).toLocaleString() },
    adherence: { label: 'Schedule adherence', higher: true, fmt: (v) => Math.round(v) + '%' },
  };

  // What points buy. Cost is in points; the supervisor approves each redemption.
  const CATALOG = [
    { id: 'gift25', name: '$25 gift card', cost: 2500 },
    { id: 'halfday', name: 'Half-day Friday', cost: 5000 },
    { id: 'lunch', name: 'Team lunch (team pool)', cost: 8000 },
    { id: 'parking', name: 'Prime parking spot, one week', cost: 1500 },
  ];

  // ---------- look and feel: a per-person light/dark choice and a per-stack brand (name, colours, logo) ----------
  const THEME_DEFAULTS = { name: 'Arena', accent: '#0F766E', highlight: '#B7791F', logoUrl: '' };
  const HEX = /^#[0-9a-fA-F]{6}$/;
  /** Validate what a supervisor saved. Throws with a message a person can act on. */
  function normalizeTheme(input, current) {
    const cur = Object.assign({}, THEME_DEFAULTS, current || {}), inp = input || {}, out = {};
    out.name = inp.name !== undefined ? String(inp.name).trim().slice(0, 40) || THEME_DEFAULTS.name : cur.name;
    for (const k of ['accent', 'highlight']) {
      const v = inp[k] !== undefined ? String(inp[k]).trim() : cur[k];
      if (!HEX.test(v)) throw new Error(`${k} must be a hex colour like #0F766E`);
      out[k] = v.toUpperCase();
    }
    const logo = inp.logoUrl !== undefined ? String(inp.logoUrl).trim() : cur.logoUrl;
    if (logo && !/^(\/brand\/[A-Za-z0-9._-]+|https:\/\/[^\s"'<>]+|data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+)$/.test(logo)) throw new Error('logoUrl must be an https URL or a brand file on this site');
    if (logo.length > 420000) throw new Error('the logo is too large; upload a file of 300 KB or less');
    out.logoUrl = logo;
    return out;
  }
  const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix2 = (a, b, t) => '#' + hexToRgb(a).map((x, i) => Math.round(x + (hexToRgb(b)[i] - x) * t).toString(16).padStart(2, '0')).join('');
  /** Relative luminance, for picking readable text on a brand colour. */
  const luma = (h) => { const [r, g, b] = hexToRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ui = {
    /** Light, dark or auto: the person's own choice, kept in this browser. */
    getMode() { try { return localStorage.getItem('arena.theme') || 'auto'; } catch { return 'auto'; } },
    setMode(m) { try { localStorage.setItem('arena.theme', m); } catch {} },
    /** What applies right now, resolving auto through the system preference. `dark` is the page's native look for the wallboard. */
    resolve(mode, nativeDark) { if (mode === 'light' || mode === 'dark') return mode; const prefers = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches; return nativeDark ? (prefers ? 'dark' : 'dark') : (prefers ? 'dark' : 'light'); },
    applyMode(doc, nativeDark) { const mode = ui.resolve(ui.getMode(), nativeDark); doc.documentElement.setAttribute('data-theme', mode); return mode; },
    cycle(doc, nativeDark) { const cur = ui.resolve(ui.getMode(), nativeDark); const next = cur === 'dark' ? 'light' : 'dark'; ui.setMode(next); return ui.applyMode(doc, nativeDark); },
    /** Brand colours and logo onto a page: CSS variables plus the header mark. Pure of network; the caller fetched the theme. */
    applyBrand(doc, theme, opts) {
      const t = Object.assign({}, THEME_DEFAULTS, theme || {}), dark = (doc.documentElement.getAttribute('data-theme') || 'light') === 'dark', st = doc.documentElement.style;
      const accent = dark ? mix2(t.accent, '#FFFFFF', 0.25) : t.accent, hi = dark ? mix2(t.highlight, '#FFFFFF', 0.3) : t.highlight;
      st.setProperty('--accent', accent); st.setProperty('--accent-soft', mix2(t.accent, dark ? '#12161D' : '#FFFFFF', 0.85)); st.setProperty('--accent-dim', mix2(t.accent, '#000000', 0.5)); st.setProperty('--accent-ink', luma(accent) > 0.45 ? '#15181E' : '#FFFFFF');
      st.setProperty('--gold', hi); st.setProperty('--gold-soft', mix2(t.highlight, dark ? '#12161D' : '#FFFFFF', 0.85));
      for (const el of doc.querySelectorAll((opts && opts.mark) || '.brand, .pane-head .app')) {
        el.textContent = ''; if (t.logoUrl) { const img = doc.createElement('img'); img.src = t.logoUrl; img.alt = t.name; img.className = 'brand-logo'; el.appendChild(img); }
        el.appendChild(doc.createTextNode(t.logoUrl && !(opts && opts.nameWithLogo) ? '' : t.name)); el.title = t.name;
      }
      if (opts && opts.title && t.name !== 'Arena') doc.title = doc.title.replace(/Arena/, t.name);
      return t;
    },
    /** Wallboard display preferences for one TV: text size and contrast, kept in that browser. */
    getWall() { try { return JSON.parse(localStorage.getItem('arena.wall') || '{}'); } catch { return {}; } },
    setWall(p) { try { localStorage.setItem('arena.wall', JSON.stringify(Object.assign(ui.getWall(), p))); } catch {} },
    applyWall(doc) { const p = ui.getWall(); doc.documentElement.setAttribute('data-size', p.size === 'large' ? 'large' : 'normal'); doc.documentElement.setAttribute('data-contrast', p.contrast === 'high' ? 'high' : 'normal'); return p; },
  };

  // ---------- spotlights: recognition Arena writes itself, no points attached ----------
  const SPOTLIGHTS = { evalScore: 95, streakDays: [5, 10, 20, 50], minPriorDays: 3 };
  /** Pure: the line a spotlight carries, or null when the moment does not qualify. */
  function spotlightText(kind, d) {
    if (kind === 'evaluation') return (d.score || 0) >= SPOTLIGHTS.evalScore ? `Scored ${Math.round(d.score)}% on an evaluation` : null;
    if (kind === 'streak') return SPOTLIGHTS.streakDays.includes(d.days) ? `Day ${d.days} of a clean-quality streak` : null;
    if (kind === 'bestDay') return d.points > 0 ? `Best day on record: ${Math.round(d.points).toLocaleString()} pts` : null;
    return null;
  }
  /** Pure: did yesterday beat every earlier day on record? rows: [{ day, points }] including yesterday. */
  function isBestDay(rows, yesterday) {
    const mine = (rows || []).find((r) => r.day === yesterday);
    if (!mine || !(mine.points > 0)) return false;
    const prior = (rows || []).filter((r) => r.day < yesterday && (r.points || 0) > 0);
    return prior.length >= SPOTLIGHTS.minPriorDays && prior.every((r) => r.points < mine.points);
  }

  // ---------- recommended challenges: what the team's own numbers say to run next ----------
  /** Pure: up to three suggestions from the agents' current figures, each with the form fields to start it. */
  function recommendChallenges(agents, opts) {
    opts = opts || {};
    const out = [], n = agents.length;
    if (!n) return out;
    const sum = (f) => agents.reduce((s, a) => s + (f(a) || 0), 0);
    const handled = sum((a) => a.handled), esc = sum((a) => a.escalations);
    const escRate = handled ? (esc / handled) * 100 : null;
    if (handled >= 20 && escRate > 5) out.push({ template: 'esc', title: 'Keep escalations under 5%', reason: `Escalation rate is ${round1(escRate)}% across ${handled} contacts.`, fields: { target: '5%' } });
    const evalAgents = agents.filter((a) => (a.evals || []).some((e) => e > 0));
    const qa = evalAgents.length ? mean(evalAgents.map((a) => mean(a.evals.filter((e) => e > 0)))) : null;
    if (evalAgents.length >= 2 && qa !== null && qa < 85) out.push({ template: 'qa', title: 'Every evaluation at or above 85', reason: `Evaluation average is ${Math.round(qa)}% over ${evalAgents.length} agents.`, fields: { target: '85' } });
    const sentCount = sum((a) => a.sentCount), sentAvg = sentCount ? sum((a) => a.sentSum) / sentCount : null;
    if (sentCount >= 10 && sentAvg !== null && sentAvg < 1) out.push({ template: 'race', title: 'Race: evaluation and customer sentiment', reason: `Customer sentiment averages ${(sentAvg > 0 ? '+' : '') + round1(sentAvg)} over ${sentCount} analysed contacts.`, fields: { metrics: [{ key: 'qa', weight: 2 }, { key: 'sentiment', weight: 1 }], minContacts: 3 } });
    const adhCount = sum((a) => a.adhCount), adhAvg = adhCount ? sum((a) => a.adhSum) / adhCount : null;
    if (adhCount >= Math.ceil(n / 2) && adhAvg !== null && adhAvg < 90) out.push({ template: 'race', title: 'Race: schedule adherence', reason: `Adherence averages ${Math.round(adhAvg)}%.`, fields: { metrics: [{ key: 'adherence', weight: 1 }], minContacts: 0 } });
    const kudos = sum((a) => a.kudosReceived);
    if (n >= 4 && handled >= 10 && kudos / n < 0.5) out.push({ template: 'kudos', title: 'Kudos: two per agent', reason: `Only ${kudos} kudos across ${n} agents so far.`, fields: { target: '2' } });
    if (!out.length && handled > 0) { const pts = sum((a) => a.today); out.push({ template: 'contest', title: 'Team points target', reason: `Numbers look healthy. A team target of ${Math.round(pts * 1.15 / 50) * 50} pts keeps everyone pulling together.`, fields: { target: String(Math.max(100, Math.round(pts * 1.15 / 50) * 50)) } }); }
    return out.slice(0, opts.max || 3);
  }

  // ---------- rewards: an editable catalog and a balance that resets by period ----------
  const BALANCE_PERIODS = ['week', 'month', 'quarter'];
  const REWARD_DEFAULTS = { balancePeriod: 'week', items: CATALOG };
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
  /** Validate and normalise reward settings from a supervisor. Throws with a message a person can act on. */
  function normalizeRewardSettings(input, current) {
    const cur = Object.assign({}, REWARD_DEFAULTS, current || {}), inp = input || {};
    const balancePeriod = inp.balancePeriod !== undefined ? String(inp.balancePeriod) : cur.balancePeriod;
    if (!BALANCE_PERIODS.includes(balancePeriod)) throw new Error('balancePeriod must be week, month or quarter');
    const raw = inp.items !== undefined ? inp.items : cur.items;
    if (!Array.isArray(raw) || !raw.length) throw new Error('the catalog needs at least one reward');
    if (raw.length > 20) throw new Error('at most 20 rewards');
    const ids = new Set(), items = [];
    for (const it of raw) {
      const name = String((it && it.name) || '').trim(), cost = Math.round(Number(it && it.cost));
      if (!name || name.length > 60) throw new Error('each reward needs a name of up to 60 characters');
      if (!Number.isFinite(cost) || cost < 1 || cost > 1000000) throw new Error(`"${name}" needs a cost between 1 and 1,000,000 points`);
      let id = (it && it.id) ? String(it.id).slice(0, 40) : slug(name);
      while (ids.has(id)) id += '2';
      ids.add(id); items.push({ id, name, cost });
    }
    return { balancePeriod, items };
  }
  /** Key of the balance period a day falls in: 2026-W38, 2026-09 or 2026-Q3. */
  function periodKey(period, day) {
    if (period === 'month') return day.slice(0, 7);
    if (period === 'quarter') return day.slice(0, 4) + '-Q' + (Math.floor((+day.slice(5, 7) - 1) / 3) + 1);
    return isoWeek(day);
  }
  const addDaysStr = (day, n) => new Date(Date.parse(day + 'T00:00:00.000Z') + n * 86400000).toISOString().slice(0, 10);
  /** First day of the period a day falls in, and the day the next one starts (when the balance resets). */
  function periodBounds(period, day) {
    const y = +day.slice(0, 4), m = +day.slice(5, 7);
    if (period === 'month') return { start: day.slice(0, 8) + '01', resetsOn: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) };
    if (period === 'quarter') { const q = Math.floor((m - 1) / 3); return { start: new Date(Date.UTC(y, q * 3, 1)).toISOString().slice(0, 10), resetsOn: new Date(Date.UTC(y, q * 3 + 3, 1)).toISOString().slice(0, 10) }; }
    const d = new Date(Date.parse(day + 'T00:00:00.000Z')), wd = d.getUTCDay() || 7;
    const start = addDaysStr(day, 1 - wd);
    return { start, resetsOn: addDaysStr(start, 7) };
  }
  /** What an agent may spend: points earned in the period minus approved rewards in it. Pure. */
  function balanceSummary(period, day, earned, spent) {
    const b = periodBounds(period, day);
    return { period, periodStart: b.start, resetsOn: b.resetsOn, earned: Math.max(0, Math.round(earned || 0)), spent: Math.max(0, Math.round(spent || 0)), balance: Math.max(0, Math.round((earned || 0) - (spent || 0))) };
  }

  /** ISO week (YYYY-Www) of a YYYY-MM-DD. Pure date arithmetic. */
  function isoWeek(day) {
    const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)));
    const wd = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - wd);
    const y = d.getUTCFullYear();
    return `${y}-W${String(Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0')}`;
  }
  /**
   * Personal best: an agent measured against their own history instead of the team. Pure.
   * rows: [{ day: 'YYYY-MM-DD', points }] over the window. Returns the best day and week on record,
   * the average active day, and how today and this week compare (today's row is included in rows).
   */
  function personalBest(rows, today) {
    const days = (rows || []).filter((r) => r && r.day && (r.points || 0) > 0);
    const week = isoWeek(today);
    const bestDay = days.reduce((b, r) => (!b || r.points > b.points ? { day: r.day, points: r.points } : b), null);
    const weeks = new Map();
    for (const r of days) { const w = isoWeek(r.day); weeks.set(w, (weeks.get(w) || 0) + r.points); }
    let bestWeek = null;
    for (const [w, points] of weeks) if (!bestWeek || points > bestWeek.points) bestWeek = { week: w, points };
    const todayPoints = (days.find((r) => r.day === today) || {}).points || 0, weekPoints = weeks.get(week) || 0;
    const prior = days.filter((r) => r.day !== today);
    const avgDay = prior.length ? Math.round(prior.reduce((s, r) => s + r.points, 0) / prior.length) : null;
    return { today, week, todayPoints, weekPoints, bestDay, bestWeek, avgDay, activeDays: days.length,
      dayPct: bestDay ? Math.min(100, Math.round((todayPoints / bestDay.points) * 100)) : 0,
      weekPct: bestWeek ? Math.min(100, Math.round((weekPoints / bestWeek.points) * 100)) : 0,
      newBestDay: !!bestDay && bestDay.day === today && prior.length > 0, newBestWeek: !!bestWeek && bestWeek.week === week && weeks.size > 1 };
  }

  /** ISO week (YYYY-Www) of a YYYY-MM-DD. Pure date arithmetic. */
  function isoWeek(day) {
    const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)));
    const wd = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - wd);
    const y = d.getUTCFullYear();
    return `${y}-W${String(Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0')}`;
  }
  /**
   * Personal best: an agent measured against their own history instead of the team. Pure.
   * rows: [{ day: 'YYYY-MM-DD', points }] over the window. Returns the best day and week on record,
   * the average active day, and how today and this week compare (today's row is included in rows).
   */
  function personalBest(rows, today) {
    const days = (rows || []).filter((r) => r && r.day && (r.points || 0) > 0);
    const week = isoWeek(today);
    const bestDay = days.reduce((b, r) => (!b || r.points > b.points ? { day: r.day, points: r.points } : b), null);
    const weeks = new Map();
    for (const r of days) { const w = isoWeek(r.day); weeks.set(w, (weeks.get(w) || 0) + r.points); }
    let bestWeek = null;
    for (const [w, points] of weeks) if (!bestWeek || points > bestWeek.points) bestWeek = { week: w, points };
    const todayPoints = (days.find((r) => r.day === today) || {}).points || 0, weekPoints = weeks.get(week) || 0;
    const prior = days.filter((r) => r.day !== today);
    const avgDay = prior.length ? Math.round(prior.reduce((s, r) => s + r.points, 0) / prior.length) : null;
    return { today, week, todayPoints, weekPoints, bestDay, bestWeek, avgDay, activeDays: days.length,
      dayPct: bestDay ? Math.min(100, Math.round((todayPoints / bestDay.points) * 100)) : 0,
      weekPct: bestWeek ? Math.min(100, Math.round((weekPoints / bestWeek.points) * 100)) : 0,
      newBestDay: !!bestDay && bestDay.day === today && prior.length > 0, newBestWeek: !!bestWeek && bestWeek.week === week && weeks.size > 1 };
  }

  /** Where a team's monthly reward budget stands. Pure; the same shape is returned by the API and the demo. */
  function budgetSummary(monthly, spent, month) {
    monthly = Math.max(0, Math.round(Number(monthly) || 0)); spent = Math.max(0, Math.round(Number(spent) || 0));
    const pct = monthly ? Math.round((spent / monthly) * 100) : 0;
    return { month, monthly, spent, remaining: monthly ? Math.max(0, monthly - spent) : null, pct, capped: monthly > 0 };
  }
  /** Which of the 25/50/75/100% marks a new total crosses that were not announced yet. Pure. */
  function budgetAlerts(monthly, spent, alerted) {
    if (!monthly) return [];
    const pct = (spent / monthly) * 100;
    return [25, 50, 75, 100].filter((p) => pct >= p && !(alerted || []).includes(p));
  }

  /** One agent's value for a metric, or null when there is nothing to measure. */
  function metricOf(key, a) {
    switch (key) {
      case 'points': return a.today || 0;
      case 'handled': return a.handled || 0;
      case 'qa': { const e = (a.evals || []).filter((x) => x > 0); return e.length ? e.reduce((s, x) => s + x, 0) / e.length : null; }
      case 'sentiment': return a.sentCount ? a.sentSum / a.sentCount : null;
      case 'csat': return a.csatCount ? a.csatSum / a.csatCount : null;
      case 'adherence': return a.adhCount ? a.adhSum / a.adhCount : null;
      case 'aht': return a.handled ? a.ahtSum / a.handled : null;
      case 'escRate': return a.handled ? ((a.escalations || 0) / a.handled) * 100 : null;
      case 'kudos': return a.kudosReceived || 0;
      default: return null;
    }
  }
  /** A whole team's value for a metric: totals for counts, averages for rates. */
  function metricOfTeam(key, agents) {
    if (key === 'points' || key === 'handled' || key === 'kudos') return agents.reduce((s, a) => s + (metricOf(key, a) || 0), 0);
    const t = summarizeRows(agents.map((a) => Object.assign({}, a, { points: a.today })));
    return { qa: t.qa, sentiment: t.sentiment, csat: t.csat, aht: t.aht, escRate: t.escalationRate }[key];
  }

  /**
   * Rank agents for a race or duel. Pure. Contest rules on the challenge:
   *   metrics      [{ key, weight }]  weighted measures; one metric by default. Each is scaled to the best in the field,
   *                                   lower-is-better metrics inverted, then combined by weight into a score out of 100.
   *   minContacts  n                  an agent needs at least n contacts in the period to be ranked (a minimum qualifier)
   *   excluded     [agentId]          disqualified by a supervisor; shown, never ranked
   *   agents       [agentId]          duel only: the two contestants
   *   tiers        [{ place, reward }] prizes by finishing place; otherwise `reward` goes to the winner
   */
  function challengeStandings(ch, agents) {
    const metrics = (Array.isArray(ch.metrics) && ch.metrics.length ? ch.metrics : [{ key: ch.metric || 'points', weight: 1 }]).filter((m) => METRICS[m.key]);
    const field = ch.template === 'duel' && Array.isArray(ch.agents) ? agents.filter((a) => ch.agents.includes(a.id)) : agents;
    const totalW = metrics.reduce((s, m) => s + (Number(m.weight) || 0), 0) || 1;
    const raw = field.map((a) => ({ a, v: metrics.map((m) => { const x = metricOf(m.key, a); return x === null ? null : m.key === 'sentiment' ? x + 5 : x; }) }));
    const best = metrics.map((m, i) => { const xs = raw.map((r) => r.v[i]).filter((x) => x !== null); if (!xs.length) return null; return METRICS[m.key].higher ? Math.max(...xs) : Math.min(...xs); });
    const worst = metrics.map((m, i) => { const xs = raw.map((r) => r.v[i]).filter((x) => x !== null); if (!xs.length) return null; return METRICS[m.key].higher ? Math.min(...xs) : Math.max(...xs); });
    const rows = raw.map(({ a, v }) => {
      let score = 0, measured = false;
      metrics.forEach((m, i) => {
        const x = v[i]; if (x === null || best[i] === null) return;
        measured = true;
        const span = Math.abs(best[i] - worst[i]);
        const n = span === 0 ? 1 : METRICS[m.key].higher ? (x - worst[i]) / span : (worst[i] - x) / span;
        score += n * (Number(m.weight) || 0) / totalW;
      });
      const values = {}; metrics.forEach((m, i) => { values[m.key] = v[i] === null ? null : m.key === 'sentiment' ? v[i] - 5 : v[i]; });
      return { agentId: a.id, name: a.name, score: Math.round(score * 1000) / 10, values, handled: a.handled || 0, measured,
        excluded: (ch.excluded || []).includes(a.id), qualified: (a.handled || 0) >= (Number(ch.minContacts) || 0) };
    });
    const ranked = rows.filter((r) => r.qualified && !r.excluded && r.measured).sort((x, y) => y.score - x.score || y.handled - x.handled);
    ranked.forEach((r, i) => { r.rank = i + 1; const t = (ch.tiers || []).find((tt) => Number(tt.place) === r.rank); r.prize = t ? Number(t.reward) || 0 : r.rank === 1 && !(ch.tiers || []).length ? Number(ch.reward) || 0 : 0; });
    const rest = rows.filter((r) => !ranked.includes(r)).sort((x, y) => y.score - x.score);
    return { metrics: metrics.map((m) => ({ key: m.key, weight: Number(m.weight) || 1, label: METRICS[m.key].label })), rows: ranked.concat(rest) };
  }

  /** Collapse day rows for a period into the agent shape the engine reads (points as `today`). Pure. */
  function aggregateAgents(days) {
    const by = new Map();
    for (const d of days) for (const r of d.rows) {
      if (!by.has(r.id)) by.set(r.id, { id: r.id, name: r.name, today: 0, week: 0, handled: 0, ahtSum: 0, evals: [], autofails: 0, kudosReceived: 0, escalations: 0, sentSum: 0, sentCount: 0, csatSum: 0, csatCount: 0, streak: 0, adherenceHours: 0, state: 'Offline', lastEvent: 0 });
      const a = by.get(r.id);
      a.name = r.name || a.name; a.today += r.points || 0; a.handled += r.handled || 0; a.ahtSum += r.ahtSum || 0; a.autofails += r.autofails || 0; a.kudosReceived += r.kudosReceived || 0; a.escalations += r.escalations || 0;
      a.sentSum += r.sentSum || 0; a.sentCount += r.sentCount || 0; a.csatSum += r.csatSum || 0; a.csatCount += r.csatCount || 0;
      a.adherenceHours += r.adherenceHours || 0; a.adhSum = (a.adhSum || 0) + (r.adhSum || 0); a.adhCount = (a.adhCount || 0) + (r.adhCount || 0);
      for (const e of r.evals || []) a.evals.push(e);
    }
    return [...by.values()];
  }

  /** Measure a challenge against the current team. Pure: same function runs in the browser and in the API. */
  function challengeProgress(ch, agents) {
    const t = Number(String(ch.target).replace(/[^0-9.]/g, '')) || 0;
    const handled = agents.reduce((s, a) => s + (a.handled || 0), 0);
    const esc = agents.reduce((s, a) => s + (a.escalations || 0), 0);
    const points = agents.reduce((s, a) => s + (a.today || 0), 0);
    const clamp = (x) => Math.max(0, Math.min(1, x));
    switch (ch.template) {
      case 'esc': { const rate = handled ? (esc / handled) * 100 : 0; return { value: rate.toFixed(1) + '%', label: handled ? rate.toFixed(1) + '% now' : 'no contacts yet', progress: handled ? clamp(1 - rate / Math.max(t, 0.1)) : 0, onTrack: rate <= t, measured: handled > 0 }; }
      case 'qa': { const withEvals = agents.filter((a) => (a.evals || []).some((e) => e > 0)); const clean = withEvals.filter((a) => a.evals.filter((e) => e > 0).every((e) => e >= t)); return { value: `${clean.length}/${withEvals.length}`, label: withEvals.length ? `${clean.length} of ${withEvals.length} agents clean` : 'no evaluations yet', progress: withEvals.length ? clean.length / withEvals.length : 0, onTrack: withEvals.length > 0 && clean.length === withEvals.length, measured: withEvals.length > 0 }; }
      case 'contest': return { value: points.toLocaleString(), label: `${points.toLocaleString()} of ${t.toLocaleString()} pts`, progress: t ? clamp(points / t) : 0, onTrack: points >= t, measured: true };
      case 'kudos': { const met = agents.filter((a) => (a.kudosReceived || 0) >= t).length; return { value: `${met}/${agents.length}`, label: `${met} of ${agents.length} agents at ${t}+`, progress: agents.length ? met / agents.length : 0, onTrack: agents.length > 0 && met === agents.length, measured: true }; }
      case 'race': case 'duel': {
        const st = challengeStandings(ch, agents), lead = st.rows.find((r) => r.rank === 1);
        const m = st.metrics[0], single = st.metrics.length === 1;
        const show = (r) => (single ? (r.values[m.key] === null ? '—' : METRICS[m.key].fmt(r.values[m.key])) : r.score + ' pts');
        const ranked = st.rows.filter((r) => r.rank).length;
        if (ch.template === 'duel') {
          const [x, y] = st.rows;
          if (!x || !y) return { value: '—', label: 'needs two agents on the team', progress: 0, onTrack: false, measured: false, standings: st };
          return { value: `${show(x)} vs ${show(y)}`, label: lead ? `${lead.name} leads` : 'nothing measured yet', progress: lead ? 1 : 0, onTrack: !!lead, measured: !!lead, standings: st };
        }
        return { value: lead ? lead.name : '—', label: lead ? `${lead.name} leads on ${show(lead)} · ${ranked} ranked` : (ch.minContacts ? `nobody at ${ch.minContacts} contacts yet` : 'nothing measured yet'), progress: lead ? 1 : 0, onTrack: !!lead, measured: !!lead, standings: st };
      }
      case 'teams': {
        const key = ch.metric || 'points', mine = metricOfTeam(key, agents), theirs = ch.opponentAgents ? metricOfTeam(key, ch.opponentAgents) : null;
        const f = (v) => (v === null || v === undefined ? '—' : METRICS[key].fmt(v));
        if (theirs === null || theirs === undefined) return { value: f(mine), label: `needs data for ${ch.opponent || 'the opponent team'}`, progress: 0, onTrack: false, measured: false, teamValue: mine };
        const winning = mine !== null && (METRICS[key].higher ? mine > theirs : mine < theirs);
        return { value: `${f(mine)} vs ${f(theirs)}`, label: mine === theirs ? 'level' : winning ? `ahead of ${ch.opponent}` : `behind ${ch.opponent}`, progress: winning ? 1 : 0.5, onTrack: winning, measured: mine !== null, teamValue: mine, opponentValue: theirs };
      }
      default: return { value: '—', label: 'needs ' + (TEMPLATES[ch.template] ? TEMPLATES[ch.template].needs : 'data'), progress: 0, onTrack: false, measured: false };
    }
  }

  const NAMES = ['Priya Natarajan', 'Marcus Bell', 'Aisha Rahman', 'Diego Fuentes', 'Hannah Kim', 'Tomás Reyes',
    'Grace Achieng', "Liam O'Neill", 'Sofia Rossi', 'Kenji Watanabe', 'Zara Malik', 'Ethan Cole'];
  const HUES = [172, 28, 262, 200, 340, 96, 48, 300, 12, 220, 150, 80];

  // ---------- Helpers ----------
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const initials = (n) => n.split(' ').map((w) => w[0]).join('').slice(0, 2);

  function makeAgent(i, name, hue, seed) {
    return Object.assign({
      id: 'agent-' + i, name, hue, initials: initials(name),
      today: 0, week: 0, handled: 0, ahtSum: 0, evals: [], autofails: 0,
      kudosReceived: 0, escalations: 0, streak: 0, adherenceHours: 0,
      sentSum: 0, sentCount: 0, csatSum: 0, csatCount: 0,
      lastEvent: Date.now(), state: 'Available',
    }, seed || {});
  }

  function scoreEvent(type, data, mix) {
    const q = mix.quality / DEFAULT_MIX.quality;
    const p = mix.productivity / DEFAULT_MIX.productivity;
    const a = mix.adherence / DEFAULT_MIX.adherence;
    switch (type) {
      case 'CONTACT_HANDLED': return Math.round(BASE.contact(data.HandleTime) * p);
      case 'EVALUATION_SUBMITTED': return data.AutoFail ? BASE.autofail : Math.round(BASE.evaluation(data.Score) * q);
      case 'ADHERENCE_HOUR': return Math.round(BASE.adherenceHour * a);
      case 'ADHERENCE_SCORED': return Math.max(0, Math.round(BASE.adherenceHour * a * (Number(data.AdherentHours) || 0)));
      case 'SENTIMENT_SCORED': return Math.round(BASE.sentiment(data.Sentiment) * q);
      case 'CSAT_RECEIVED': return Math.round(BASE.csat(data.Score) * q);
      case 'KUDOS': return BASE.kudos;
      case 'STREAK_DAY': return BASE.streakDay;
      case 'EVALUATION_ACKNOWLEDGED': return Math.round(BASE.evalAck * q);
      case 'CHALLENGE_WON': return Math.max(0, Math.round(Number(data.Points) || 0));
      default: return 0;
    }
  }

  function validateMix(mix) {
    const sum = mix.quality + mix.productivity + mix.adherence;
    if (sum !== 100) return { ok: false, message: `Weights add to ${sum}%. They need to add to 100% before saving.` };
    if (mix.quality < QUALITY_FLOOR) return { ok: true, message: `Quality under ${QUALITY_FLOOR}% lets agents win by rushing. Recommended: 50% or more.` };
    return { ok: true, message: '' };
  }

  function levelFor(points) {
    let i = LEVELS.length - 1;
    while (i > 0 && points < LEVELS[i].at) i--;
    const cur = LEVELS[i], next = LEVELS[i + 1] || null;
    const lo = cur.at, hi = next ? next.at : cur.at + 1000;
    return {
      index: i + 1, name: cur.name, next: next ? next.name : null,
      toNext: next ? next.at - points : 0,
      progress: Math.min(1, (points - lo) / (hi - lo)),
    };
  }

  const qaAvg = (agent) => { const e = agent.evals.filter((x) => x > 0); return e.length ? Math.round(mean(e)) : null; };
  const aht = (agent) => (agent.handled ? Math.round(agent.ahtSum / agent.handled) : 0);
  const round1 = (x) => Math.round(x * 10) / 10;
  const sentimentAvg = (agent) => (agent.sentCount ? round1(agent.sentSum / agent.sentCount) : null);
  const csatAvg = (agent) => (agent.csatCount ? round1(agent.csatSum / agent.csatCount) : null);

  // ---------- History: the same aggregation runs in the browser demo and in the API ----------
  /** Roll any set of per-agent day rows up into one summary. Pure. Auto-fails are stored as a 0 evaluation and excluded from the average. */
  function summarizeRows(rows) {
    let points = 0, handled = 0, ahtSum = 0, evalSum = 0, evalCount = 0, autofails = 0, escalations = 0, kudos = 0, sentSum = 0, sentCount = 0, csatSum = 0, csatCount = 0, adhSum = 0, adhCount = 0, adherenceHours = 0;
    const active = new Set();
    for (const r of rows) {
      points += r.points || 0; handled += r.handled || 0; ahtSum += r.ahtSum || 0; autofails += r.autofails || 0; escalations += r.escalations || 0; kudos += r.kudosReceived || 0;
      for (const e of r.evals || []) if (e > 0) { evalSum += e; evalCount++; }
      sentSum += r.sentSum || 0; sentCount += r.sentCount || 0; csatSum += r.csatSum || 0; csatCount += r.csatCount || 0;
      adhSum += r.adhSum || 0; adhCount += r.adhCount || 0; adherenceHours += r.adherenceHours || 0;
      if ((r.handled || 0) > 0 || (r.points || 0) !== 0) active.add(r.id);
    }
    return { points, handled, evaluations: evalCount, autofails, escalations, kudos, activeAgents: active.size,
      qa: evalCount ? Math.round(evalSum / evalCount) : null, aht: handled ? Math.round(ahtSum / handled) : null,
      escalationRate: handled ? round1((escalations / handled) * 100) : null,
      sentiment: sentCount ? round1(sentSum / sentCount) : null, csat: csatCount ? round1(csatSum / csatCount) : null,
      adherence: adhCount ? Math.round(adhSum / adhCount) : null, adherenceHours: round1(adherenceHours) };
  }

  /**
   * Results report. `days` is [{ date, rows: [{ id, name, points, handled, ahtSum, evals, ... }] }] covering up to
   * 2 x period days; the newest `period` days are the current period and the `period` before them the comparison. Pure.
   */
  function historyReport(days, period) {
    const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const cur = sorted.slice(-period), prev = sorted.slice(-2 * period, -period);
    const flat = (ds) => ds.flatMap((d) => d.rows);
    const prevHasData = flat(prev).length > 0;
    const current = summarizeRows(flat(cur)), previous = prevHasData ? summarizeRows(flat(prev)) : null;
    const change = {};
    for (const k of ['qa', 'sentiment', 'csat', 'aht', 'escalationRate', 'points', 'handled', 'autofails'])
      change[k] = previous && current[k] !== null && previous[k] !== null ? round1(current[k] - previous[k]) : null;
    const series = cur.map((d) => Object.assign({ date: d.date }, summarizeRows(d.rows)));
    const names = new Map();
    for (const d of [...prev, ...cur]) for (const r of d.rows) names.set(r.id, r.name || names.get(r.id) || r.id);
    const agents = [...names].map(([id, name]) => {
      const mine = (ds) => flat(ds).filter((r) => r.id === id);
      const c = summarizeRows(mine(cur)), pv = prevHasData ? summarizeRows(mine(prev)) : null;
      return { id, name, points: c.points, handled: c.handled, qa: c.qa, qaPrev: pv ? pv.qa : null,
        qaChange: pv && c.qa !== null && pv.qa !== null ? c.qa - pv.qa : null, sentiment: c.sentiment, csat: c.csat, aht: c.aht, autofails: c.autofails,
        daysActive: cur.filter((d) => d.rows.some((r) => r.id === id && (r.handled || 0) > 0)).length };
    }).filter((a) => a.points || a.handled || a.qa !== null).sort((a, b) => b.points - a.points);
    return { period, from: cur.length ? cur[0].date : null, to: cur.length ? cur[cur.length - 1].date : null, current, previous, change, series, agents };
  }

  /** Believable history for the browser demo: quality drifts upward so the report has a story. Deterministic for a given team and day. */
  function syntheticHistory(agents, count, now) {
    now = now || Date.now();
    let seed = 20260915;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const out = [];
    for (let d = count - 1; d >= 0; d--) {
      const date = new Date(now - d * 86400000).toISOString().slice(0, 10);
      const t = 1 - d / Math.max(1, count - 1);                 // 0 at the oldest day, 1 today
      const weekend = [0, 6].includes(new Date(date + 'T12:00:00Z').getUTCDay());
      const rows = [];
      agents.forEach((a, i) => {
        if (weekend && rnd() < 0.7) return;
        if (rnd() < 0.08) return;                               // a day off
        const handled = Math.round(((weekend ? 6 : 13) + rnd() * 9) * (0.86 + 0.26 * t));
        const ahtEach = Math.round(455 - 55 * t + (i % 5) * 12 + rnd() * 40);
        const evals = [];
        const nEval = rnd() < 0.55 ? 1 : rnd() < 0.5 ? 2 : 0;
        for (let k = 0; k < nEval; k++) evals.push(Math.max(55, Math.min(100, Math.round(77 + 9 * t + ((i * 7) % 9) - 4 + (rnd() - 0.5) * 14))));
        const autofails = rnd() < 0.035 * (1.4 - t) ? 1 : 0;
        if (autofails) evals.push(0);
        const sentCount = Math.round(handled * 0.6), csatCount = Math.round(handled * 0.18);
        const sentEach = 0.5 + 1.1 * t + ((i % 4) - 1.5) * 0.25 + (rnd() - 0.5) * 0.6;
        const csatEach = Math.max(1, Math.min(5, 3.9 + 0.5 * t + ((i % 3) - 1) * 0.15 + (rnd() - 0.5) * 0.4));
        const points = handled * 10 + evals.reduce((s, e) => s + BASE.evaluation(e), 0) + autofails * BASE.autofail + sentCount * 4 + csatCount * 6;
        rows.push({ id: a.id, name: a.name, points, handled, ahtSum: handled * ahtEach, evals, autofails, escalations: rnd() < 0.3 ? 1 : 0, kudosReceived: rnd() < 0.2 ? 1 : 0,
          sentSum: round1(sentCount * sentEach), sentCount, csatSum: round1(csatCount * csatEach), csatCount });
      });
      out.push({ date, rows });
    }
    return out;
  }
  const badgesFor = (agent) => BADGES.map((b) => ({ id: b.id, name: b.name, earned: !!b.test(agent) }));

  function flagsFor(agent, team, now) {
    now = now || Date.now();
    const out = [];
    const quietMs = now - agent.lastEvent;
    const teamMean = mean(team.map((t) => t.handled)) || 0;
    const q = qaAvg(agent);
    if (agent.state === 'Available' && quietMs > FLAGS.quietMinutes * 60000)
      out.push({ level: 'quiet', label: `Quiet ${Math.round(quietMs / 60000)} min`, why: `No agent events for ${FLAGS.quietMinutes}+ minutes while in Available state.` });
    if (agent.handled > teamMean * FLAGS.volumeRatio && q !== null && q < FLAGS.lowQa)
      out.push({ level: 'warn', label: 'Volume high, QA low', why: `${agent.handled} contacts at ${aht(agent)}s AHT with ${q}% QA. Possible rushing. Review a sample.` });
    const sAvg = sentimentAvg(agent);
    if (sAvg !== null && agent.sentCount >= FLAGS.sentimentMin && sAvg <= FLAGS.lowSentiment)
      out.push({ level: 'warn', label: 'Customer sentiment low', why: `Average customer sentiment ${sAvg} across ${agent.sentCount} analysed contacts. Listen to a sample together.` });
    const kMean = mean(team.map((t) => t.kudosReceived || 0)) || 0;
    if ((agent.kudosReceived || 0) >= FLAGS.kudosSpike && agent.kudosReceived >= kMean * 3)
      out.push({ level: 'warn', label: 'Kudos volume unusual', why: `${agent.kudosReceived} kudos today against a team average of ${kMean.toFixed(1)}. Check they are earned, not traded.` });
    if (agent.autofails > 0)
      out.push({ level: 'bad', label: 'Auto-fail today', why: `${agent.autofails} evaluation auto-fail${agent.autofails > 1 ? 's' : ''}. ${-BASE.autofail} pts removed each. Coaching note suggested.` });
    return out;
  }

  // ---------- Engine ----------
  function createEngine(opts) {
    opts = opts || {};
    let mix = Object.assign({}, DEFAULT_MIX, opts.mix || {});
    const agents = opts.agents || NAMES.map((n, i) => makeAgent(i, n, HUES[i]));
    const listeners = [];
    const byId = (id) => agents.find((a) => a.id === id);
    // In-memory challenges, rewards and kudos feed. The remote engine replaces these with API calls.
    const local = { challenges: [], rewards: [], kudos: [], coaching: [], prefs: {} };
    const newId = () => Math.random().toString(36).slice(2, 10);
    const withProgress = (ch) => Object.assign({}, ch, { progress: challengeProgress(ch, agents) });

    function ingest(ev) {
      const agent = byId(ev.AgentARN || ev.agentId);
      if (!agent) return null;
      const type = ev.EventType;
      const pts = scoreEvent(type, ev, mix);
      agent.lastEvent = ev.EventTimestamp ? Date.parse(ev.EventTimestamp) : Date.now();
      if (type === 'CONTACT_HANDLED') { agent.handled++; agent.ahtSum += ev.HandleTime || 0; if (ev.Escalated) agent.escalations++; }
      if (type === 'EVALUATION_SUBMITTED') { if (ev.AutoFail) { agent.autofails++; agent.evals.push(0); } else { agent.evals.push(ev.Score); const sp = spotlightText('evaluation', { score: ev.Score }); if (sp) { local.kudos.unshift({ at: new Date().toISOString(), from: 'Arena', auto: true, to: agent.id, toName: agent.name, note: sp }); local.kudos.length = Math.min(local.kudos.length, 50); } } }
      if (type === 'KUDOS') { agent.kudosReceived++; local.kudos.unshift({ at: ev.EventTimestamp || new Date().toISOString(), from: ev.From, to: agent.id, toName: agent.name, note: ev.Note }); local.kudos.length = Math.min(local.kudos.length, 50); }
      if (type === 'ADHERENCE_HOUR') agent.adherenceHours++;
      if (type === 'ADHERENCE_SCORED') { agent.adherenceHours = round1((agent.adherenceHours || 0) + (ev.AdherentHours || 0)); agent.adhSum = (agent.adhSum || 0) + (ev.Adherence || 0); agent.adhCount = (agent.adhCount || 0) + 1; }
      if (type === 'SENTIMENT_SCORED') { agent.sentSum = round1((agent.sentSum || 0) + ev.Sentiment); agent.sentCount = (agent.sentCount || 0) + 1; }
      if (type === 'CSAT_RECEIVED') { agent.csatSum = round1((agent.csatSum || 0) + ev.Score); agent.csatCount = (agent.csatCount || 0) + 1; }
      if (type === 'AGENT_STATE_CHANGE') agent.state = ev.State;
      if (type === 'BACKFILL_DAY') { agent.handled += ev.Handled || 0; agent.ahtSum += ev.AhtSum || 0; }
      agent.today += pts; agent.week += pts;
      const result = { event: ev, agent, points: pts, words: describe(type, ev) };
      listeners.forEach((fn) => fn(result));
      return result;
    }

    function describe(type, ev) {
      if (type === 'CONTACT_HANDLED') return `Handled <b>${ev.Queue || 'a'}</b> contact, ${Math.round((ev.HandleTime || 0) / 60)} min`;
      if (type === 'EVALUATION_SUBMITTED') return ev.AutoFail ? `Evaluation <b>auto-fail</b>: ${ev.Reason || 'policy'}` : `Evaluation scored <b>${ev.Score}%</b>`;
      if (type === 'KUDOS') return `Kudos from <b>${ev.From}</b>: “${ev.Note}”`;
      if (type === 'ADHERENCE_HOUR') return 'Hour in adherence';
      if (type === 'ADHERENCE_SCORED') return `Schedule adherence <b>${Math.round(ev.Adherence || 0)}%</b>, ${round1(ev.AdherentHours || 0)} h on schedule`;
      if (type === 'STREAK_DAY') return `Streak bonus, day ${ev.Day}`;
      if (type === 'EVALUATION_ACKNOWLEDGED') return `Acknowledged your <b>${ev.Score != null ? ev.Score + '%' : ''}</b> evaluation`;
      if (type === 'BACKFILL_DAY') return `History: <b>${ev.Handled}</b> contacts on ${ev.Day}`;
      if (type === 'CHALLENGE_WON') return `Challenge <b>${ev.Title || 'won'}</b>${ev.Place ? ', ' + ev.Place : ''}`;
      if (type === 'SENTIMENT_SCORED') return `Customer sentiment <b>${ev.Sentiment > 0 ? '+' : ''}${ev.Sentiment}</b> on a contact`;
      if (type === 'CSAT_RECEIVED') return `Customer survey: <b>${ev.Score} of 5</b>`;
      return type;
    }

    function leaderboard(range) {
      const key = range === 'week' ? 'week' : 'today';
      return [...agents].sort((a, b) => b[key] - a[key]).map((a, i) => Object.assign({ rank: i + 1, points: a[key], qa: qaAvg(a), aht: aht(a), sentiment: sentimentAvg(a), csat: csatAvg(a) }, { agent: a }));
    }

    function stats() {
      const qs = agents.map(qaAvg).filter((x) => x !== null);
      const handled = agents.reduce((s, a) => s + a.handled, 0), esc = agents.reduce((s, a) => s + (a.escalations || 0), 0);
      return {
        agents: agents.length,
        online: agents.filter((a) => a.state !== 'Offline').length,
        points: agents.reduce((s, a) => s + a.today, 0),
        handled, escalations: esc,
        escalationRate: handled ? (esc / handled) * 100 : null,   // percent, null until a contact exists
        qa: qs.length ? Math.round(mean(qs)) : null,
        sentiment: sentimentAvg({ sentSum: agents.reduce((s, a) => s + (a.sentSum || 0), 0), sentCount: agents.reduce((s, a) => s + (a.sentCount || 0), 0) }),
        csat: csatAvg({ csatSum: agents.reduce((s, a) => s + (a.csatSum || 0), 0), csatCount: agents.reduce((s, a) => s + (a.csatCount || 0), 0) }),
        flagged: agents.flatMap((a) => flagsFor(a, agents)).length,
      };
    }

    // ---- challenges, rewards, kudos (local implementations; same names on the remote engine) ----
    const challenges = async () => local.challenges.map(withProgress);
    const createChallenge = async (ch) => {
      const t = TEMPLATES[ch.template] || TEMPLATES.contest;
      const now = new Date().toISOString().slice(0, 10);
      const c = { id: newId(), template: ch.template, title: ch.title || t.title, scope: ch.scope || 'Team', target: ch.target != null ? ch.target : t.defaultTarget,
        reward: ch.reward != null ? ch.reward : t.reward, startsAt: ch.startsAt || now, endsAt: ch.endsAt || now, createdAt: new Date().toISOString(), createdBy: ch.createdBy || 'supervisor',
        metric: ch.metric, metrics: ch.metrics, minContacts: ch.minContacts, tiers: ch.tiers, anonymize: !!ch.anonymize, agents: ch.agents, opponent: ch.opponent, excluded: [] };
      c.state = c.startsAt > now ? 'scheduled' : 'active';
      if (c.template === 'teams') {   // the demo has no second team, so it invents one that tracks a little behind ours
        c.opponentAgents = agents.slice(0, Math.max(3, agents.length - 2)).map((a, i) => makeAgent(100 + i, 'Opponent ' + (i + 1), 200, { today: Math.round((a.today || 0) * 0.85), handled: Math.round((a.handled || 0) * 0.9), ahtSum: Math.round((a.ahtSum || 0) * 0.9), evals: (a.evals || []).map((e) => Math.max(0, e - 3)), sentSum: (a.sentSum || 0) * 0.7, sentCount: a.sentCount || 0, csatSum: (a.csatSum || 0) * 0.95, csatCount: a.csatCount || 0, kudosReceived: Math.round((a.kudosReceived || 0) * 0.5) }));
      }
      local.challenges.push(c); return withProgress(c);
    };
    const endChallenge = async (id) => { const c = local.challenges.find((x) => x.id === id); if (c) { c.state = 'ended'; c.results = Object.assign({ endedAt: new Date().toISOString() }, challengeProgress(c, agents)); } return c; };
    const updateChallenge = async (id, fields) => { const c = local.challenges.find((x) => x.id === id); if (!c) throw new Error('unknown challenge'); if (fields.state === 'ended') return endChallenge(id); if (Array.isArray(fields.excluded)) c.excluded = fields.excluded; return withProgress(c); };
    // Notifications: where the team hears about kudos, rewards, challenges and the daily digest. The demo keeps them in memory.
    local.notifications = { slackUrl: '', teamsUrl: '', email: '', digestHour: 17, events: { kudos: true, rewards: true, challenges: true, digest: true, spotlights: true } };
    const notifications = async () => Object.assign({}, local.notifications, { slackUrl: local.notifications.slackUrl ? '…' + local.notifications.slackUrl.slice(-6) : '', teamsUrl: local.notifications.teamsUrl ? '…' + local.notifications.teamsUrl.slice(-6) : '', slackSet: !!local.notifications.slackUrl, teamsSet: !!local.notifications.teamsUrl });
    const saveNotifications = async (n) => { for (const k of ['slackUrl', 'teamsUrl', 'email']) if (typeof n[k] === 'string' && !n[k].startsWith('…')) local.notifications[k] = n[k]; if (n.digestHour !== undefined) local.notifications.digestHour = +n.digestHour; if (n.events) Object.assign(local.notifications.events, n.events); return notifications(); };
    const testNotification = async () => ({ ok: true, sent: ['slackUrl', 'teamsUrl'].filter((k) => local.notifications[k]).map((k) => k.replace('Url', '')), note: 'demo: nothing is posted' });
    const rewards = async (status) => local.rewards.filter((r) => !status || r.status === status);
    // Catalog and balance period are per team; the demo keeps one set in memory. Spent points are tracked per agent and period.
    local.rewardSettings = { balancePeriod: 'week', items: CATALOG.map((c) => Object.assign({}, c)) }; local.spent = {};
    const rewardSettings = async () => Object.assign({ source: local.ownRewards ? 'team' : 'default' }, local.rewardSettings);
    const saveRewardSettings = async (s) => { local.rewardSettings = normalizeRewardSettings(s, local.rewardSettings); local.ownRewards = true; return rewardSettings(); };
    const resetRewardSettings = async () => { local.rewardSettings = { balancePeriod: 'week', items: CATALOG.map((c) => Object.assign({}, c)) }; local.ownRewards = false; return rewardSettings(); };
    const catalog = async () => local.rewardSettings.items;
    const balance = async (agentId) => { const a = byId(agentId); const today = new Date().toISOString().slice(0, 10), p = local.rewardSettings.balancePeriod; const earned = p === 'week' ? (a ? a.week : 0) : (a ? a.week * (p === 'month' ? 3 : 9) : 0); return balanceSummary(p, today, earned, local.spent[agentId + '#' + periodKey(p, today)] || 0); };
    const requestReward = async (agentId, catalogId, by) => {
      const a = byId(agentId), item = local.rewardSettings.items.find((c) => c.id === catalogId);
      if (!a || !item) throw new Error('unknown agent or reward');
      const bal = await balance(agentId);
      if (bal.balance < item.cost) throw new Error(`needs ${item.cost.toLocaleString()} pts, has ${bal.balance.toLocaleString()}`);
      const r = { id: newId(), agentId, agentName: a.name, catalogId, what: item.name, cost: item.cost, status: 'pending', requestedAt: new Date().toISOString(), requestedBy: by || a.name };
      local.rewards.unshift(r); return r;
    };
    const decideReward = async (id, status, by) => { const r = local.rewards.find((x) => x.id === id); if (!r) throw new Error('unknown reward'); r.status = status; r.decidedAt = new Date().toISOString(); r.decidedBy = by || 'supervisor'; if (status === 'approved') { if (local.budget.monthly && local.budget.spent + r.cost > local.budget.monthly) { r.status = 'pending'; delete r.decidedAt; throw new Error('monthly reward budget would be exceeded'); } local.budget.spent += r.cost; const k = r.agentId + '#' + periodKey(local.rewardSettings.balancePeriod, new Date().toISOString().slice(0, 10)); local.spent[k] = (local.spent[k] || 0) + r.cost; } return r; };
    const kudosFeed = async (limit) => local.kudos.slice(0, limit || 10);
    // Reward budget: a monthly cap in points. The demo starts with a cap and some spend so the console shows the bar.
    local.budget = { monthly: 20000, spent: 7500 };
    const budgetView = () => budgetSummary(local.budget.monthly, local.budget.spent, new Date().toISOString().slice(0, 7));
    const budget = async () => budgetView();
    local.theme = Object.assign({}, THEME_DEFAULTS);
    const theme = async () => Object.assign({}, local.theme);
    const saveTheme = async (t) => { local.theme = normalizeTheme(t, local.theme); return theme(); };
    const uploadLogo = async (dataUrl) => { local.theme.logoUrl = dataUrl; return theme(); };
    // People and data keys exist only against the live API; the demo shows the shape.
    local.users = agents.slice(0, 4).map((a, i) => ({ username: a.name.toLowerCase().replace(/[^a-z]+/g, '.'), name: a.name, email: '', team: 'Billing team', agentArn: a.id, role: i === 0 ? 'supervisor' : 'agent', status: 'CONFIRMED', enabled: true }));
    const users = async () => local.users;
    const createUser = async (p) => { const person = Object.assign({ status: 'FORCE_CHANGE_PASSWORD', enabled: true, role: 'agent', team: '', email: '', agentArn: '' }, p); local.users.push(person); return { person, temporaryPassword: p.email ? undefined : 'Demo-Temp-1234', invited: !!p.email }; };
    const updateUser = async (username, p) => { const u = local.users.find((x) => x.username === username); if (!u) throw new Error('no such person'); Object.assign(u, p); return u; };
    const resetPassword = async (username) => ({ username, temporaryPassword: 'Demo-Temp-5678' });
    const deleteUser = async (username) => { local.users = local.users.filter((x) => x.username !== username); return { username, deleted: true }; };
    local.dataKeys = [];
    const dataKeys = async () => local.dataKeys;
    const createDataKey = async (label, days) => { const k = { key: 'dk_demo' + (local.dataKeys.length + 1), label: label || 'Warehouse', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (days || 365) * 86400000).toISOString() }; local.dataKeys.push(k); return k; };
    const revokeDataKey = async (key) => { local.dataKeys = local.dataKeys.filter((k) => k.key !== key); return { revoked: key }; };
    const exportDays = async (from, to) => ({ from, to, rows: syntheticHistory(agents, 7).flatMap((d) => d.rows.map((r) => ({ day: d.date, team: 'Billing team', agentId: r.id, name: r.name, points: r.points, contactsHandled: r.handled }))) });
    const apiBase = () => '/api';
    const setBudget = async (monthly) => { local.budget.monthly = Math.max(0, Math.round(Number(monthly) || 0)); return budgetView(); };

    // ---- coaching: a flag becomes a plan with an owner, an action and a follow-up date ----
    // `baseline` is the agent's numbers when the plan was opened and `since` their numbers after it, so the loop can be closed on evidence.
    const snapshot = (a) => ({ qa: qaAvg(a), sentiment: sentimentAvg(a), csat: csatAvg(a), handled: a.handled, aht: aht(a) || null, autofails: a.autofails });
    const withSince = (c) => { const a = byId(c.agentId); return Object.assign({}, c, { since: c.status === 'done' ? c.result || null : a ? snapshot(a) : null }); };
    const coaching = async (filter) => local.coaching.filter((c) => (!filter || !filter.status || c.status === filter.status) && (!filter || !filter.agentId || c.agentId === filter.agentId)).map(withSince);
    const createCoaching = async (c) => {
      const a = byId(c.agentId);
      if (!a) throw new Error('unknown agent');
      const item = { id: newId(), agentId: a.id, agentName: a.name, reason: c.reason || '', note: c.note || '', action: c.action || '', dueAt: c.dueAt || '', status: 'open',
        createdAt: new Date().toISOString(), createdBy: c.createdBy || 'supervisor', baseline: snapshot(a) };
      local.coaching.unshift(item); return withSince(item);
    };
    const updateCoaching = async (id, fields) => {
      const c = local.coaching.find((x) => x.id === id);
      if (!c) throw new Error('unknown coaching plan');
      for (const k of ['note', 'action', 'dueAt', 'outcome']) if (fields[k] !== undefined) c[k] = fields[k];
      if (fields.acknowledged && !c.acknowledgedAt) c.acknowledgedAt = new Date().toISOString();
      if (fields.status === 'done' && c.status !== 'done') { const a = byId(c.agentId); c.status = 'done'; c.closedAt = new Date().toISOString(); c.result = a ? snapshot(a) : null; }
      return withSince(c);
    };
    const history = async (days) => historyReport(syntheticHistory(agents, 2 * (days || 30)), days || 30);

    function preview(m) {
      return {
        eval90: scoreEvent('EVALUATION_SUBMITTED', { Score: 90 }, m),
        contact7min: scoreEvent('CONTACT_HANDLED', { HandleTime: 420 }, m),
        autofail: BASE.autofail,
        adherenceHour: scoreEvent('ADHERENCE_HOUR', {}, m),
        sentimentGood: scoreEvent('SENTIMENT_SCORED', { Sentiment: 3 }, m),
        csat5: scoreEvent('CSAT_RECEIVED', { Score: 5 }, m),
      };
    }

    return {
      agents, byId, ingest,
      on: (fn) => listeners.push(fn),
      leaderboard, stats, preview,
      getMix: () => Object.assign({}, mix),
      setMix: (m) => { const v = validateMix(m); if (v.ok) mix = Object.assign({}, m); return v; },
      // Scoring profiles: the demo has one team, so "this team" and "the default" are the same mix.
      mixInfo: async () => ({ mix: Object.assign({}, mix), source: local.ownMix ? 'team' : 'default', team: 'Billing team', default: Object.assign({}, local.defaultMix || mix) }),
      saveMix: async (m, scope) => { const v = validateMix(m); if (!v.ok) return { ok: false, message: v.message }; mix = Object.assign({}, m); if (scope === 'team') local.ownMix = true; else { local.ownMix = false; local.defaultMix = Object.assign({}, m); } return { ok: true, message: v.message || '' }; },
      clearMix: async () => { local.ownMix = false; if (local.defaultMix) mix = Object.assign({}, local.defaultMix); return { mix: Object.assign({}, mix), source: 'default' }; },
      // Personal best from the demo's synthetic history, plus today's live points.
      best: async (agentId) => { const id = agentId || agents[0].id, today = new Date().toISOString().slice(0, 10); const rows = syntheticHistory(agents, 60).map((d) => { const r = d.rows.find((x) => x.id === id); return { day: d.date, points: r ? r.points : 0 }; }); const a = byId(id); const t = rows.find((r) => r.day === today); if (t && a) t.points = a.today; return personalBest(rows, today); },
      prefs: async (agentId) => Object.assign({ personalBest: false }, local.prefs[agentId] || {}),
      savePrefs: async (agentId, p) => { local.prefs[agentId] = Object.assign({}, local.prefs[agentId] || {}, p); return local.prefs[agentId]; },
      flags: (a) => flagsFor(a, agents),
      suggestions: () => recommendChallenges(agents),
      badges: badgesFor, level: (a) => levelFor(a.week), qaAvg, aht, sentimentAvg, csatAvg,
      challenges, createChallenge, endChallenge, updateChallenge, rewards, requestReward, decideReward, kudosFeed, budget, setBudget, rewardSettings, saveRewardSettings, resetRewardSettings, catalog, balance,
      users, createUser, updateUser, resetPassword, deleteUser, dataKeys, createDataKey, revokeDataKey, exportDays, apiBase, theme, saveTheme, uploadLogo,
      coaching, createCoaching, updateCoaching, history, notifications, saveNotifications, testNotification,
      kudos: async (to, note, from, fromId) => { const a = byId(to); if (!a || (fromId && fromId === to)) return false; ingest({ EventType: 'KUDOS', AgentARN: to, EventTimestamp: new Date().toISOString(), From: from || 'A teammate', Note: note }); return true; },
      _local: local,
    };
  }

  // ---------- Simulator: stands in for Kinesis + S3 until the real feed exists ----------
  function createSimulator(engine, opts) {
    opts = opts || {};
    let timer = null, perTenSeconds = opts.rate || 4, exclude = opts.exclude || [];
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const queues = ['Billing', 'Support', 'Retention'];
    const notes = ['great save', 'thanks for the handoff', 'nice de-escalation', 'carried the queue', 'calm under pressure'];

    function fire(type, agent) {
      agent = agent || pick(engine.agents.filter((a) => !exclude.includes(a.id)));
      const base = { AgentARN: agent.id, EventTimestamp: new Date().toISOString() };
      if (type === 'contact') return engine.ingest(Object.assign(base, { EventType: 'CONTACT_HANDLED', Queue: pick(queues), HandleTime: 200 + Math.floor(Math.random() * 500), Escalated: Math.random() < 0.04 }));
      if (type === 'eval') return engine.ingest(Object.assign(base, { EventType: 'EVALUATION_SUBMITTED', Score: 70 + Math.floor(Math.random() * 30) }));
      if (type === 'autofail') return engine.ingest(Object.assign(base, { EventType: 'EVALUATION_SUBMITTED', AutoFail: true, Reason: 'missed verification' }));
      if (type === 'sentiment') return engine.ingest(Object.assign(base, { EventType: 'SENTIMENT_SCORED', Sentiment: Math.round((Math.random() * 5.5 - 1.2) * 10) / 10 }));
      if (type === 'csat') return engine.ingest(Object.assign(base, { EventType: 'CSAT_RECEIVED', Score: pick([5, 5, 5, 4, 4, 4, 3, 2]) }));
      if (type === 'kudos') { const from = pick(engine.agents.filter((a) => a.id !== agent.id)); return engine.ingest(Object.assign(base, { EventType: 'KUDOS', From: opts.fullNames ? from.name : from.name.split(' ')[0], Note: pick(notes) })); }
      return null;
    }
    function tick() { const r = Math.random(); fire(r < 0.48 ? 'contact' : r < 0.66 ? 'eval' : r < 0.82 ? 'sentiment' : r < 0.89 ? 'csat' : r < 0.97 ? 'kudos' : 'autofail'); }
    function start() { stop(); timer = setInterval(tick, 10000 / perTenSeconds); }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    return { fire, start, stop, setRate: (r) => { perTenSeconds = r; if (timer) start(); }, get running() { return !!timer; } };
  }

  // Deterministic-ish seed so every page opens with the same stories in it.
  function seedTeam(engine, now) {
    now = now || Date.now();
    engine.agents.forEach((a, i) => {
      a.today = 60 + ((i * 37) % 120); a.week = 700 + ((i * 131) % 500);
      a.handled = 4 + (i % 6); a.ahtSum = a.handled * (300 + (i * 23) % 200); a.evals = [80 + (i * 7) % 15];
      a.lastEvent = now - ((i * 5) % 20) * 60000; a.streak = 3 + (i % 5);
      a.sentCount = 3 + (i % 4); a.sentSum = round1(a.sentCount * (0.8 + ((i * 37) % 22) / 10));
      a.csatCount = 1 + (i % 3); a.csatSum = round1(a.csatCount * (4 + (i % 3) * 0.4));
    });
    const you = engine.agents[0]; you.today = 118; you.evals = [92]; you.streak = 7; you.kudosReceived = 1;
    const liam = engine.agents[7]; liam.lastEvent = now - 52 * 60000;
    const kenji = engine.agents[9]; kenji.handled = 19; kenji.ahtSum = 19 * 170; kenji.evals = [68, 71]; kenji.today = 190; kenji.sentCount = 9; kenji.sentSum = -12.6; kenji.csatCount = 3; kenji.csatSum = 8;
    const hannah = engine.agents[4]; hannah.autofails = 1; hannah.evals = [0, 88];
    // Demo challenges, rewards and kudos so every page opens with something to show.
    const today = new Date(now).toISOString().slice(0, 10), fri = new Date(now + 4 * 86400000).toISOString().slice(0, 10), mon = new Date(now + 6 * 86400000).toISOString().slice(0, 10);
    engine._local.challenges.push(
      { id: 'c-esc', template: 'esc', title: 'Billing queue: keep escalations under 5%', scope: 'Team', target: 5, reward: 150, startsAt: today, endsAt: fri, state: 'active', createdAt: new Date(now).toISOString() },
      { id: 'c-qa', template: 'qa', title: 'Every evaluation 85 or better', scope: 'Individual, opt-in', target: 85, reward: 100, startsAt: today, endsAt: fri, state: 'active', createdAt: new Date(now).toISOString() },
      { id: 'c-race', template: 'race', title: 'Quality race: evaluations and sentiment', scope: 'Individual', target: 0, reward: 0, startsAt: today, endsAt: fri, state: 'active', createdAt: new Date(now).toISOString(),
        metrics: [{ key: 'qa', weight: 2 }, { key: 'sentiment', weight: 1 }], minContacts: 3, tiers: [{ place: 1, reward: 150 }, { place: 2, reward: 75 }, { place: 3, reward: 40 }], anonymize: false, excluded: [] },
      { id: 'c-duel', template: 'duel', title: 'Head-to-head: Diego vs Grace on contacts', scope: 'Head-to-head', target: 0, reward: 100, startsAt: today, endsAt: fri, state: 'active', createdAt: new Date(now).toISOString(), metric: 'handled', agents: [engine.agents[3].id, engine.agents[6].id], excluded: [] },
      { id: 'c-contest', template: 'contest', title: 'Team points target', scope: 'Team', target: 2000, reward: 250, startsAt: mon, endsAt: mon, state: 'scheduled', createdAt: new Date(now).toISOString() });
    engine.agents[2].week = 2600; engine.agents[3].week = 5200; engine.agents[3].escalations = 1;
    engine._local.rewards.push(
      { id: 'r1', agentId: engine.agents[2].id, agentName: engine.agents[2].name, catalogId: 'gift25', what: '$25 gift card', cost: 2500, status: 'pending', requestedAt: new Date(now - 3600000).toISOString() },
      { id: 'r2', agentId: engine.agents[3].id, agentName: engine.agents[3].name, catalogId: 'halfday', what: 'Half-day Friday', cost: 5000, status: 'pending', requestedAt: new Date(now - 7200000).toISOString() });
    engine._local.kudos.push(
      { at: new Date(now - 1200000).toISOString(), from: 'Marcus Bell', to: engine.agents[6].id, toName: engine.agents[6].name, note: 'took my overflow call' },
      { at: new Date(now - 2400000).toISOString(), from: 'Supervisor Dana', to: you.id, toName: you.name, note: 'calm under pressure' });
    // One coaching plan already under way, so the loop is visible: opened on an auto-fail, action agreed, follow-up due.
    engine._local.coaching.push({ id: 'co-1', agentId: hannah.id, agentName: hannah.name, reason: 'Auto-fail: missed verification', note: 'Second miss this month. Walked through the verification script on two recorded calls.',
      action: 'Use the verification checklist on every billing call this week', dueAt: fri, status: 'open', createdAt: new Date(now - 2 * 86400000).toISOString(), createdBy: 'Supervisor Dana',
      baseline: { qa: 74, sentiment: 0.4, csat: 3.8, handled: 41, aht: 402, autofails: 2 }, acknowledgedAt: new Date(now - 86400000).toISOString() });
    return engine;
  }

  // ---------- Remote engine: same interface as createEngine, data from the Arena API ----------
  // Pages call Arena.connect() and get either a local simulated engine or a polling remote one,
  // depending on ?api=<base url>&team=<routing profile>[&agent=<arn>][&token=<jwt>] in the page URL.
  function createRemoteEngine(opts) {
    const base = opts.api.replace(/\/$/, '');
    // Kiosk mode: a wallboard token stands in for sign-in; the API resolves the team from it.
    const kiosk = opts.kiosk || null;
    let team = opts.team || 'unassigned';
    // Token comes from a static value or, when sign-in is configured, from a provider that can refresh it.
    const tokenProvider = opts.tokenProvider || (async () => opts.token || null);
    // Every call waits for sign-in to finish first, so nothing fires during the token exchange.
    const headersFor = async () => { if (opts.ready) await opts.ready(); const t = await tokenProvider(); return Object.assign({ 'content-type': 'application/json' }, t ? { authorization: 'Bearer ' + t } : {}); };
    const engine = createEngine({ agents: [] });
    const listeners = [];
    let mix = Object.assign({}, DEFAULT_MIX), lastSeen = {}, timer = null;
    const hueFor = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

    const readPath = (what) => kiosk ? `${base}/kiosk/${encodeURIComponent(kiosk)}/${what}` : `${base}/teams/${encodeURIComponent(team)}/${what}`;
    async function refresh() {
      const r = await fetch(readPath('agents'), { headers: await headersFor() });
      if (!r.ok) throw new Error(r.status === 401 && kiosk ? 'wallboard link is invalid or expired' : 'arena api ' + r.status);
      const body = await r.json();
      if (kiosk && body.team) team = body.team;
      if (body.timezone) engine.timezone = body.timezone;   // the stack's Timezone setting: when its days start
      engine.agents.length = 0;
      for (const a of body.agents) { a.hue = hueFor(a.id); a.initials = initials(a.name || '?'); engine.agents.push(a); }
      // The signed-in agent may have no rows yet (nothing scored today). Show them at zero rather than nothing.
      const self = typeof opts.self === 'function' ? opts.self() : opts.self;
      if (self && self.id && !engine.agents.some((a) => a.id === self.id)) {
        engine.agents.push(makeAgent(engine.agents.length, self.name || self.id.split('/').pop(), hueFor(self.id), { id: self.id, team, lastEvent: 0, state: 'Offline', placeholder: true }));
      }
      for (const a of engine.agents) {
        const prev = lastSeen[a.id];
        if (prev !== undefined && prev !== a.today) listeners.forEach((fn) => fn({ agent: a, points: a.today - prev, event: { EventType: 'REFRESH', AgentARN: a.id }, words: 'Points updated' }));
        lastSeen[a.id] = a.today;
      }
      return engine.agents;
    }
    async function events(agentId, limit) {
      const r = await fetch(`${base}/agents/${encodeURIComponent(agentId)}/events?limit=${limit || 10}`, { headers: await headersFor() });
      return r.ok ? (await r.json()).events : [];
    }
    const mixPath = () => `${base}/config/mix` + (team ? '?team=' + encodeURIComponent(team) : '');
    /** The mix that applies to this team, with where it comes from: { mix, source: 'team'|'default', team, default }. */
    async function mixInfo() { const r = await fetch(mixPath(), { headers: await headersFor() }); if (!r.ok) throw new Error('arena api ' + r.status); const info = await r.json(); mix = info.mix; return info; }
    async function loadMix() { return (await mixInfo()).mix; }
    /** scope 'team' saves a profile for this team only; anything else updates the stack-wide default. */
    async function saveMix(m, scope) {
      const r = await fetch(scope === 'team' ? mixPath() : `${base}/config/mix`, { method: 'PUT', headers: await headersFor(), body: JSON.stringify(m) });
      const body = await r.json();
      if (r.ok && (scope === 'team' || body.source !== 'team')) mix = body.mix;
      return { ok: r.ok, message: body.error || body.warning || '' };
    }
    const clearMix = async () => { const info = await call('PUT', mixPath(), { useDefault: true }); mix = info.mix; return info; };
    const best = async (agentId) => call('GET', `${base}/agents/${encodeURIComponent(agentId)}/best`);
    const prefs = async (agentId) => (await call('GET', `${base}/agents/${encodeURIComponent(agentId)}/prefs`)).prefs;
    const savePrefs = async (agentId, p) => (await call('PUT', `${base}/agents/${encodeURIComponent(agentId)}/prefs`, p)).prefs;
    async function kudos(to, note, from, fromId) {
      const a = engine.byId(to);
      const r = await fetch(`${base}/kudos`, { method: 'POST', headers: await headersFor(), body: JSON.stringify({ to, note, team, fromId, toName: a && a.name, toUsername: a && a.username }) });
      if (!r.ok) { const body = await r.json().catch(() => ({})); throw new Error(body.error || ('arena api ' + r.status)); }
      return true;
    }
    const teamPath = () => `${base}/teams/${encodeURIComponent(team)}`;
    async function call(method, path, body) {
      const r = await fetch(path, { method, headers: await headersFor(), body: body ? JSON.stringify(body) : undefined });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ('arena api ' + r.status));
      return data;
    }
    const challenges = async () => (await call('GET', readPath('challenges'))).challenges;
    const createChallenge = async (ch) => (await call('POST', `${teamPath()}/challenges`, ch)).challenge;
    const endChallenge = async (id) => (await call('PUT', `${teamPath()}/challenges/${encodeURIComponent(id)}`, { state: 'ended' })).challenge;
    const updateChallenge = async (id, fields) => (await call('PUT', `${teamPath()}/challenges/${encodeURIComponent(id)}`, fields)).challenge;
    const notifications = async () => (await call('GET', `${teamPath()}/notifications`)).notifications;
    const saveNotifications = async (n) => (await call('PUT', `${teamPath()}/notifications`, n)).notifications;
    const testNotification = async () => call('POST', `${teamPath()}/notifications/test`);
    const rewards = async (status) => (await call('GET', `${teamPath()}/rewards${status ? '?status=' + status : ''}`)).rewards;
    const requestReward = async (agentId, catalogId) => (await call('POST', `${teamPath()}/rewards`, { agentId, catalogId })).reward;
    const decideReward = async (id, status) => (await call('PUT', `${teamPath()}/rewards/${encodeURIComponent(id)}`, { status })).reward;
    const kudosFeed = async (limit) => (await call('GET', readPath('kudos') + `?limit=${limit || 10}`)).kudos;
    const budget = async () => (await call('GET', `${teamPath()}/budget`)).budget;
    const rewardSettings = async () => (await call('GET', `${teamPath()}/rewards/settings`)).settings;
    const saveRewardSettings = async (s) => (await call('PUT', `${teamPath()}/rewards/settings`, s)).settings;
    const resetRewardSettings = async () => (await call('PUT', `${teamPath()}/rewards/settings`, { useDefault: true })).settings;
    const catalog = async () => (await call('GET', `${teamPath()}/rewards?status=none`)).catalog;
    const balance = async (agentId) => (await call('GET', `${base}/agents/${encodeURIComponent(agentId)}/balance`)).balance;
    // People (Cognito) and data keys for warehouses: supervisors only; the API enforces it.
    const users = async () => (await call('GET', `${base}/admin/users`)).users;
    const createUser = async (p) => call('POST', `${base}/admin/users`, p);
    const updateUser = async (username, p) => (await call('PUT', `${base}/admin/users/${encodeURIComponent(username)}`, p)).person;
    const resetPassword = async (username) => call('POST', `${base}/admin/users/${encodeURIComponent(username)}/password`, {});
    const deleteUser = async (username) => call('DELETE', `${base}/admin/users/${encodeURIComponent(username)}`);
    const dataKeys = async () => (await call('GET', `${base}/data/keys`)).keys;
    const createDataKey = async (label, days) => (await call('POST', `${base}/data/keys`, { label, days })).key;
    const revokeDataKey = async (key) => call('DELETE', `${base}/data/keys/${encodeURIComponent(key)}`);
    const exportDays = async (from, to, teamName) => call('GET', `${base}/export/days?from=${from}&to=${to}` + (teamName ? '&team=' + encodeURIComponent(teamName) : ''));
    const apiBase = () => base;
    const theme = async () => (await call('GET', kiosk ? `${base}/kiosk/${encodeURIComponent(kiosk)}/theme` : `${base}/config/theme`)).theme;
    const saveTheme = async (t) => (await call('PUT', `${base}/config/theme`, t)).theme;
    /** dataUrl: a data: URL from a FileReader (png, jpeg, svg, webp, at most 300 KB). */
    const uploadLogo = async (dataUrl) => (await call('POST', `${base}/config/logo`, { dataUrl })).theme;
    const setBudget = async (monthly) => (await call('PUT', `${teamPath()}/budget`, { monthly })).budget;
    const kiosks = async () => (await call('GET', `${teamPath()}/kiosk`)).kiosks;
    const createKiosk = async (label, days) => (await call('POST', `${teamPath()}/kiosk`, { label, days })).kiosk;
    const revokeKiosk = async (token) => call('DELETE', `${teamPath()}/kiosk/${encodeURIComponent(token)}`);
    const deleteAgent = async (id) => call('DELETE', `${base}/agents/${encodeURIComponent(id)}`);
    const coaching = async (filter) => { const q = new URLSearchParams(); if (filter && filter.status) q.set('status', filter.status); if (filter && filter.agentId) q.set('agent', filter.agentId); const qs = q.toString(); return (await call('GET', `${teamPath()}/coaching${qs ? '?' + qs : ''}`)).coaching; };
    const createCoaching = async (c) => (await call('POST', `${teamPath()}/coaching`, c)).coaching;
    const updateCoaching = async (id, fields) => (await call('PUT', `${teamPath()}/coaching/${encodeURIComponent(id)}`, fields)).coaching;
    const history = async (days) => (await call('GET', `${teamPath()}/history?days=${days || 30}`)).report;
    const recordMetric = async (m) => call('POST', `${teamPath()}/metrics`, m);
    async function start(seconds) { stop(); if (opts.ready) await opts.ready(); timer = setInterval(() => refresh().catch(console.error), (seconds || 5) * 1000); return refresh(); }
    function stop() { if (timer) clearInterval(timer); timer = null; }

    // Object.assign copies getter values, not getters, so `team` is defined on the result afterwards to stay live.
    const remoteEngine = Object.assign({}, engine, {
      remote: true, kiosk: !!kiosk, refresh, events, loadMix, saveMix, mixInfo, clearMix, best, prefs, savePrefs, kudos, start, stop,
      challenges, createChallenge, endChallenge, rewards, requestReward, decideReward, kudosFeed, budget, setBudget, rewardSettings, saveRewardSettings, resetRewardSettings, catalog, balance, users, createUser, updateUser, resetPassword, deleteUser, dataKeys, createDataKey, revokeDataKey, exportDays, apiBase, theme, saveTheme, uploadLogo, kiosks, createKiosk, revokeKiosk, deleteAgent,
      coaching, createCoaching, updateCoaching, history, recordMetric, updateChallenge, notifications, saveNotifications, testNotification,
      on: (fn) => listeners.push(fn),
      suggestions: () => recommendChallenges(engine.agents),
      getMix: () => Object.assign({}, mix),
      setMix: (m) => { const v = validateMix(m); if (v.ok) saveMix(m); return v; },
      ingest: () => { throw new Error('remote engine is read-only; events arrive from the stream'); },
    });
    Object.defineProperty(remoteEngine, 'team', { get: () => team, enumerable: true });
    return remoteEngine;
  }

  // Query string wins, then window.ARENA_CONFIG (written by config.js at deploy time), then the simulator.
  function connect(search, config, auth) {
    const p = new URLSearchParams(search !== undefined ? search : (typeof location !== 'undefined' ? location.search : ''));
    const c = config || (typeof window !== 'undefined' && window.ARENA_CONFIG) || {};
    const a = auth || (typeof ArenaAuth !== 'undefined' ? ArenaAuth : null);
    const kiosk = p.get('kiosk') || c.kiosk || null;
    const signedIn = !kiosk && !!(a && c.auth && a.enabled());
    const api = p.get('api') || c.api, token = p.get('token') || c.token;
    if (api && kiosk) {
      // Wallboard on a TV: no sign-in, read-only, team comes back from the API.
      const engine = createRemoteEngine({ api, kiosk, team: p.get('team') || c.team });
      return { engine, remote: true, signedIn: false, kiosk: true, agentId: null, isSupervisor: false };
    }
    if (api) {
      // With sign-in, identity and team come from the token's custom claims unless the URL overrides them.
      const claims = () => (signedIn && a.claims()) || {};
      const engine = createRemoteEngine({ api, token, tokenProvider: signedIn ? () => a.token() : undefined, ready: signedIn ? () => a.ready() : undefined,
        get team() { return p.get('team') || c.team || claims()['custom:team'] || 'unassigned'; },
        self: () => { const cl = claims(); const id = p.get('agent') || c.agent || cl['custom:agentArn']; return id ? { id, name: cl.name || cl['cognito:username'] || undefined } : null; } });
      return { engine, remote: true, signedIn, get agentId() { return p.get('agent') || c.agent || claims()['custom:agentArn'] || null; },
        get isSupervisor() { return signedIn ? a.isSupervisor(claims()) : true; } };
    }
    const engine = seedTeam(createEngine());
    return { engine, agentId: engine.agents[0].id, remote: false };
  }

  return { createEngine, createRemoteEngine, connect, createSimulator, seedTeam, scoreEvent, validateMix, levelFor, flagsFor, badgesFor, challengeProgress, challengeStandings, aggregateAgents, metricOf, metricOfTeam, budgetSummary, budgetAlerts, personalBest, isoWeek, spotlightText, isBestDay, SPOTLIGHTS, recommendChallenges, normalizeTheme, THEME_DEFAULTS, ui, normalizeRewardSettings, periodKey, periodBounds, balanceSummary, REWARD_DEFAULTS, BALANCE_PERIODS, summarizeRows, historyReport, syntheticHistory, sentimentAvg, csatAvg,
    DEFAULT_MIX, QUALITY_FLOOR, BASE, LEVELS, BADGES, FLAGS, TEMPLATES, METRICS, CATALOG, NAMES, HUES };
});
