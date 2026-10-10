# Arena for Amazon Connect

Agent engagement add-on for Amazon Connect: a live leaderboard panel inside the agent workspace, a supervisor console, and a floor wallboard. Deploys into the customer's own AWS account. Agent data never leaves it.

**Live demo (simulated data):** https://kouros99999.github.io/arena-for-connect/

## What is here

| Path | What |
|---|---|
| `prototype/agent-panel.html` | Third-party app for the Connect agent workspace |
| `prototype/supervisor-console.html` | Supervisor console: leaderboard, flags, scoring mix, challenges, rewards |
| `prototype/wallboard.html` | Floor display, sized for a TV |
| `prototype/report.html` | Results report for supervisors: this period against the one before, per-agent changes, coaching outcomes, CSV export |
| `prototype/arena-engine.js` | Shared scoring engine: rules, mix, levels, badges, anomaly flags, simulator, remote client |
| `prototype/serve.js` | Local dev server with a mock of the API under `/api` |
| `lambda/src/ingest.js` | Lambda on the Connect agent event stream (Kinesis) |
| `lambda/src/evaluations.js` | Lambda on Contact Lens evaluation output (S3 via EventBridge), deduped per evaluation |
| `lambda/src/sentiment.js` | Lambda on Contact Lens conversational analytics output: customer sentiment per contact, deduped per contact |
| `lambda/src/api.js` | HTTP API: team agents, agent events, scoring mix, kudos, challenges, rewards and budgets, history, coaching, metric import |
| `lambda/src/adherence.js` | Nightly schedule adherence import from Connect (GetMetricDataV2) |
| `lambda/src/clock.js` | Local time: day, week and month keys in the stack's Timezone |
| `lambda/src/mix.js` | Which scoring mix applies to a team, cached |
| `lambda/src/store.js` | Single-table DynamoDB layer |
| `lambda/template.yaml` | SAM stack: stream, table, both Lambdas, API, optional JWT auth |
| `web/` | Public site for arenaforconnect.com: landing page, support, privacy policy (deployed with the demo by GitHub Pages) |
| `docs/` | Research brief and notes |

## Run locally

```bash
node prototype/serve.js
```

Then open:

- Simulated: http://localhost:8765/agent-panel.html
- Against the mock API: http://localhost:8765/agent-panel.html?api=http://localhost:8765/api&team=Billing%20team&agent=agent-0

## Test

```bash
node lambda/build.js && node --test prototype/arena-engine.test.js lambda/src/ingest.test.js lambda/src/store.test.js lambda/src/api.test.js lambda/src/evaluations.test.js lambda/src/sentiment.test.js lambda/src/notify.test.js lambda/src/challenges.test.js lambda/src/digest.test.js lambda/src/adherence.test.js lambda/src/clock.test.js lambda/src/mix.test.js lambda/src/metering.test.js lambda/src/streaks.test.js lambda/src/site-deployer.test.js lambda/seller/register.test.js prototype/arena-auth.test.js web/releases.test.js
```

## Deploy into an AWS account

```bash
cd lambda && node build.js && sam build && sam deploy --guided
node lambda/deploy-pages.js <stack name> --team "Billing team"
```

The stack creates the stream, the table, the Lambdas, the HTTP API, and a private S3 bucket behind CloudFront. The second command uploads the three pages plus a `config.js` that points them at `/api` on the same origin, so there is no CORS and one URL to register.

Then in the Connect console: enable agent event streaming to the stream ARN the stack outputs, and add `<SiteUrl>/agent-panel.html` as a third-party application in the agent workspace. The CloudFront response headers allow framing only from `*.my.connect.aws` and `*.awsapps.com`, or from the single instance you pass as `ConnectInstanceUrl`.

### Sign-in

By default the stack creates a Cognito user pool with two groups, `supervisors` and `agents`, and the HTTP API accepts only its tokens. The pages sign in through the Cognito hosted UI with authorization code and PKCE; each user carries the Connect agent ARN and routing profile as custom attributes, so the panel opens on the right agent and team with no query string. Create the users from the Connect directory:

