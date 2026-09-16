/*
 * Arena usage metering for AWS Marketplace.
 *
 * Runs once a day (EventBridge schedule). Counts distinct agents with any scored
 * activity in the trailing 30 days and reports that number as the "agents"
 * dimension to the Marketplace Metering Service. Marketplace bills the customer
 * per agent from that report; nothing else in the product depends on it.
 *
 * Off-Marketplace (no PRODUCT_CODE set) the function logs the count and exits,
 * so the same stack runs for pilots and direct deals without a Marketplace listing.
 *
 * Idempotent per day: the report carries a UsageRecord for today's date and the
 * last reported count is stored in the table so a retry never double-bills.
 */
'use strict';
const store = require('./store.js');

const PRODUCT_CODE = process.env.PRODUCT_CODE || '';
const DIMENSION = process.env.USAGE_DIMENSION || 'agents';
const WINDOW_DAYS = +(process.env.USAGE_WINDOW_DAYS || 30);

let mm;
function metering() {
  if (mm) return mm;
  const { MarketplaceMeteringClient, MeterUsageCommand } = require('@aws-sdk/client-marketplace-metering');
  mm = { client: new MarketplaceMeteringClient({}), MeterUsageCommand };
  return mm;
}

/** Distinct agents with a LIVE row whose lastEvent falls inside the window. Pure over the rows it is given. */
function countActive(liveRows, now, windowDays) {
  const cutoff = now - (windowDays || WINDOW_DAYS) * 86400000;
  const seen = new Set();
  for (const r of liveRows) {
    const t = r.lastEvent ? Date.parse(r.lastEvent) : 0;
    if (t >= cutoff && r.pk) seen.add(r.pk);
  }
  return seen.size;
}

async function report(count, now, deps) {
  const s = deps.store || store;
  const day = new Date(now).toISOString().slice(0, 10);
  const prior = await s.getMeter(day);
  if (prior && prior.reported) return { skipped: 'already reported', day, count: prior.count };
  if (!PRODUCT_CODE) { await s.putMeter(day, { count, reported: false, note: 'no PRODUCT_CODE' }); return { skipped: 'not a Marketplace deployment', day, count }; }
  const m = deps.metering || metering();
  const r = await m.client.send(new m.MeterUsageCommand({
    ProductCode: PRODUCT_CODE, Timestamp: new Date(now), UsageDimension: DIMENSION, UsageQuantity: count, DryRun: false,
  }));
  await s.putMeter(day, { count, reported: true, meteringRecordId: r.MeteringRecordId, at: new Date(now).toISOString() });
  return { reported: true, day, count, meteringRecordId: r.MeteringRecordId };
}

exports.handler = async (event, context, deps) => {
  deps = deps || {};
  const s = deps.store || store;
  const now = deps.now ? deps.now() : Date.now();
  const rows = await s.scanLive();
  const count = countActive(rows, now);
  const result = await report(count, now, deps);
  console.log(JSON.stringify(result));
  return result;
};

exports.countActive = countActive;
exports.report = report;
