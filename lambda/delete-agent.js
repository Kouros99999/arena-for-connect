// Removes everything Arena holds about one agent, straight from DynamoDB with admin credentials.
// For a data-subject request when no supervisor session is at hand; the API offers the same as DELETE /agents/{arn}.
//
//   node lambda/delete-agent.js <stack name> --agent <agent ARN> [--region us-east-1] [--dry-run]
//
// Deletes: the agent's partition (live, day, week, ledger, dedupe markers), their reward requests and
// kudos addressed to them on the team feed. Does not touch the Cognito user; remove that with
// `aws cognito-idp admin-delete-user` if the person is leaving.
'use strict';
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const stack = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const arn = opt('agent'), region = opt('region', process.env.AWS_REGION || 'us-east-1'), dry = args.includes('--dry-run');
if (!stack || !arn) { console.error('usage: node lambda/delete-agent.js <stack> --agent <agent ARN> [--region R] [--dry-run]'); process.exit(1); }

const aws = (...a) => execFileSync('aws', [...a, '--region', region, '--output', 'json'], { encoding: 'utf8' }).trim();
const j = (s) => (s ? JSON.parse(s) : null);
const outputs = j(aws('cloudformation', 'describe-stacks', '--stack-name', stack, '--query', 'Stacks[0].Outputs'));
const table = (outputs.find((o) => o.OutputKey === 'TableName') || {}).OutputValue;
if (!table) { console.error('stack has no TableName output'); process.exit(1); }

const q = (pk, extra) => j(aws('dynamodb', 'query', '--table-name', table, '--key-condition-expression', 'pk = :pk' + (extra ? ' AND begins_with(sk, :p)' : ''),
  '--expression-attribute-values', JSON.stringify(Object.assign({ ':pk': { S: pk } }, extra ? { ':p': { S: extra } } : {})), '--projection-expression', 'pk, sk, agentId, #to', '--expression-attribute-names', '{"#to":"to"}')).Items || [];

const keys = q('AGENT#' + arn).map((i) => ({ pk: i.pk.S, sk: i.sk.S }));
const live = q('AGENT#' + arn, 'LIVE');
const team = live.length && j(aws('dynamodb', 'get-item', '--table-name', table, '--key', JSON.stringify({ pk: { S: 'AGENT#' + arn }, sk: { S: 'LIVE' } }), '--projection-expression', 'team')).Item;
const teamName = team && team.team && team.team.S;
if (teamName) {
  for (const i of q('TEAMITEMS#' + teamName, 'RW#')) if (i.agentId && i.agentId.S === arn) keys.push({ pk: i.pk.S, sk: i.sk.S });
  for (const i of q('TEAMITEMS#' + teamName, 'KD#')) if (i.to && i.to.S === arn) keys.push({ pk: i.pk.S, sk: i.sk.S });
}
console.log(`${keys.length} rows for ${arn}${teamName ? ' (team ' + teamName + ')' : ''}`);
keys.forEach((k) => console.log('  ' + k.sk));
if (dry) { console.log('dry run: nothing deleted'); process.exit(0); }
for (let i = 0; i < keys.length; i += 25) {
  const chunk = keys.slice(i, i + 25);
  aws('dynamodb', 'batch-write-item', '--request-items', JSON.stringify({ [table]: chunk.map((k) => ({ DeleteRequest: { Key: { pk: { S: k.pk }, sk: { S: k.sk } } } })) }));
}
console.log(`deleted ${keys.length} rows at ${new Date().toISOString()}`);
