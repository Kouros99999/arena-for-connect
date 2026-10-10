# Troubleshooting

## Nothing scores

- In the Connect console, under **Data streaming**, confirm agent events go to the stream named in the stack's `StreamArn` output. Events only flow for agents who change state or handle a contact after this is set.
- In CloudWatch, the `arena-ingest-<stack>` function's logs show each batch. No invocations means no events are arriving.
- The ingest alarm fires if the function errors.

## An agent sees the panel but shows at zero

Their user's agent attribute does not match the ARN on the event stream. Re-run the sync script, or check the `custom:agentArn` attribute on their Cognito user.

## The panel is blank inside the workspace

- The application URL must be exactly `<SiteUrl>/agent-panel.html`.
- If you set `ConnectInstanceUrl`, it must match the access URL of the instance, including `https://`.
- The agent's security profile must grant **Access** to the application.

## Sign-in loops or "not your team"

- Agents need a `custom:team` attribute that matches their routing profile name exactly. The sync script sets it.
- With an external identity provider, the token must carry `custom:team`, `custom:agentArn` and a groups claim.

## Evaluations or sentiment are not scoring

- The bucket name on the stack must match where Connect writes, and EventBridge notifications must be on for the bucket.
- Each evaluation and each analysed contact scores once. Re-submitting an evaluation does not score again.
- Sentiment needs the agent event that names the handler to arrive first. Arena retries for an hour, then logs the contact id.

## The report shows no earlier period

It needs twice the chosen period in recorded days. A new install has none; wait, or choose a shorter period.

## What to send support

Email support@arenaforconnect.com with:

- Your AWS region and stack name.
- What you expected and what happened, with the time in UTC.
- For scoring questions, the agent's Connect username. Please do not send customer contact content.

We answer within one business day.
