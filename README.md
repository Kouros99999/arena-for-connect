# Arena for Amazon Connect

Agent engagement add-on for Amazon Connect: a live leaderboard panel inside the agent workspace, a supervisor console, and a floor wallboard. Deploys into the customer's own AWS account. Agent data never leaves it.

**Live demo (simulated data):** https://kouros99999.github.io/arena-for-connect/

## What is here

| Path | What |
|---|---|
| `prototype/agent-panel.html` | Third-party app for the Connect agent workspace |
| `prototype/supervisor-console.html` | Supervisor console: leaderboard, flags, scoring mix, challenges, rewards |
| `prototype/wallboard.html` | Floor display, sized for a TV |
| `prototype/arena-engine.js` | Shared scoring engine: rules, mix, levels, badges, anomaly flags, simulator, remote client |
| `prototype/serve.js` | Local dev server with a mock of the API under `/api` |
| `lambda/src/ingest.js` | Lambda on the Connect agent event stream (Kinesis) |
| `lambda/src/evaluations.js` | Lambda on Contact Lens evaluation output (S3 via EventBridge), deduped per evaluation |
| `lambda/src/api.js` | HTTP API: team agents, agent events, scoring mix, kudos |
| `lambda/src/store.js` | Single-table DynamoDB layer |
| `lambda/template.yaml` | SAM stack: stream, table, both Lambdas, API, optional JWT auth |
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
node lambda/build.js && node --test prototype/arena-engine.test.js lambda/src/ingest.test.js lambda/src/store.test.js lambda/src/api.test.js lambda/src/evaluations.test.js prototype/arena-auth.test.js
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

Users whose Connect security profile name contains "supervisor" or "admin" land in the supervisors group. To use the customer's own identity provider instead, either add it as a federated provider on the pool, or deploy with `AuthMode=external` and their OIDC issuer and audience. The API always requires a token; there is no open mode.

For quality scoring, pass `EvaluationsBucket` at deploy time (the bucket Connect writes Contact Lens evaluations to) and turn on "Send notifications to Amazon EventBridge" in that bucket's properties. Each submitted evaluation is scored once; a re-submitted evaluation is ignored.

## Challenges, rewards, kudos

Challenges come from templates (escalation rate, evaluation floor, team points target, kudos per agent) and their progress is always computed from agent data by the same function in the browser and the API, never self-reported. Supervisors create and end them from the console. Agents redeem weekly points against a catalog; each request waits for supervisor approval, which deducts the points. Kudos are sent from the agent panel, score 8 points for the recipient, and land on a team feed that the console and wallboard show. All of it lives in the same DynamoDB table as team items, with routes under `/teams/{team}/challenges`, `/rewards` and `/kudos`.

## Scoring in one paragraph

Quality outweighs speed by design. A handled contact earns 6 to 12 points depending on handle time. An evaluation earns up to 30. An evaluation auto-fail removes 40 and no scoring mix can soften it. Supervisors tune the quality, productivity, and adherence weights, which must add to 100, and the console warns when quality drops under 40. Flags catch agents who have gone quiet, agents with high volume and low quality, and auto-fails.

## Cost

About $13 a month per Connect instance for a 500-agent center: one provisioned Kinesis shard, two small Lambdas, an on-demand DynamoDB table, and an HTTP API. See `docs/` for the breakdown.