```bash
node lambda/sync-users.js <stack name> --instance <connect instance id> --dry-run
node lambda/sync-users.js <stack name> --instance <connect instance id>
```

Users whose Connect security profile name contains "supervisor" or "admin" land in the supervisors group. Supervisors may read and act on any team. Everyone else is scoped to the team on their token and to their own points ledger, so an agent cannot browse another team's leaderboard or another agent's feed. With `AuthMode=external`, the customer's identity provider must issue the same two claims, `custom:team` and `custom:agentArn`, or agents will be refused. To use the customer's own identity provider instead, either add it as a federated provider on the pool, or deploy with `AuthMode=external` and their OIDC issuer and audience. The API always requires a token; there is no open mode.

For quality scoring, pass `EvaluationsBucket` at deploy time (the bucket Connect writes Contact Lens evaluations to) and turn on "Send notifications to Amazon EventBridge" in that bucket's properties. Each submitted evaluation is scored once; a re-submitted evaluation is ignored.

## Customer sentiment and survey scores

Evaluations cover only the few contacts a reviewer gets to. Two more quality signals cover the rest, and both scale with the quality weight in the scoring mix. Neither ever deducts points: customers are sometimes unhappy for reasons no agent controls.

**Customer sentiment.** Pass `AnalysisBucket` at deploy time (the bucket Connect writes Contact Lens conversational analytics to, usually the recordings bucket) and turn on EventBridge notifications for it. Each analysed contact scores its overall customer sentiment, from -5 to +5: up to 8 points at the default mix. The analysis file names the contact but not the agent, so the agent comes from a marker the event-stream ingest writes when the contact is handled; if the analysis arrives first it is retried. An agent whose average drops to -1 or lower across five or more analysed contacts is flagged.

**Survey scores.** If a post-contact survey flow writes the customer's answer to a contact attribute, send Connect's contact records to the same Kinesis stream as the agent events and set `CsatAttribute` to that attribute's name (default `csat`). Scores on 1-5, 0-10 and 0-100 scales are brought to 1-5; a 5 earns 10 points. For survey tools outside Connect, a supervisor token can post a score instead:

```bash
curl -X POST "$API/teams/Billing%20team/metrics" -H "authorization: Bearer $TOKEN" \
  -d '{"agentId":"<agent ARN>","metric":"csat","score":5,"contactId":"<contact id>"}'
```

Both appear in the console (a team tile and a column per agent), in the agent panel, and in the report.

## Results report

`report.html`, linked from the console, answers "is this working?". It compares the last 7, 14, 30 or 90 days with the same number of days before them: evaluation average, customer sentiment, survey score, auto-fails, escalation rate, handle time, contacts and points, each with its change. A chart shows one measure by day with the previous period's average as a dashed line, and a table lists every agent with their evaluation average before and now. It prints cleanly and exports CSV. The data is the per-agent day rows Arena already keeps, read through `GET /teams/{team}/history?days=30`; supervisors only.

## Coaching

A flag is only useful if something happens next. **Coach** on any flag opens a plan: why, the action agreed with the agent, a follow-up date, and a private note only supervisors see. Opening a plan records the agent's 14-day averages as a baseline. The console then shows each open plan with the numbers before and since, whether the agent has seen it, and whether the follow-up date has passed. The agent sees the agreed action in their panel and confirms with **Got it**; they cannot edit or close it, and never see the private note. Closing a plan stores the result, and the report lists every plan with the evaluation average before and after. Plans are team items like challenges and rewards, under `/teams/{team}/coaching`, and are removed with the agent's other data on deletion.

## Challenges, rewards, kudos

