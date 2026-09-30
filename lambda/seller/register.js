/*
 * AWS Marketplace SaaS registration (fulfillment) endpoint for Arena. Runs in the SELLER account.
 *
 * Flow: a buyer subscribes on the Marketplace listing, Marketplace redirects their browser here with a
 * POST carrying x-amzn-marketplace-token. We resolve the token to their LicenseArn, AWS account ID and
 * product code (the concurrent-agreements integration required for SaaS products created after June 2026),
 * record the license, and show a page with a one-click CloudFormation launch link that carries those values
 * as parameters, so the stack they deploy meters against their own license.
 *
 *   POST /register          form-encoded x-amzn-marketplace-token  -> registration page
 *   GET  /register          plain landing page (no token): explains how to subscribe
 *   GET  /health
 */
'use strict';
const querystring = require('querystring');

const RELEASE_BASE = process.env.RELEASE_BASE || '';         // https://<bucket>.s3.<region>.amazonaws.com/arena/<version>
const REGION = process.env.LAUNCH_REGION || 'us-east-1';
const TABLE = process.env.CUSTOMERS_TABLE || '';
const SUPPORT = process.env.SUPPORT_EMAIL || '';

let clients;
function real() {
  if (clients) return clients;
  const mm = require('@aws-sdk/client-marketplace-metering');
  const ddb = require('@aws-sdk/client-dynamodb'), lib = require('@aws-sdk/lib-dynamodb');
  clients = { metering: new mm.MarketplaceMeteringClient({ region: 'us-east-1' }), ResolveCustomerCommand: mm.ResolveCustomerCommand,
    ddb: lib.DynamoDBDocumentClient.from(new ddb.DynamoDBClient({})), PutCommand: lib.PutCommand, UpdateCommand: lib.UpdateCommand };
  return clients;
}

