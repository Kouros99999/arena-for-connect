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
| Kudos from a teammate | 8 |
| Quality streak, from day two | 25 each clean day |

A quick contact earns a little. A good evaluation earns a lot. That is deliberate: an agent cannot win the leaderboard by rushing.

## The scoring mix

Supervisors tune three weights in the console that must add to 100%: quality, productivity and adherence. The default is 50, 35 and 15.

- Quality scales evaluations, customer sentiment and survey points.
- Productivity scales contact points.
- Adherence is reserved for a workforce-management feed and does not score anything yet. The console says so.

The console warns if quality drops under 40%, because that lets volume beat quality. The auto-fail penalty is never scaled.

## Levels, badges and streaks

- **Levels** come from this week's points: Rookie, Starter, Steady, Resolver, Closer, Anchor, Legend.
- **Badges** are earned for milestones such as a 7-day streak, a first 95% evaluation, 50 contacts, or ten contacts with no escalation.
- **Quality streaks** are assessed every night. A clean day means at least one contact, no auto-fail, and every evaluation that day at 85% or better. A clean day extends the streak; a miss resets it; a day off holds it.

## Today and this week

The agent panel shows points for today and for this week. Rewards are priced against this week's points. Days change at midnight UTC.

## Flags

The console flags situations worth a look, from the same data:

- **Quiet**: an agent in Available with no events for 40 minutes.
- **Volume high, QA low**: far more contacts than the team average with a low evaluation average. Possible rushing.
- **Customer sentiment low**: average sentiment at or below -1 across five or more analysed contacts.
- **Auto-fail today**.
- **Kudos volume unusual**: six or more kudos today and three times the team average.

A flag is a prompt to look, never a penalty. Each one offers **Coach**, which opens a [coaching plan](kb.html?a=coaching).
