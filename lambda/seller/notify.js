/*
 * AWS Marketplace SaaS subscription notifications. Runs in the SELLER account.
 *
 * Marketplace publishes to an SNS topic it owns (one per product) when a buyer subscribes, is
 * about to be unsubscribed, or has been unsubscribed, and when entitlements change. This records
 * each event against the customer so support can see subscription state, and so a future job can
 * disable metering for churned customers.
 */
'use strict';
const TABLE = process.env.CUSTOMERS_TABLE || '';

let clients;
function real() {
  if (clients) return clients;
  const ddb = require('@aws-sdk/client-dynamodb'), lib = require('@aws-sdk/lib-dynamodb');
  clients = { ddb: lib.DynamoDBDocumentClient.from(new ddb.DynamoDBClient({})), UpdateCommand: lib.UpdateCommand };
  return clients;
}

/** Pure: turn one SNS record into the fields to store. */
function parseRecord(rec) {
  let msg;
  try { msg = JSON.parse(rec.Sns && rec.Sns.Message || '{}'); } catch { return null; }
  const action = msg.action || msg['action'];
  const customerId = msg['customer-identifier'];
  if (!customerId || !action) return null;
  return { customerId, action, productCode: msg['product-code'], offerId: msg['offer-identifier'], at: rec.Sns.Timestamp || new Date().toISOString(), free: msg['isFreeTrialTermPresent'] };
}

exports.handler = async (event, context, deps) => {
  const c = (deps && deps.clients) || real();
  const seen = [];
  for (const rec of event.Records || []) {
    const r = parseRecord(rec);
    if (!r) continue;
    seen.push(r);
    if (TABLE) await c.ddb.send(new c.UpdateCommand({ TableName: TABLE, Key: { customerId: r.customerId },
      UpdateExpression: 'SET lastAction = :a, lastActionAt = :t, productCode = if_not_exists(productCode, :p), subscriptionState = :s',
      ExpressionAttributeValues: { ':a': r.action, ':t': r.at, ':p': r.productCode || 'unknown', ':s': r.action === 'unsubscribe-success' ? 'unsubscribed' : r.action === 'unsubscribe-pending' ? 'unsubscribing' : 'subscribed' } }));
    console.log(JSON.stringify({ notification: r.action, customer: r.customerId }));
  }
  return { handled: seen.length };
};

exports.parseRecord = parseRecord;
