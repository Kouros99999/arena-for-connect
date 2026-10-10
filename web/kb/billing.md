# Billing and cancellation

## What you pay for

Arena is billed through AWS Marketplace by the **active agent-day**: one unit for each agent who had scored activity on a day, in UTC. An agent who takes no contacts on a day costs nothing that day. Your stack reports the count once a night, and the charge appears on your AWS bill with your other Marketplace subscriptions.

The listing shows the price per agent-day. For a full-time agent that comes to about 22 agent-days a month.

## Infrastructure

The stack's own AWS resources are billed by AWS at their normal rates, separately from the subscription. For a 500-agent center that is around $15 a month: one Kinesis shard, a DynamoDB table on demand, a few small Lambda functions, an HTTP API and a CloudFront distribution.

## Checking what was reported

The stack's alarm topic notifies you if a nightly report fails. The nightly count is also stored in the table, so you can see what was sent on any day.

## Cancelling

Cancel the subscription from **Manage subscriptions** in AWS Marketplace. Reporting stops with the subscription. To remove Arena entirely, delete the CloudFormation stack, which deletes every resource and all data it holds.
