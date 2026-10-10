# Challenges, rewards and kudos

## Challenges

A challenge sets a target for a period and measures progress from Connect data over the whole of that period. Agents cannot report their own progress. Supervisors create challenges from the console with **New challenge**, choosing a template:

- **Keep escalations under target**: the team's escalation rate stays at or below a percentage.
- **Every evaluation at or above a score**: every evaluated agent clears the bar.
- **Team points target**: the team earns a total.
- **Kudos received per agent**: everyone receives at least a number of kudos.
- **Agent race**: agents are ranked on one or two measures, with prizes by finishing place.
- **Head-to-head**: two agents on one measure. The winner takes the reward.
- **Team vs team**: your team against another routing profile on one measure.

Measures for races, head-to-heads and team contests: points, contacts handled, evaluation average, customer sentiment, survey score, handle time, escalation rate, kudos received.

### Contest rules for a race

- **Two measures, weighted.** Pick a main measure and optionally a second, with weights. Each agent is scored from 0 to 100 against the best in the field, lower-is-better measures are inverted, and the weighted score ranks them.
- **Minimum qualifier.** An agent needs at least that many contacts in the period to be ranked, so a one-call wonder cannot win on a single evaluation.
- **Prizes by place.** Points for 1st, 2nd and 3rd, each paid to the agent who finishes there.
- **Anonymised standings.** Hide names from agents until the race ends. Each agent still sees their own position; supervisors see everything.
- **Disqualify.** A supervisor can remove an agent from a running race with **DQ** on their row, and reinstate them later. The agent sees "disqualified"; the rest of the field re-ranks.

### Finishing

When a challenge's end date passes, or a supervisor ends it early, its standings are **frozen** and the prizes are **paid as points** once, with a "Challenge won" line in each winner's feed. For team challenges, the reward goes to everyone who took part if the target was held. Later data never changes a finished result.

Progress shows in the console, the agent panel and on wallboards. Challenge starts and results also go to the team's Slack or Teams channel if [notifications](kb.html?a=notifications) are set up.

## Rewards

Agents redeem points against a catalog from their panel. Each request waits for a supervisor's approval in the console. Declining returns nothing to the agent, since nothing was taken. Fulfilling an approved reward is up to you.

### The catalog

The **Catalog** button on the console's reward approvals card opens the team's catalog: each reward's name and cost in points, up to 20 of them. The default is a $25 gift card, a half-day Friday, a team lunch and a week's prime parking. Each team can have its own catalog, and **Use the default catalog** puts a team back on the shared one.

### Balances and resets

What an agent can spend is the points they earned in the current period minus the rewards approved in it. The period is set in the same dialog: **week** (Monday to Sunday, the default), **month** or **quarter**. When the period turns, everyone starts from zero, which is what lets a newcomer catch up with a long-tenured agent. Earned points, levels and leaderboards are not touched by a reset; only the spendable balance is. The agent panel shows the balance, the period and the date it resets.

### Monthly reward budget

Each team can carry a monthly budget in points, set from the **Budget** button on the console's reward approvals card. Approvals add to the month's total; an approval that would take the team over the budget is refused with a message, and the request stays pending until the budget is raised or the month turns. The card shows how much of the month's budget is used. Set the budget to 0 to remove the cap. When notifications are on, the team channel hears when 25%, 50%, 75% and 100% of the budget are used. Months follow the stack's `Timezone` setting.

## Kudos

Agents send kudos to a teammate from their panel with a short note. The recipient earns 8 points and the note appears on the team feed in the console and on wallboards.

To keep kudos meaningful:

- Each person may send five a day. The **KudosDailyLimit** setting changes this.
- Kudos cannot be sent to yourself, or to anyone outside your team.
- An agent receiving six or more kudos in a day, and three times the team average, is flagged in the console so a trading ring stands out.
