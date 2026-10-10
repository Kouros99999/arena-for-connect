const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeAdmin, validate, toPerson, tempPassword } = require('./admin.js');

function fakeCognito(state) {
  const sdk = {}; const names = ['ListUsersInGroupCommand', 'ListUsersCommand', 'AdminCreateUserCommand', 'AdminAddUserToGroupCommand', 'AdminRemoveUserFromGroupCommand', 'AdminUpdateUserAttributesCommand', 'AdminGetUserCommand', 'AdminListGroupsForUserCommand', 'AdminSetUserPasswordCommand', 'AdminDeleteUserCommand'];
  for (const n of names) sdk[n] = function (input) { this.kind = n; this.input = input; };
  const calls = [];
  const client = { send: async (c) => { calls.push([c.kind, c.input]);
    switch (c.kind) {
      case 'ListUsersInGroupCommand': return { Users: state.users.filter((u) => u.sup).map((u) => ({ Username: u.Username })) };
      case 'ListUsersCommand': return { Users: state.users };
      case 'AdminCreateUserCommand': if (state.users.some((u) => u.Username === c.input.Username)) { const e = new Error('exists'); e.name = 'UsernameExistsException'; throw e; } state.users.push({ Username: c.input.Username, Attributes: c.input.UserAttributes, UserStatus: 'FORCE_CHANGE_PASSWORD', Enabled: true }); return {};
      case 'AdminAddUserToGroupCommand': { const u = state.users.find((x) => x.Username === c.input.Username); if (u) u.sup = c.input.GroupName === 'supervisors'; return {}; }
      case 'AdminGetUserCommand': { const u = state.users.find((x) => x.Username === c.input.Username); if (!u) { const e = new Error('nf'); e.name = 'UserNotFoundException'; throw e; } return { Username: u.Username, UserAttributes: u.Attributes, UserStatus: u.UserStatus, Enabled: u.Enabled }; }
      case 'AdminListGroupsForUserCommand': { const u = state.users.find((x) => x.Username === c.input.Username); return { Groups: u && u.sup ? [{ GroupName: 'supervisors' }] : [{ GroupName: 'agents' }] }; }
      case 'AdminUpdateUserAttributesCommand': { const u = state.users.find((x) => x.Username === c.input.Username); for (const a of c.input.UserAttributes) { const i = u.Attributes.findIndex((x) => x.Name === a.Name); if (i >= 0) u.Attributes[i] = a; else u.Attributes.push(a); } return {}; }
      case 'AdminDeleteUserCommand': state.users = state.users.filter((x) => x.Username !== c.input.Username); return {};
      default: return {};
    } } };
  return { client, sdk, calls };
}

test('validation catches what a supervisor could get wrong', () => {
  assert.throws(() => validate({ username: 'x y', name: 'X' }, true), /username/);
  assert.throws(() => validate({ username: 'priya', name: '' }, true), /display name/);
  assert.throws(() => validate({ username: 'priya', name: 'P', email: 'nope' }, true), /email/);
  assert.throws(() => validate({ username: 'priya', name: 'P', role: 'boss' }, true), /role/);
  assert.throws(() => validate({ username: 'priya', name: 'P', role: 'agent' }, true), /agent ARN/);
  assert.deepEqual(validate({ username: 'Priya.N', name: ' Priya ', role: 'supervisor', team: 'Billing' }, true), { username: 'priya.n', name: 'Priya', email: undefined, role: 'supervisor', team: 'Billing', agentArn: '' }.email === undefined ? { username: 'priya.n', name: 'Priya', role: 'supervisor', team: 'Billing', agentArn: '' } : null);
  assert.deepEqual(validate({ role: 'supervisor' }, false), { role: 'supervisor' });
  assert.match(tempPassword(), /^[A-Za-z0-9]{17}$/); assert.match(tempPassword(), /[A-Z]/); assert.match(tempPassword(), /[0-9]/); assert.match(tempPassword(), /[a-z]/);
  assert.equal(toPerson({ Username: 'p', Attributes: [{ Name: 'name', Value: 'Priya' }, { Name: 'custom:team', Value: 'B' }], UserStatus: 'CONFIRMED' }, ['supervisors']).role, 'supervisor');
});

test('people: list, invite with or without email, change role, reset, remove', async () => {
  const state = { users: [{ Username: 'dana', Attributes: [{ Name: 'name', Value: 'Dana' }], sup: true, UserStatus: 'CONFIRMED', Enabled: true }] };
  const cg = fakeCognito(state); const admin = makeAdmin({ pool: 'pool-1', cognito: cg });
  assert.equal(admin.ready(), true); assert.equal(makeAdmin({ pool: '', cognito: cg }).ready(), false);
  let people = await admin.list(); assert.equal(people.length, 1); assert.equal(people[0].role, 'supervisor');
  const made = await admin.create({ username: 'priya', name: 'Priya N', role: 'agent', team: 'Billing', agentArn: 'arn:aws:connect:us-east-1:1:instance/i/agent/p1' });
  assert.match(made.temporaryPassword, /^[A-Za-z0-9]{17}$/); assert.equal(made.invited, false);
  const createCall = cg.calls.find((c) => c[0] === 'AdminCreateUserCommand')[1];
  assert.equal(createCall.MessageAction, 'SUPPRESS'); assert.equal(createCall.UserPoolId, 'pool-1'); assert.ok(createCall.UserAttributes.some((a) => a.Name === 'custom:agentArn'));
  const invited = await admin.create({ username: 'marcus', name: 'Marcus', email: 'M@Example.com', role: 'supervisor' });
  assert.equal(invited.invited, true); assert.equal(invited.temporaryPassword, undefined);
  const inviteCall = cg.calls.filter((c) => c[0] === 'AdminCreateUserCommand')[1][1];
  assert.deepEqual(inviteCall.DesiredDeliveryMediums, ['EMAIL']); assert.ok(inviteCall.UserAttributes.some((a) => a.Name === 'email' && a.Value === 'm@example.com'));
  people = await admin.list(); assert.deepEqual(people.map((p) => p.username + ':' + p.role).sort(), ['dana:supervisor', 'marcus:supervisor', 'priya:agent']);
  const changed = await admin.update('priya', { role: 'supervisor', team: 'Escalations' });
  assert.equal(changed.role, 'supervisor'); assert.equal(changed.team, 'Escalations');
  assert.equal(cg.calls.filter((c) => c[0] === 'AdminRemoveUserFromGroupCommand' && c[1].GroupName === 'agents').length, 1);
  const reset = await admin.resetPassword('priya'); assert.equal(reset.username, 'priya'); assert.match(reset.temporaryPassword, /^[A-Za-z0-9]{17}$/);
  assert.equal(cg.calls.find((c) => c[0] === 'AdminSetUserPasswordCommand')[1].Permanent, false);
  assert.deepEqual(await admin.remove('marcus'), { username: 'marcus', deleted: true });
  assert.equal((await admin.list()).length, 2);
  await assert.rejects(() => admin.create({ username: 'priya', name: 'Again', role: 'supervisor' }), (e) => e.name === 'UsernameExistsException');
});
