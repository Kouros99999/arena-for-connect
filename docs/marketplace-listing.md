# AWS Marketplace listing content: Arena for Amazon Connect

Copy for the SaaS listing wizard. Fields follow the Marketplace form order.

## Product

- **Product title:** Arena for Amazon Connect
- **Product ID:** prod-4qi5gee6lfmq6 (created 2026-09-29)
- **Product code:** 60k3e92pedv832asl3vbpibz7 — the value for the stack parameter `MarketplaceProductCode`; the registration page passes it automatically, together with `MarketplaceLicenseArn` and `MarketplaceCustomerAccountId` from ResolveCustomer
- **Short description (≤ 300 chars):** Agent engagement for Amazon Connect: a live leaderboard inside the agent workspace, a supervisor console with challenges and rewards, and a floor wallboard. Quality-weighted scoring, deployed into your own AWS account.
- **Long description:**

  Arena turns the activity your Amazon Connect instance already produces into a live, fair leaderboard that agents see inside the Connect agent workspace. Points come from handled contacts, Contact Lens evaluations, kudos from teammates, and quality streaks. Quality outweighs speed by design: a fast contact earns a little more, an evaluation earns much more, and an evaluation auto-fail removes points that no setting can soften.

  Supervisors get a console with the team leaderboard, anomaly flags (agents gone quiet, high volume with low quality, auto-fails), a tunable scoring mix, challenges measured from Connect data rather than self-reports, and a reward catalog with approval. A wallboard runs on a floor TV with a sign-in-free link.

  Arena deploys as a CloudFormation stack into your own AWS account. Agent data never leaves it. Setup is a launch link from this listing, two settings in the Connect console, and users synced from your Connect directory.

- **Product logo:** podium inside an open ring, white on teal (#0F766E) with an amber (#FBBF24) winner dot. Source `web/logo.svg`; PNGs from `python web/make-logo.py`. Published at https://arena-releases-533267257907.s3.us-east-1.amazonaws.com/arena/assets/logo-podium.png (512 px)
- **Highlights (3):**
  1. Leaderboard, points and streaks inside the Connect agent workspace, updated within seconds of each contact.
  2. Challenges and rewards measured from Connect data and Contact Lens evaluations, never self-reported.
  3. Runs in your own AWS account with one CloudFormation launch; about $15 a month of infrastructure.
- **Categories:** Business Applications → Contact Center; Business Applications → Workforce Management
- **Keywords:** amazon connect, contact center, gamification, agent engagement, leaderboard, agent performance, contact lens
- **Product video:** none for v0.2.0

## Listing copy to refresh at the next update (features added in 0.4.0)

Entered in the stored listing on 2026-10-03 (Save updates request succeeded 11:16 PM PDT):

- Long description, add: "Beyond evaluations, Arena scores customer sentiment from Contact Lens on every analysed contact and post-contact survey answers, so quality is measured on all contacts and not only the few that are reviewed. A results report compares any period with the one before it, and a coaching workflow turns a flag into an agreed action with a follow-up date and before-and-after numbers."
- Highlight 2 could become: "Quality measured on every contact: evaluations, Contact Lens customer sentiment and survey scores, with coaching plans that show before and after."

## Delivery

- **Fulfillment URL:** `RegistrationUrl` output of the seller stack (ends in `/register`)
- **Notifications:** the product page shows a legacy SNS topic (`arn:aws:sns:us-east-1:287250355862:aws-mp-subscription-notification-60k3e92pedv832asl3vbpibz7`), but products created after 2026-06-01 use the concurrent-agreements integration, whose notifications are EventBridge events (`aws.agreement-marketplace`, "License Updated/Deprovisioned - Manufacturer") on the seller account's default bus in us-east-1. The seller stack subscribes to them; the SNS topic is not used.
- **Supported regions:** us-east-1 first; add regions where the release bucket is replicated

## Pricing

- **Model:** SaaS subscription with usage
- **Dimension:** `agent_days` — display "Active agent-day", unit type Units, description "One agent with scored activity on a day (UTC). About 16 USD per agent per month."
- **Price:** $0.75 per agent-day (≈ $16 per agent per month at 22 working days; raised from $0.40 on 2026-10-10, before public availability). Entered as the test price $0.00000001 while the listing is in limited visibility; set the real price in the update request that asks for public availability. Optional private offer at $0.50 per agent-day for 500+ seats.
- **Metering change needed:** the stack must report a per-day count (`USAGE_DIMENSION=agent_days`, `USAGE_WINDOW_DAYS=1`) instead of the trailing-30-day count; see README.
- **Free trial:** 30 days, up to 25 agents
- **Refund policy text:** Cancel any time from AWS Marketplace; usage is billed monthly in arrears for agent-days already reported, and no further usage is reported after cancellation.

## Submitted (2026-10-09)

Submitted for limited visibility on 2026-10-09 at 9:47 PM PDT (request "Publish to Limited"). Status: Limited. Only allowlisted accounts can see it; price is still the test price. Next: buyer-path test from 533267257907, then an update request for public visibility with the real price.

## Draft state (2026-09-29)

All eight wizard steps entered and validated, saved with **Save and exit** (not submitted). Allowlist: 533267257907 (our own account, for testing the subscribe flow). Resume from the product page → **Resume product creation**. Still to put into the wizard before submitting: support email and privacy policy URL below, once the domain resolves.

## Support

- **Support email:** support@arenaforconnect.com (Cloudflare Email Routing forwards it; must be working before it goes into the listing)
- **Support URL:** https://arenaforconnect.com/support.html (until DNS is live: https://kouros99999.github.io/arena-for-connect/support.html)
- **Support description:** Email support with a one-business-day response. Deployment guide, scripts and issue tracker on GitHub.
- **Privacy policy URL:** https://arenaforconnect.com/privacy.html (source: `web/privacy.html`; until DNS is live: https://kouros99999.github.io/arena-for-connect/privacy.html)
- **Domain:** arenaforconnect.com, registered at Cloudflare 2026-10-03
- **EULA:** Standard Contract for AWS Marketplace

## Compliance and security (for the listing questionnaire)

- Data residency: all agent data in the customer's account, single region, encrypted at rest (DynamoDB, S3 SSE, Kinesis KMS).
- Authentication: Amazon Cognito user pool per deployment, or the customer's OIDC provider.
- Network: HTTPS only; CloudFront with framing restricted to the customer's Connect instance.
- Data deletion: per-agent deletion route and admin script; stack deletion removes everything.
- Least privilege: each Lambda has a scoped role; no wildcard resource except the Marketplace metering actions, which require it.
