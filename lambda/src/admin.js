/*
 * People administration for the supervisor console: Cognito users in the stack's own user pool.
 *
 * Only meaningful when AuthMode=cognito (USER_POOL_ID set). With an external identity provider the console
 * says so and the routes answer 409. Every call is supervisors-only at the API layer.
 *
 * A person is: username, name, email (optional), role (agent | supervisor), team and, for agents, the Connect
 * agent ARN that ties their sign-in to their points. Creating a person with an email lets Cognito send the
 * temporary password; without one, the temporary password is returned once to the supervisor who created them.
 */
'use strict';

const POOL = process.env.USER_POOL_ID || '';

let cg;
function cognito() {
  if (cg) return cg;
  const sdk = require('@aws-sdk/client-cognito-identity-provider');
  cg = { client: new sdk.CognitoIdentityProviderClient({}), sdk };
  return cg;
}

const ROLES = ['agent', 'supervisor'];
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/** Pure: validate what a supervisor sent. Throws with a message a person can act on. */
function validate(b, forCreate) {
  const out = {};
  if (forCreate) {
    out.username = clean(b.username, 128).toLowerCase();
    if (!/^[a-z0-9._@+-]{2,128}$/.test(out.username)) throw new Error('username: letters, numbers, dots, underscores, @, + and hyphens only');
  }
  if (b.name !== undefined || forCreate) { out.name = clean(b.name, 100); if (!out.name) throw new Error('a display name is required'); }
  if (b.email !== undefined) { out.email = clean(b.email, 254).toLowerCase(); if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new Error('email does not look like an address'); }
  if (b.role !== undefined || forCreate) { out.role = clean(b.role || 'agent', 20).toLowerCase(); if (!ROLES.includes(out.role)) throw new Error('role must be agent or supervisor'); }
  if (b.team !== undefined || forCreate) out.team = clean(b.team, 120);
  if (b.agentArn !== undefined || forCreate) { out.agentArn = clean(b.agentArn, 300); if (out.agentArn && !/^arn:aws:connect:/.test(out.agentArn)) throw new Error('agentArn must be a Connect agent ARN'); }
  if (forCreate && out.role === 'agent' && !out.agentArn) throw new Error('an agent needs the Connect agent ARN so their points find them');
  return out;
}

/** Pure: a Cognito user record -> the shape the console shows. */
function toPerson(u, groups) {
  const attr = {}; for (const a of u.Attributes || u.UserAttributes || []) attr[a.Name] = a.Value;
  return { username: u.Username, name: attr.name || '', email: attr.email || '', team: attr['custom:team'] || '', agentArn: attr['custom:agentArn'] || '',
    role: (groups || []).includes('supervisors') ? 'supervisor' : 'agent', status: u.UserStatus, enabled: u.Enabled !== false, createdAt: u.UserCreateDate ? new Date(u.UserCreateDate).toISOString() : undefined };
}

/** A temporary password that satisfies the pool policy (12+, upper, lower, digit). Shown once. */
function tempPassword() {
  const rnd = require('crypto').randomBytes(12).toString('base64url').replace(/[-_]/g, 'x');
  return 'Ar' + rnd.slice(0, 8) + '7k' + rnd.slice(8, 12).toLowerCase() + 'Q';
}

const attrs = (p) => [['name', p.name], ['email', p.email], ['custom:team', p.team], ['custom:agentArn', p.agentArn]].filter(([, v]) => v !== undefined).map(([Name, Value]) => ({ Name, Value: Value || '' }));

function makeAdmin(deps) {
  deps = deps || {};
  const pool = deps.pool || POOL;
  const c = () => deps.cognito || cognito();
  const send = async (name, input) => { const { client, sdk } = c(); return client.send(new sdk[name](Object.assign({ UserPoolId: pool }, input))); };
  const ready = () => !!pool;

  async function list() {
    const sups = new Set(); let token;
    do { const r = await send('ListUsersInGroupCommand', { GroupName: 'supervisors', Limit: 60, NextToken: token }); (r.Users || []).forEach((u) => sups.add(u.Username)); token = r.NextToken; } while (token);
    const out = []; let pt;
    do { const r = await send('ListUsersCommand', { Limit: 60, PaginationToken: pt }); (r.Users || []).forEach((u) => out.push(toPerson(u, sups.has(u.Username) ? ['supervisors'] : []))); pt = r.PaginationToken; } while (pt);
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.username.localeCompare(b.username));
  }
  async function create(b) {
    const p = validate(b, true);
    const temp = p.email ? undefined : tempPassword();
    await send('AdminCreateUserCommand', { Username: p.username, UserAttributes: attrs(p).concat(p.email ? [{ Name: 'email_verified', Value: 'true' }] : []), TemporaryPassword: temp, DesiredDeliveryMediums: p.email ? ['EMAIL'] : undefined, MessageAction: p.email ? undefined : 'SUPPRESS' });
    await send('AdminAddUserToGroupCommand', { Username: p.username, GroupName: p.role === 'supervisor' ? 'supervisors' : 'agents' });
    return { person: Object.assign({ username: p.username, status: 'FORCE_CHANGE_PASSWORD', enabled: true }, p), temporaryPassword: temp, invited: !!p.email };
  }
  async function update(username, b) {
    const p = validate(b, false);
    const a = attrs(p);
    if (a.length) await send('AdminUpdateUserAttributesCommand', { Username: username, UserAttributes: a });
    if (p.role) {
      await send('AdminAddUserToGroupCommand', { Username: username, GroupName: p.role === 'supervisor' ? 'supervisors' : 'agents' });
      await send('AdminRemoveUserFromGroupCommand', { Username: username, GroupName: p.role === 'supervisor' ? 'agents' : 'supervisors' }).catch(() => {});
    }
    const u = await send('AdminGetUserCommand', { Username: username });
    const g = await send('AdminListGroupsForUserCommand', { Username: username });
    return toPerson(u, (g.Groups || []).map((x) => x.GroupName));
  }
  async function resetPassword(username) {
    const temp = tempPassword();
    await send('AdminSetUserPasswordCommand', { Username: username, Password: temp, Permanent: false });
    return { username, temporaryPassword: temp };
  }
  async function remove(username) { await send('AdminDeleteUserCommand', { Username: username }); return { username, deleted: true }; }

  return { ready, list, create, update, resetPassword, remove };
}

module.exports = { makeAdmin, validate, toPerson, tempPassword, ROLES };
