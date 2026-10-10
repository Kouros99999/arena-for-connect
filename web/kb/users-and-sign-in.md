# Users and sign-in

Arena has its own sign-in because the pages talk to an API, and the API must know who is asking. By default the stack creates an Amazon Cognito user pool in your account. You can use your own identity provider instead.

## Groups

- **supervisors** can use the console, the report and every team.
- **agents** see their own team's pages and their own points feed.

Each user carries two attributes: the Connect agent ARN and the routing profile name. The panel uses them to open on the right agent and team with no setup by the agent.

## People, from the console

Supervisors manage sign-ins from the **People** button at the top of the console, with no command line:

- The list shows everyone in the stack's user pool with their role, team, Connect agent and status. Change a role from the dropdown on the row.
- **Add a person**: pick the Connect agent from the list (the name, username and team fill in), choose agent or supervisor, and add an email if they have one. With an email, Cognito sends the invitation and temporary password. Without one, the console shows a temporary password once; pass it on and they set their own at first sign-in.
- **Reset password** shows a new temporary password once.
- **Remove** deletes the sign-in. Their points and history stay; see [security and your data](kb.html?a=security-and-data) to remove those too.

Every action is written to the API log with who did it. With an external identity provider (`AuthMode` external) the button says so and people are managed in your provider instead.

## Creating users from Connect in bulk

The sync script in the deployment package reads your Connect directory and creates matching users, which suits the first day on a large instance:

```bash
node lambda/sync-users.js <stack name> --instance <connect instance id> --dry-run
node lambda/sync-users.js <stack name> --instance <connect instance id>
```

Users whose Connect security profile name contains "supervisor" or "admin" become supervisors. New users get an invitation email with a temporary password. For instances whose agents have no email address, add `--no-email` and share temporary passwords another way.

Run the script again whenever people join or move teams. It only adds and updates; it never deletes.

## Using your own identity provider

Two options:

- **Federate the pool.** Add your provider as a federated identity provider on the Cognito user pool. Users then sign in with your provider and still get Arena's groups and attributes.
- **Replace the pool.** Launch the stack with `AuthMode` set to `external`, and set `JwtIssuer` and `JwtAudience` to your provider's values. Your provider must then issue the `custom:team` and `custom:agentArn` claims, and group membership as `cognito:groups` or `groups` containing `supervisors` for supervisors. Agents whose tokens lack a team are refused on team pages.

## Removing someone

Delete their Cognito user to stop sign-in. To remove their Arena data as well, see [security and your data](kb.html?a=security-and-data).
