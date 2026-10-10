# Getting started

Arena installs into your own AWS account as one CloudFormation stack. From subscribing to agents seeing points takes about an hour, most of it waiting for AWS to build the stack.

## Before you start

You need:

- An Amazon Connect instance, and an AWS account with permission to create CloudFormation stacks, IAM roles, DynamoDB tables, Lambda functions and a CloudFront distribution.
- A routing profile per team. Arena uses the routing profile name as the team name.
- Optional, for quality scoring: Contact Lens evaluations and conversational analytics switched on, with their S3 buckets to hand.

## 1. Subscribe and launch

1. On the Arena listing in AWS Marketplace, choose **View purchase options**, then **Subscribe**.
2. Choose **Set up your account**. Marketplace brings you to the Arena registration page, which confirms your subscription and shows a **Launch Arena in CloudFormation** button.
3. The launch page opens in your AWS console with the template and your subscription prefilled. Review the settings. The ones most people change are the alarm email, the evaluation and analysis buckets, and the wallboard name style. Every setting is explained in the [settings reference](kb.html?a=settings-reference).
4. Tick the acknowledgement that the stack creates IAM resources, then **Create stack**. Expect about ten minutes, most of it CloudFront.

When the stack shows `CREATE_COMPLETE`, open its **Outputs** tab. You will use `StreamArn`, `SiteUrl` and `UserPoolId`.

## 2. Point Connect at Arena

Arena reads the agent event stream. In the Amazon Connect console:

1. Open your instance, then **Data streaming**.
2. Under **Agent events**, choose the Kinesis stream named in the `StreamArn` output.
3. Save.

Optional, for survey scores: under **Contact records**, choose the same stream, and set the `CsatAttribute` setting on the stack to the contact attribute your survey writes. See [customer sentiment and survey scores](kb.html?a=sentiment-and-surveys).

## 3. Put the panel in the agent workspace

1. In the Connect console, open **Third-party applications** and add an application with the URL `<SiteUrl>/agent-panel.html`.
2. In **Security profiles**, grant **Access** to that application for your agents' profiles.

Agents see an **Arena** tab in their workspace.

## 4. Create sign-ins

Arena has its own sign-in so that the API never trusts a browser's word about who is asking. The stack creates a user pool with two groups, `supervisors` and `agents`. Create the users from your Connect directory with the sync script from the deployment package:

```bash
node lambda/sync-users.js <stack name> --instance <connect instance id> --dry-run
node lambda/sync-users.js <stack name> --instance <connect instance id>
```

Users whose Connect security profile name contains "supervisor" or "admin" become supervisors. Everyone else is an agent, tied to their Connect agent and routing profile. To use your own identity provider instead, see [users and sign-in](kb.html?a=users-and-sign-in).

## 5. Open the pages

- Agents: the Arena tab in the workspace, or `<SiteUrl>/agent-panel.html`.
- Supervisors: `<SiteUrl>/supervisor-console.html`.
- Results report: `<SiteUrl>/report.html`.
- Wallboard: created from the console with **TV link**. See [wallboards](kb.html?a=wallboard).

The first contact an agent handles after the stream is connected appears in their panel within seconds. If nothing appears, see [troubleshooting](kb.html?a=troubleshooting).