Challenges come from templates (escalation rate, evaluation floor, team points target, kudos per agent, and three ranked formats: agent race, head-to-head, team vs team) and their progress is always computed from agent data by the same function in the browser and the API, never self-reported. They are measured over their whole period from the per-agent day rows. Races carry contest rules: one or two weighted measures, a minimum number of contacts to be ranked, prizes by place, anonymised standings until the end, and supervisor disqualification. When a challenge ends, by date (the hourly job) or by a supervisor, its standings are frozen into `results` and prizes are paid once as `CHALLENGE_WON` events. Supervisors create and end them from the console. Agents redeem weekly points against a catalog; each request waits for supervisor approval, which deducts the points. Kudos are sent from the agent panel, score 8 points for the recipient, and land on a team feed that the console and wallboard show. They are capped per sender per day (`KudosDailyLimit`, default 5), cannot be sent to oneself, and must go to someone on the sender's team. An agent receiving far more kudos than the team average is flagged in the console, so a trading ring stands out. All of it lives in the same DynamoDB table as team items, with routes under `/teams/{team}/challenges`, `/rewards` and `/kudos`.

## Notifications

Each team can have a Slack incoming webhook, a Teams incoming webhook and a digest email, set from the console (`/teams/{team}/notifications`, supervisors only; URLs are stored whole and returned masked). Kudos, reward requests and decisions, challenge starts and results are posted as they happen. An hourly job sends each team's daily digest at its chosen UTC hour and finishes challenges whose end date has passed. Email goes through the `DigestTopic` SNS topic; pass `DigestEmail` at deploy time to subscribe an address. A failed webhook is logged and never fails the request that triggered it.

## Marketplace: metering and releases

A nightly Lambda counts distinct agents with any activity in the previous day and reports the number to the AWS Marketplace Metering Service as the `agent_days` dimension (one unit per agent per active day, listed at $0.40), once per day and idempotent on retry. `USAGE_DIMENSION` and `USAGE_WINDOW_DAYS` on the metering function change the dimension and window for private deals. It only reports when the stack is deployed with `MarketplaceProductCode`; without it the count is recorded in the table and nothing is sent, so pilots and direct deals use the same template. An alarm fires if a nightly report fails.

To cut a self-contained release that any account can deploy:

```bash
node lambda/release.js 0.1.0 --bucket <your public artifacts bucket>
```

**Release notes and the help center come first.** The script refuses to run until `web/releases.json` has an entry for the version at the top of the file: version, date, a title, a one-sentence summary, the changes in plain customer language, and anything a customer must do when upgrading. That one file drives the public notes page (`releases.html`) and the "latest version" line on the landing page, and a copy ships beside the template as `RELEASE_NOTES.json`. Each entry also lists, under `docs`, the help-center articles the release changed; the script checks that each one exists in `web/kb/index.json` and is marked current for that version. The help center itself is `web/kb.html` plus one Markdown file per article in `web/kb/`. Pushing the commit publishes notes and articles to the website, so a version never goes out without the site saying what changed and how to use it.

This zips the Lambda code and the pages, rewrites every `CodeUri` in the template to the published archive, writes checksums, and uploads all of it with public read to `s3://<bucket>/arena/0.1.0/`. The printed template URL is what goes into the Marketplace listing, and what a customer can launch directly in the CloudFormation console.

## Selling on AWS Marketplace (SaaS listing)

Marketplace has no product type for a serverless CloudFormation stack, so Arena is listed as **SaaS**: the buyer subscribes, Marketplace posts their subscription token to our registration page, and that page hands them a one-click CloudFormation launch link with their customer identifier and the product code as parameters. The stack they launch installs the pages itself (`SiteArchiveUrl`, a custom resource) and meters nightly against their license with `BatchMeterUsage`. This is the concurrent-agreements integration Marketplace requires of SaaS products created after June 2026: the registration page resolves the token to a `LicenseArn` and `CustomerAWSAccountId`, both travel as stack parameters, every usage record names them (and no product code), and license lifecycle notifications arrive through EventBridge rather than SNS.

The seller-side pieces live in `lambda/seller/` and deploy once, in the seller account, in us-east-1:

```bash
cd lambda/seller && sam build && sam deploy --guided   # ReleaseBase = the release URL, SupportEmail
```

Its `RegistrationUrl` output goes into the listing as the fulfillment URL. The stack also subscribes to the "License Updated - Manufacturer" and "License Deprovisioned - Manufacturer" events for the product code, so each license's state lands in the customers table, keyed by `LicenseArn`. Usage may be reported from the first update event until about an hour after the deprovision event.

## Operations

