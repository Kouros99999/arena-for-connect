# Users and sign-in

Arena has its own sign-in because the pages talk to an API, and the API must know who is asking. By default the stack creates an Amazon Cognito user pool in your account. You can use your own identity provider instead.

## Groups

- **supervisors** can use the console, the report and every team.
- **agents** see their own team's pages and their own points feed.

Each user carries two attributes: the Connect agent ARN and the routing profile name. The panel uses them to open on the right agent and team with no setup by the agent.

## Creating users from Connect

The sync script in the deployment package reads your Connect directory and creates matching users:

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
