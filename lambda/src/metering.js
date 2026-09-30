/*
 * Arena usage metering for AWS Marketplace.
 *
 * Runs once a day (EventBridge schedule). Counts distinct agents with any scored
 * activity in the trailing USAGE_WINDOW_DAYS (1 on the Marketplace listing) and
 * reports that number as the USAGE_DIMENSION ("agent_days": one unit per agent
 * per active day). Marketplace bills the customer from that report; nothing
 * else in the product depends on it.
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
const LICENSE_ARN = process.env.LICENSE_ARN || '';               // SaaS listings: the buyer's LicenseArn from ResolveCustomer
const CUSTOMER_ACCOUNT_ID = process.env.CUSTOMER_ACCOUNT_ID || ''; // SaaS listings: the buyer's CustomerAWSAccountId
const DIMENSION = process.env.USAGE_DIMENSION || 'agent_days';
const WINDOW_DAYS = +(process.env.USAGE_WINDOW_DAYS || 1);

let mm;
function metering() {
  if (mm) return mm;
  const { MarketplaceMeteringClient, MeterUsageCommand, BatchMeterUsageCommand } = require('@aws-sdk/client-marketplace-metering');
  mm = { client: new MarketplaceMeteringClient({ region: 'us-east-1' }), MeterUsageCommand, BatchMeterUsageCommand };   // metering endpoint is us-east-1 for SaaS
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
  let recordId;
  if (LICENSE_ARN) {
    // SaaS product (concurrent-agreements integration): bill the license the buyer registered with. No ProductCode when
    // LicenseArn is present. Marketplace keeps the first record per license, dimension and hour; a duplicate is not an error.
    const r = await m.client.send(new m.BatchMeterUsageCommand({
      UsageRecords: [{ Timestamp: new Date(now), CustomerAWSAccountId: CUSTOMER_ACCOUNT_ID, LicenseArn: LICENSE_ARN, Dimension: DIMENSION, Quantity: count }] }));
    const res = (r.Results || [])[0], bad = (r.UnprocessedRecords || [])[0];
    if (bad) throw new Error('Marketplace did not accept the usage record');
    if (res && res.Status && res.Status !== 'Success' && res.Status !== 'DuplicateRecord') throw new Error('Marketplace usage record status ' + res.Status);
    recordId = res && res.MeteringRecordId;
  } else {
    // AMI/container product: the running instance reports for itself.
    const r = await m.client.send(new m.MeterUsageCommand({ ProductCode: PRODUCT_CODE, Timestamp: new Date(now), UsageDimension: DIMENSION, UsageQuantity: count, DryRun: false }));
    recordId = r.MeteringRecordId;
  }
  await s.putMeter(day, { count, reported: true, meteringRecordId: recordId, mode: LICENSE_ARN ? 'saas' : 'ami', at: new Date(now).toISOString() });
  return { reported: true, day, count, meteringRecordId: recordId, mode: LICENSE_ARN ? 'saas' : 'ami' };
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
