# Slack, Teams and email notifications

Arena can tell the team what happened without anyone opening the console: kudos as they are sent, reward requests, challenge starts and results, and a daily digest.

## Setting it up

Each team has its own settings, in the **Notifications** card of the supervisor console.

1. **Slack**: in Slack, create an incoming webhook for the channel you want (Slack's app settings, "Incoming Webhooks"). Paste the webhook URL into **Slack webhook**.
2. **Microsoft Teams**: in the channel, add an incoming webhook (Connectors, or a Workflows "post to a channel when a webhook request is received" flow) and paste its URL into **Teams webhook**.
3. **Email digest**: enter an address under **Digest email**. The stack's `DigestEmail` setting must also be set to that address at launch or by updating the stack, and AWS sends a confirmation email that must be accepted once. Email carries only the daily digest.
4. Choose the **digest hour**. Hours are in the stack's `Timezone` setting (UTC unless you set one); when that differs from your computer's clock, your local time is shown beside each hour.
5. Tick which events to send, **Save**, then **Send a test**. A message saying "Arena connected" arrives in each channel.

Webhook URLs are secrets. Arena stores them in your account's table and never shows them whole again; the console displays the last few characters so you can tell which is set.

## What gets sent

| Event | When |
|---|---|
| Kudos | Each time an agent sends kudos: who, to whom, and the note |
| Reward requested | An agent asks for a reward, with a reminder to approve it |
| Reward approved or declined | A supervisor decides |
| Spotlight | Arena's own recognition: a 95%+ evaluation, a streak milestone, a personal best day. Its own switch. |
| Reward budget | 25%, 50%, 75% and 100% of the team's monthly reward budget has been approved (part of the reward requests switch) |
| New challenge | A challenge starts |
| Challenge over | A challenge ends, with the result and who won what |
| Daily digest | Once a day at the chosen hour: team points, contacts, evaluation average, sentiment, kudos, the top five, open challenges, how many agents are flagged and how many reward requests wait |

The digest is sent once per team per day. If every channel is empty, nothing is sent and nothing fails.

## If a message does not arrive

- Use **Send a test**. If a channel refuses the message, the console says so.
- Webhooks can be revoked on the Slack or Teams side. Create a new one and paste it in.
- A failed notification never blocks the thing that caused it: kudos are still scored, rewards still requested. The failure is logged in the API function's CloudWatch logs.