/** Pure: the CloudFormation quick-create URL for this customer. */
function launchUrl(licenseArn, accountId, productCode, opts) {
  opts = opts || {};
  const base = opts.releaseBase || RELEASE_BASE, region = opts.region || REGION;
  const q = new URLSearchParams({ templateURL: base + '/template.yaml', stackName: 'arena', param_MarketplaceLicenseArn: licenseArn, param_MarketplaceCustomerAccountId: accountId, param_MarketplaceProductCode: productCode, param_SiteArchiveUrl: base + '/site.zip' });
  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create/review?${q}`;
}

/** Pure: pull the Marketplace token out of a form POST body, base64 or not. */
function tokenFrom(event) {
  const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : (event.body || '');
  const form = querystring.parse(body);
  return (form['x-amzn-marketplace-token'] || '').toString().trim() || null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.2rem;line-height:1.55;color:#15181e}h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:2rem}.btn{display:inline-block;background:#0f766e;color:#fff;padding:.7rem 1.2rem;border-radius:6px;text-decoration:none;font-weight:600}.muted{color:#6b7280;font-size:.95rem}code{background:#f1f3f5;padding:.1rem .35rem;border-radius:3px}ol li{margin:.4rem 0}.warn{background:#fff7e6;border-left:3px solid #b7791f;padding:.6rem .9rem}</style>
${body}`;

function registeredPage(c) {
  return page('Arena: launch your deployment', `
<h1>Thanks for subscribing to Arena for Amazon Connect</h1>
<p>Your subscription is active for AWS account <code>${esc(c.CustomerAWSAccountId)}</code>. Arena runs entirely inside your own account; nothing about your agents leaves it.</p>
<p><a class="btn" href="${esc(c.launch)}">Launch Arena in CloudFormation</a></p>
<p class="muted">Opens the CloudFormation console in ${esc(c.region)} with the template and your subscription pre-filled. Keep this page: the link stays valid for your subscription.</p>
<h2>What happens next</h2>
<ol>
<li><b>Deploy.</b> Review the parameters (your license and account are pre-filled), tick the IAM acknowledgement, and create the stack. About ten minutes, most of it CloudFront.</li>
<li><b>Point Amazon Connect at Arena.</b> In the Connect console, under Data streaming, set the agent event stream to the <code>StreamArn</code> the stack outputs.</li>
<li><b>Add the panel to the agent workspace.</b> Register <code>&lt;SiteUrl&gt;/agent-panel.html</code> as a third-party application and grant it on your agents' security profiles.</li>
<li><b>Create sign-ins.</b> Add your agents and supervisors to the Cognito user pool the stack created (the <code>UserPoolId</code> output), with the <code>custom:agentArn</code> and <code>custom:team</code> attributes. The <code>sync-users</code> script in the docs does this from your Connect directory in one command.</li>
</ol>
<div class="warn">Billing is per active agent-day, reported nightly from your stack against this subscription. Nothing is billed until agents produce activity.</div>
<h2>Need help?</h2>
<p>Documentation and scripts: <a href="https://github.com/Kouros99999/arena-for-connect">github.com/Kouros99999/arena-for-connect</a>${SUPPORT ? ` · Support: <a href="mailto:${esc(SUPPORT)}">${esc(SUPPORT)}</a>` : ''}</p>`);
}

function landingPage() {
  return page('Arena for Amazon Connect', `
<h1>Arena for Amazon Connect</h1>
<p>This page completes an AWS Marketplace subscription. To get here with a valid subscription, subscribe to Arena on AWS Marketplace and choose <b>Set up your account</b>; Marketplace will bring you back with your subscription attached.</p>
<p class="muted">Already subscribed? Open the Marketplace subscription page for Arena and use the setup link there.</p>`);
}

function html(status, body) { return { statusCode: status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body }; }

exports.handler = async (event, context, deps) => {
  const c = (deps && deps.clients) || real();
  const now = (deps && deps.now) ? deps.now() : new Date();
  const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || 'GET';
  const path = event.rawPath || '/';
  if (path === '/health') return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  if (method !== 'POST') return html(200, landingPage());
  const token = tokenFrom(event);
  if (!token) return html(400, page('Missing subscription token', '<h1>Missing subscription token</h1><p>This page must be reached from the AWS Marketplace subscription flow.</p>'));
  let resolved;
  try { resolved = await c.metering.send(new c.ResolveCustomerCommand({ RegistrationToken: token })); }
  catch (err) { console.error('resolve failed', err.name); return html(400, page('Subscription could not be verified', '<h1>Subscription could not be verified</h1><p>The link may have expired. Return to AWS Marketplace and choose Set up your account again.</p>')); }
  if (!resolved.LicenseArn) { console.error('resolve returned no LicenseArn'); return html(400, page('Subscription could not be verified', '<h1>Subscription could not be verified</h1><p>Return to AWS Marketplace and choose Set up your account again.</p>')); }
  const customer = { LicenseArn: resolved.LicenseArn, ProductCode: resolved.ProductCode, CustomerAWSAccountId: resolved.CustomerAWSAccountId, CustomerIdentifier: resolved.CustomerIdentifier };
  const launch = launchUrl(customer.LicenseArn, customer.CustomerAWSAccountId, customer.ProductCode);
  if (TABLE) await c.ddb.send(new c.UpdateCommand({ TableName: TABLE, Key: { licenseArn: customer.LicenseArn },
    UpdateExpression: 'SET productCode = :p, awsAccountId = :a, legacyCustomerId = :c, registeredAt = if_not_exists(registeredAt, :t), lastSeenAt = :t, launchUrl = :l',
    ExpressionAttributeValues: { ':p': customer.ProductCode, ':a': customer.CustomerAWSAccountId, ':c': customer.CustomerIdentifier || '', ':t': now.toISOString(), ':l': launch } }));
  console.log(JSON.stringify({ registered: customer.LicenseArn, account: customer.CustomerAWSAccountId }));
  return html(200, registeredPage(Object.assign({ launch, region: REGION }, customer)));
};

exports.launchUrl = launchUrl;
exports.tokenFrom = tokenFrom;
