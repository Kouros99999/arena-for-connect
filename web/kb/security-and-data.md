# Security and your data

## Where data lives

Everything Arena records about your agents is stored in your own AWS account, in the region where you launched the stack: a DynamoDB table, an S3 bucket for the pages, and a Cognito user pool. EKPK, the company that makes Arena, has no access to any of it.

What Arena stores:

- Agent identifiers, names and routing profile from Connect agent events.
- Status changes and handled-contact details such as queue, channel and handle time.
- Evaluation scores, customer sentiment and survey scores, if you enable those feeds.
- Points, streaks, badges, challenges, rewards, kudos and coaching plans.

What Arena never reads: call recordings, transcripts, or the content of customer conversations. Contact Lens analysis files are read for their sentiment score only.

## What leaves your account

One number a day: the count of agents with scored activity, reported to AWS Marketplace for billing. No names or identifiers travel with it.

## Encryption and backups

Data is encrypted at rest and in transit by the AWS services involved. The Kinesis stream uses AWS-managed keys. The DynamoDB table keeps 35 days of point-in-time backups. The points ledger expires after 90 days; daily totals are kept so the report has history.

## Access

- Every API call needs a signed-in user. There is no open mode.
- Supervisors may read and act on any team. Agents see only their own team and their own points feed, and only the agreed action of their own coaching plans.
- Wallboard keys are read-only, scoped to one team, and can be revoked.
- Each function in the stack runs with a role scoped to what it needs.

## Deleting an agent's data

To remove everything Arena holds about one person, either call the API as a supervisor:

```
DELETE <ApiUrl>/agents/<agent ARN>
```

or run the admin script with your AWS credentials:

```bash
node lambda/delete-agent.js <stack name> --agent <agent ARN> --dry-run
node lambda/delete-agent.js <stack name> --agent <agent ARN>
```

It removes the agent's rows, their reward requests, their coaching plans and kudos addressed to them, and logs an audit line. Their Cognito user is separate; delete it in the Cognito console.

## Deleting everything

Delete the CloudFormation stack. Every resource it created goes with it.
