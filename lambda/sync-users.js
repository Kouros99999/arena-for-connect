// Creates one Cognito user per Amazon Connect agent, carrying the agent ARN and routing profile as custom attributes.
// Idempotent: existing users are updated, not duplicated. Supervisors are anyone whose Connect security profile
// name contains "supervisor" or "admin"; everyone else lands in the agents group.
//
// Usage: node lambda/sync-users.js <stack name> --instance <connect instance id> [--region us-east-1] [--dry-run]
// Needs the AWS CLI on PATH. New users get a temporary password by email (Cognito sends it), so email must be set on the Connect user.
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const stack = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const instance = opt('instance'), region = opt('region', process.env.AWS_REGION || 'us-east-1'), dry = args.includes('--dry-run');
// --no-email: create users without an email address and without sending anything. An admin then sets
// each password with `aws cognito-idp admin-set-user-password --permanent`. For pilots and test instances.
const noEmail = args.includes('--no-email');
if (!stack || !instance) { console.error('usage: node lambda/sync-users.js <stack> --instance <connect instance id> [--region R] [--dry-run]'); process.exit(1); }

const aws = (...a) => execFileSync('aws', [...a, '--region', region, '--output', 'json'], { encoding: 'utf8' }).trim();
const j = (s) => (s ? JSON.parse(s) : null);
const outputs = j(aws('cloudformation', 'describe-stacks', '--stack-name', stack, '--query', 'Stacks[0].Outputs'));
const poolId = (outputs.find((o) => o.OutputKey === 'UserPoolId') || {}).OutputValue;
if (!poolId) { console.error('stack has no UserPoolId output (AuthMode is not cognito?)'); process.exit(1); }

const profiles = Object.fromEntries(j(aws('connect', 'list-routing-profiles', '--instance-id', instance, '--query', 'RoutingProfileSummaryList')).map((p) => [p.Id, p.Name]));
const security = Object.fromEntries(j(aws('connect', 'list-security-profiles', '--instance-id', instance, '--query', 'SecurityProfileSummaryList')).map((p) => [p.Id, p.Name]));
const users = j(aws('connect', 'list-users', '--instance-id', instance, '--query', 'UserSummaryList'));
console.log(`${users.length} Connect users, ${Object.keys(profiles).length} routing profiles`);

let created = 0, updated = 0, skipped = 0;
for (const u of users) {
  const d = j(aws('connect', 'describe-user', '--instance-id', instance, '--user-id', u.Id, '--query', 'User'));
  const email = d.IdentityInfo && d.IdentityInfo.Email;
  const name = [d.IdentityInfo && d.IdentityInfo.FirstName, d.IdentityInfo && d.IdentityInfo.LastName].filter(Boolean).join(' ') || d.Username;
  const team = profiles[d.RoutingProfileId] || 'unassigned';
  const isSup = (d.SecurityProfileIds || []).some((id) => /supervisor|admin/i.test(security[id] || ''));
  const attrs = [`Name=custom:agentArn,Value=${d.Arn}`, `Name=custom:team,Value=${team}`, `Name=name,Value=${name}`];
  if (email) attrs.push(`Name=email,Value=${email}`, 'Name=email_verified,Value=true');
  const line = `${d.Username.padEnd(24)} ${team.padEnd(20)} ${isSup ? 'supervisor' : 'agent'}${email ? '' : '  (no email: cannot receive a temporary password)'}`;
  if (dry) { console.log('would sync', line); continue; }
  let exists = true;
  try { execFileSync('aws', ['cognito-idp', 'admin-get-user', '--user-pool-id', poolId, '--username', d.Username, '--region', region], { stdio: 'ignore' }); } catch { exists = false; }
  if (exists) { aws('cognito-idp', 'admin-update-user-attributes', '--user-pool-id', poolId, '--username', d.Username, '--user-attributes', ...attrs); updated++; }
  else if (!email && !noEmail) { skipped++; console.log('skipped', line); continue; }
  else if (!email) { aws('cognito-idp', 'admin-create-user', '--user-pool-id', poolId, '--username', d.Username, '--user-attributes', ...attrs, '--message-action', 'SUPPRESS'); created++; }
  else { aws('cognito-idp', 'admin-create-user', '--user-pool-id', poolId, '--username', d.Username, '--user-attributes', ...attrs, '--desired-delivery-mediums', 'EMAIL'); created++; }
  for (const [group, on] of [['supervisors', isSup], ['agents', !isSup]]) {
    try { aws('cognito-idp', on ? 'admin-add-user-to-group' : 'admin-remove-user-from-group', '--user-pool-id', poolId, '--username', d.Username, '--group-name', group); } catch {}
  }
  console.log(exists ? 'updated' : 'created', line);
}
if (!dry) console.log(`\ncreated ${created}, updated ${updated}, skipped ${skipped}`);
