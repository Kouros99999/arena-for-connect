# Security and your data

This article is written for the people who review software before a contact centre may use it: security, privacy and procurement teams. It describes what Arena is made of, where data lives, who can reach it, and how to remove it. Everything here can be verified against the CloudFormation template, which is public in the [GitHub repository](https://github.com/Kouros99999/arena-for-connect).

## The short version

- Arena is a CloudFormation stack that runs **inside your own AWS account**, in the region you choose. There is no Arena service outside your account that holds your data.
- EKPK, the company that makes Arena, **cannot reach your data**. The stack grants EKPK no role, no key and no endpoint.
- The only thing that leaves your account is **one number a day**, the count of agents with scored activity, sent to AWS Marketplace for billing. It carries no names or identifiers.
- Arena reads **agent events and scores**, never recordings, transcripts or the content of customer conversations.
- Delete the stack and everything is gone.

## Architecture

The stack creates these resources. Each is owned by your account and billed to it at normal AWS rates.

| Resource | Purpose | Notes |
|---|---|---|
| Kinesis data stream | Receives agent events from Amazon Connect | Encrypted with an AWS-managed KMS key; 24-hour retention; one shard by default |
| Lambda functions | Ingest, API, evaluations, sentiment, adherence, acknowledgements, backfill, metering, streaks, digest, site deployer | Node.js 22 on Graviton; each with its own IAM role (see below) |
| DynamoDB table | All Arena data, one table | Encrypted at rest; on-demand capacity; point-in-time recovery, 35 days |
| HTTP API (API Gateway) | The API the pages call | Every route except the wallboard's requires a JWT; TLS only |
| CloudFront distribution and private S3 bucket | Hosts the agent panel, console, wallboard and report | Bucket blocks all public access; CloudFront reaches it through an origin access identity; TLS only |
| Cognito user pool | Sign-in for agents and supervisors | Optional: you can use your own identity provider instead |
| SNS topics | Operational alarms; optional email digest | Subscriptions are confirmed by email |
| CloudWatch alarms and logs | Ingest errors, stream lag, API errors, failed usage report | Logs stay in your account |
| EventBridge schedules | The hourly and nightly jobs | |

Nothing in the stack opens a network path to EKPK or to any third party. The Lambda functions call AWS services in your account and, for Slack or Microsoft Teams, only the webhook URLs your supervisors enter.

## What Arena stores

From the Connect agent event stream: agent ARN, username, first and last name, routing profile (shown as the team), status changes, and for each handled contact the contact ID, queue, channel and handle time. Contact IDs are kept for 14 days so later analysis can be matched to the agent.

If you enable the optional feeds: evaluation scores and the title of the auto-failed question from Contact Lens evaluation files; the overall customer sentiment score from Contact Lens analysis files; survey scores from a contact attribute; adherence percentages from Connect's own metrics.

Created inside Arena: points, streaks, badges, challenges and their standings, reward requests and approvals, kudos notes written by agents (140 characters), coaching plans including a supervisor's private note, notification settings, and each agent's own preferences.

What Arena never reads: call or screen recordings, transcripts, chat text, customer names, phone numbers or any customer data. Contact Lens files are read for their score fields and nothing else; analysis files are not kept.

## What leaves your account

| Data | Where it goes | Why |
|---|---|---|
| Count of agents with scored activity, once a night | AWS Marketplace Metering Service | Billing. No identifiers. During the free trial the first 25 are subtracted first. |
| Kudos, reward and challenge notices, the daily digest | Slack or Teams webhooks you configured | Only if a supervisor turned them on, only to the URL they entered |
| Daily digest by email | The address a supervisor entered, via your own SNS topic | Only if turned on |

The registration page you used when subscribing runs in EKPK's account. It receives your AWS account ID and subscription identifier from Marketplace, keeps them so the launch link stays valid, and nothing else. It never sees anything from inside your stack.

## Who can see what

- **Sign-in is required** for every page and every API route. There is no open mode. Sign-in is through your Cognito user pool or your own identity provider (OIDC); the API validates the token on every call.
- **Supervisors** (members of the supervisors group) may read and act on every team.
- **Agents** see their own team's leaderboard, challenges and kudos feed, their own points feed and balance, and the agreed action of their own coaching plans, never a supervisor's private note or another agent's feed. An agent may hide themselves from teammates' boards and wallboards; supervisors still see them.
- **Wallboards** use a read-only key that a supervisor mints for one team, valid 90 days and revocable at any time. Names on wallboards can be shortened to first name and initial, or initials only, with the `WallboardNames` setting, since anyone walking past a screen can read it.
- **Operators** of your AWS account can read the table directly, as with any resource in the account. Use your account's usual access controls.

## Least privilege inside the stack

Each function has its own role, limited to what it does. In summary:

| Function | May do |
|---|---|
| Ingest | Read the Kinesis stream; read and write the table |
| API | Read and write the table; publish to the digest topic |
| Evaluations, sentiment | Read the one bucket and prefix you named; read and write the table |
| Acknowledgements | `connect:DescribeContactEvaluation` on your instances; read and write the table |
| Adherence, backfill | `connect:GetMetricDataV2` (backfill also `ListUsers`, `DescribeUser`, `DescribeRoutingProfile`); read and write the table |
| Metering | `aws-marketplace:BatchMeterUsage`; read and write the table |
| Streaks, digest | Read and write the table; digest also publishes to the digest topic |
| Site deployer | Write the site bucket; invalidate the distribution; set the user pool client's callback URLs |

No function has permission to create resources, change IAM, or read anything in Connect beyond the metrics and evaluation records named above.

## Encryption

In transit: every path is TLS, including CloudFront to the browser, the browser to the API, and the functions to AWS services. At rest: Kinesis (KMS, AWS-managed key), DynamoDB (AWS-owned key by default), S3 (AES-256), Cognito and CloudWatch Logs as provided by AWS. Webhook URLs for Slack and Teams are stored whole in the table and returned to the console masked.

## Retention and backups

- Per-event points ledger: 90 days (`TTL_DAYS`), then expired by DynamoDB.
- Daily and weekly totals per agent: kept, so the results report and personal bests have history.
- Pending acknowledgement rows: 45 days. Contact-to-agent markers: 14 days. Job markers: 14 days.
- Point-in-time recovery on the table: 35 days.
- Kinesis: 24 hours.
- CloudWatch Logs: your account's default retention.

## Deleting data

**One agent.** As a supervisor, `DELETE <ApiUrl>/agents/<agent ARN>`, or with your AWS credentials:

```bash
node lambda/delete-agent.js <stack name> --agent <agent ARN> --dry-run
node lambda/delete-agent.js <stack name> --agent <agent ARN>
```

It removes the agent's rows, their reward requests, their coaching plans and kudos addressed to them, and writes an audit line to the API log. Their Cognito user is separate; delete it in the Cognito console.

**Everything.** Delete the CloudFormation stack. The table, bucket, user pool, stream, functions, logs and alarms go with it. Cancelling the Marketplace subscription stops billing; it does not delete the stack.

## Operations and monitoring

The stack ships alarms for ingest errors, the stream falling five minutes behind, API function errors, API 5xx responses and a failed usage report, all on one SNS topic you can subscribe. Every function writes structured JSON logs. Agent deletion and configuration changes are logged with who made them.

## Updates

Releases are published as versioned templates and code archives in a public read-only S3 location. You update by updating the stack to a new template URL; nothing changes in your account until you do. Each release has [release notes](releases.html), and this help center states which version each article is current for.

## Shared responsibility

EKPK is responsible for the code in the stack and for publishing fixes. You are responsible for the AWS account the stack runs in: who can sign in, who holds account credentials, when to update, and the settings you choose such as alarm email, name display and data feeds. AWS is responsible for the services underneath, under the AWS shared responsibility model.

## Questions

Security questions and vulnerability reports go to [support@arenaforconnect.com](mailto:support@arenaforconnect.com). We answer within one business day.