**Alarms.** The stack creates an SNS topic and alarms for ingest errors, ingest falling more than five minutes behind the stream, API function errors, API 5xx responses, and (on Marketplace) a failed nightly usage report. Pass `AlarmEmail` at deploy time to get them by email, or subscribe anything else to the `AlarmTopicArn` output.

**Scoring profiles.** `CONFIG / MIX` is the default mix and `CONFIG / MIX#<team>` a team's own; `lambda/src/mix.js` resolves which applies (team, then default, then the engine's built-in weights) with a one-minute cache per team, and every stream handler scores with the event's team. `GET/PUT /config/mix?team=T` reads and writes a profile, `{ useDefault: true }` removes it.

**Personal best.** `GET /agents/{arn}/best` reads the agent's day rows and returns their best day and week, average active day and how today compares (`Arena.personalBest`, shared with the browser). `PUT /agents/{arn}/prefs { personalBest }` stores the panel preference on the LIVE row. Agents reach only their own; supervisors any.

**Time zone.** `Timezone` (an IANA name, default `UTC`) decides when a day, an ISO week and a month begin for day rows, streaks, challenge dates, the digest hour and reward budgets; `lambda/src/clock.js` is the only place that knows. Jobs that act "once a day" run hourly and act on the first run after local midnight.

**Schedule adherence.** With `ScheduleAdherence=enabled`, `lambda/src/adherence.js` runs hourly and, once per local day, calls Connect `GetMetricDataV2` (`AGENT_SCHEDULE_ADHERENCE`, `AGENT_ADHERENT_TIME`, `AGENT_SCHEDULED_TIME`) for yesterday, grouped by agent, for every agent with a LIVE row. Each scheduled agent gets one `ADHERENCE_SCORED` event (percent, adherent hours) worth `BASE.adherenceHour` per adherent hour times the adherence weight, deduped per agent and day. The instance ARN comes from the agent ARNs, so there is nothing else to configure, but the instance must have forecasting, capacity planning and scheduling enabled.

**Reward budgets.** `GET/PUT /teams/{team}/budget` sets a monthly cap in points per team (`CONFIG / BUDGET#team`); approvals add to `BUDGET#team / YYYY-MM` and are refused with 409 when they would cross the cap. Crossing 25/50/75/100% posts a `budgetAlert` to the team's channels once each.

**Streaks.** A job that runs hourly, and acts once after local midnight, assesses each agent's previous day: at least one contact, no auto-fail, every evaluation at or above 85 extends the quality streak; a miss resets it; a day with no contacts holds it. From day two each clean day pays the streak bonus into the new day.

**Wallboard on a TV.** A supervisor clicks "TV link" in the console. That mints a kiosk token, valid 90 days, and copies a wallboard URL that needs no sign-in. Kiosk routes are read-only and served under `/kiosk/{token}/…` with the token as the only credential; a supervisor can list and revoke tokens through the API. Because anyone walking past can read a TV, `WallboardNames` controls how people appear there: `full` (as in Connect), `first` (first name and last initial) or `initials`. Signed-in pages always show full names. The DynamoDB table keeps 35 days of point-in-time backups.

**Deleting an agent's data.** `DELETE /agents/{arn}` (supervisors) or, with admin credentials:

```bash
node lambda/delete-agent.js <stack name> --agent <agent ARN> --dry-run
```

It removes the agent's partition, their reward requests, and kudos addressed to them, and logs an audit line. The Cognito user is separate; remove it with `aws cognito-idp admin-delete-user` when the person leaves.

## Scoring in one paragraph

Quality outweighs speed by design. A handled contact earns 6 to 12 points depending on handle time. An evaluation earns up to 30. An evaluation auto-fail removes 40 and no scoring mix can soften it. Supervisors tune the quality, productivity, and adherence weights, which must add to 100, and the console warns when quality drops under 40. Flags catch agents who have gone quiet, agents with high volume and low quality, and auto-fails.

## Cost

About $13 a month per Connect instance for a 500-agent center: one provisioned Kinesis shard, two small Lambdas, an on-demand DynamoDB table, and an HTTP API. See `docs/` for the breakdown.
