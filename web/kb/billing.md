# Billing and cancellation

## What you pay for

Arena is billed through AWS Marketplace by the **active agent-day**: one unit for each agent who had scored activity on a day, in UTC. An agent who takes no contacts on a day costs nothing that day. Your stack reports the count once a night, and the charge appears on your AWS bill with your other Marketplace subscriptions.

The listing shows the price per agent-day. For a full-time agent that comes to about 22 agent-days a month, so at $0.75 per agent-day about $16 a month.

## Free trial

For 30 days from the stack's first nightly report, up to 25 active agents a day are free: the stack subtracts them before reporting. A 20-agent centre pays nothing in its first month; a 60-agent centre pays for 35 agent-days a day. The full count is still stored in the table so you can see both numbers. The trial length and allowance are the `MarketplaceTrialDays` and `MarketplaceTrialAgents` settings, filled in by the launch page; they are not meant to be changed, and changing them does not change the listing's terms.

## Infrastructure

The stack's own AWS resources are billed by AWS at their normal rates, separately from the subscription. For a 500-agent center that is around $15 a month: one Kinesis shard, a DynamoDB table on demand, a few small Lambda functions, an HTTP API and a CloudFront distribution.

## Checking what was reported

The stack's alarm topic notifies you if a nightly report fails. The nightly count is also stored in the table, so you can see what was sent on any day.

## Cancelling

Cancel the subscription from **Manage subscriptions** in AWS Marketplace. Reporting stops with the subscription. To remove Arena entirely, delete the CloudFormation stack, which deletes every resource and all data it holds.
