# AWS Marketplace listing content: Arena for Amazon Connect

Copy for the SaaS listing wizard. Fields follow the Marketplace form order.

## Product

- **Product title:** Arena for Amazon Connect
- **Short description (≤ 300 chars):** Agent engagement for Amazon Connect: a live leaderboard inside the agent workspace, a supervisor console with challenges and rewards, and a floor wallboard. Quality-weighted scoring, deployed into your own AWS account.
- **Long description:**

  Arena turns the activity your Amazon Connect instance already produces into a live, fair leaderboard that agents see inside the Connect agent workspace. Points come from handled contacts, Contact Lens evaluations, kudos from teammates, and quality streaks. Quality outweighs speed by design: a fast contact earns a little more, an evaluation earns much more, and an evaluation auto-fail removes points that no setting can soften.

  Supervisors get a console with the team leaderboard, anomaly flags (agents gone quiet, high volume with low quality, auto-fails), a tunable scoring mix, challenges measured from Connect data rather than self-reports, and a reward catalog with approval. A wallboard runs on a floor TV with a sign-in-free link.

  Arena deploys as a CloudFormation stack into your own AWS account. Agent data never leaves it. Setup is a launch link from this listing, two settings in the Connect console, and users synced from your Connect directory.

- **Product logo:** 110×110 PNG, "A" mark on teal (#0F766E). *(to create)*
- **Highlights (3):**
  1. Leaderboard, points and streaks inside the Connect agent workspace, updated within seconds of each contact.
  2. Challenges and rewards measured from Connect data and Contact Lens evaluations, never self-reported.
  3. Runs in your own AWS account with one CloudFormation launch; about $15 a month of infrastructure.
- **Categories:** Business Applications → Contact Center; Business Applications → Workforce Management
- **Keywords:** amazon connect, contact center, gamification, agent engagement, leaderboard, agent performance, contact lens
- **Product video:** none for v0.2.0

## Delivery

- **Fulfillment URL:** `RegistrationUrl` output of the seller stack (ends in `/register`)
- **SNS topic:** assigned by Marketplace after creation; put it into the seller stack as `MarketplaceTopicArn`
- **Supported regions:** us-east-1 first; add regions where the release bucket is replicated

## Pricing

- **Model:** SaaS subscription with usage
- **Dimension:** `agents` — "Active agents", unit "per agent per month"
- **Price:** $12.00 per active agent per month (Quality tier). Optional private offers at $8 (Core) and $15 (Rewards).
- **Free trial:** 30 days, up to 25 agents
- **Refund policy text:** Cancel any time from AWS Marketplace; usage is billed monthly in arrears for agents active in the trailing 30 days, and no further usage is reported after cancellation.

## Support

- **Support email:** *(yours)*
- **Support URL:** https://github.com/Kouros99999/arena-for-connect
- **Support description:** Email support with a one-business-day response. Deployment guide, scripts and issue tracker on GitHub.
- **Privacy policy URL:** *(needed; a one-page policy stating data stays in the customer's account and Arena collects only the Marketplace customer identifier and subscription state)*
- **EULA:** Standard Contract for AWS Marketplace

## Compliance and security (for the listing questionnaire)

- Data residency: all agent data in the customer's account, single region, encrypted at rest (DynamoDB, S3 SSE, Kinesis KMS).
- Authentication: Amazon Cognito user pool per deployment, or the customer's OIDC provider.
- Network: HTTPS only; CloudFront with framing restricted to the customer's Connect instance.
- Data deletion: per-agent deletion route and admin script; stack deletion removes everything.
- Least privilege: each Lambda has a scoped role; no wildcard resource except the Marketplace metering actions, which require it.
