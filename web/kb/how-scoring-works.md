# How scoring works

Arena turns what already happens in Amazon Connect into points. Nothing is self-reported. This article explains where points come from and what the scoring mix changes.

## Where points come from

| What happened | Points at the default mix |
|---|---|
| Handled a contact | 12 if handle time was 6 minutes or less, 10 up to 9 minutes, 6 beyond that |
| Contact Lens evaluation submitted | 30 for 95% or better, 20 for 85%, 10 for 70%, 0 below |
| Evaluation auto-fail | Minus 40, and no setting can soften it |
| Customer sentiment on an analysed contact | 8 for strongly positive, 5 for positive, 2 for neutral, 0 for negative |
| Post-contact survey answer | 10 for 5 of 5, 6 for 4, 2 for 3, 0 below |
| Schedule adherence, each night (with `ScheduleAdherence` enabled) | 5 per hour spent on schedule the day before; a 7.4-hour adherent day is 37 |
| Acknowledging your own evaluation in Connect | 5 |
| Kudos from a teammate | 8 |
| Quality streak, from day two | 25 each clean day |

A quick contact earns a little. A good evaluation earns a lot. That is deliberate: an agent cannot win the leaderboard by rushing.

## The scoring mix

Supervisors tune three weights in the console that must add to 100%: quality, productivity and adherence. The default is 50, 35 and 15.

The mix can differ by team. The console's scoring mix card shows which mix applies to the team on screen and has a **Save for** choice: *every team* changes the default, *this team only* gives that team its own profile. A chat team can weight productivity higher while an escalations team weights quality higher. **Use the default again** removes a team's profile. Points already scored keep the mix they were scored with.

- Quality scales evaluations, acknowledgements, customer sentiment and survey points.
- Productivity scales contact points.
- Adherence scales schedule adherence points. They exist only when the stack's `ScheduleAdherence` setting is enabled and your Connect instance has scheduling turned on; otherwise the slider changes nothing.

The console warns if quality drops under 40%, because that lets volume beat quality. The auto-fail penalty is never scaled.

## Acknowledging evaluations

When an agent opens an evaluation in Amazon Connect and acknowledges it, Arena pays 5 points on the day of the acknowledgement. The stack checks with Connect every hour for evaluations submitted in the last 30 days, so the points arrive within the hour. Auto-failed evaluations carry no acknowledgement points. This needs evaluation scoring to be on (`EvaluationsBucket`).

## Levels, badges and streaks

- **Levels** come from this week's points: Rookie, Starter, Steady, Resolver, Closer, Anchor, Legend.
- **Badges** are earned for milestones such as a 7-day streak, a first 95% evaluation, 50 contacts, or ten contacts with no escalation.
- **Quality streaks** are assessed every night. A clean day means at least one contact, no auto-fail, and every evaluation that day at 85% or better. A clean day extends the streak; a miss resets it; a day off holds it.

## Today and this week

The agent panel shows points for today and for this week. Rewards are paid from a spendable balance that resets every week, month or quarter, as the supervisor chooses; see [challenges, rewards and kudos](kb.html?a=challenges-rewards-kudos). Days, weeks and months change at midnight in the stack's `Timezone` setting (UTC unless you set one), so a late shift's points stay on the day it was worked.

## Schedule adherence

Amazon Connect measures adherence itself when forecasting, capacity planning and scheduling are enabled on the instance. With `ScheduleAdherence` enabled on the stack, Arena reads yesterday's adherence for every known agent shortly after midnight and books one line per agent: the adherence percentage and the hours spent on schedule. Points are 5 per adherent hour at the default mix, weighted by the adherence slider, and are never negative. An agent with no schedule that day gets no line and no penalty. Adherence is also a measure a race or head-to-head can run on, and the results report shows the team's average.

## Your own best

An agent who would rather not race the team can tick **my own best** above the leaderboard in their panel. The panel then shows today against their best day on record and this week against their best week, with their average active day, and the rank in the header becomes a percentage of their best day. The choice is saved on their profile and only they and supervisors see the view. They still count in team totals and on the supervisor's leaderboard, since those are team data; the change is to what the agent is shown.

A second tick box, **hide me from others**, takes the agent off their teammates' leaderboards and off wallboards, and leaves their name out of challenge standings that teammates see. Supervisors still see them, with a "hidden" tag in the console, and the agent still sees themselves. Team totals and challenge results are unchanged.

## Flags

The console flags situations worth a look, from the same data:

- **Quiet**: an agent in Available with no events for 40 minutes.
- **Volume high, QA low**: far more contacts than the team average with a low evaluation average. Possible rushing.
- **Customer sentiment low**: average sentiment at or below -1 across five or more analysed contacts.
- **Auto-fail today**.
- **Kudos volume unusual**: six or more kudos today and three times the team average.

A flag is a prompt to look, never a penalty. Each one offers **Coach**, which opens a [coaching plan](kb.html?a=coaching).
