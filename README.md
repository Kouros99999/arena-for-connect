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
node lambda/build.js && node --test prototype/arena-engine.test.js lambda/src/ingest.test.js lambda/src/store.test.js lambda/src/api.test.js lambda/src/evaluations.test.js
```

## Deploy into an AWS account

```bash
cd lambda && node build.js && sam build && sam deploy --guided
```

Then in the Connect console: enable agent event streaming to the stream ARN the stack outputs, and add the hosted panel URL as a third-party application in the agent workspace. Open any page with `?api=<ApiUrl>&team=<routing profile name>`.

For quality scoring, pass `EvaluationsBucket` at deploy time (the bucket Connect writes Contact Lens evaluations to) and turn on "Send notifications to Amazon EventBridge" in that bucket's properties. Each submitted evaluation is scored once; a re-submitted evaluation is ignored.

## Scoring in one paragraph

Quality outweighs speed by design. A handled contact earns 6 to 12 points depending on handle time. An evaluation earns up to 30. An evaluation auto-fail removes 40 and no scoring mix can soften it. Supervisors tune the quality, productivity, and adherence weights, which must add to 100, and the console warns when quality drops under 40. Flags catch agents who have gone quiet, agents with high volume and low quality, and auto-fails.

## Cost

About $13 a month per Connect instance for a 500-agent center: one provisioned Kinesis shard, two small Lambdas, an on-demand DynamoDB table, and an HTTP API. See `docs/` for the breakdown.
