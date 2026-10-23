# Why quality has to outweigh speed in contact centre gamification

Every contact centre leaderboard starts with the same good intention and the same wrong number. The number is contacts handled, because it is the one every platform reports in real time. The intention is to make the floor feel alive. Put the two together and within a month you have agents transferring calls to keep their counts up, wrapping customers before the problem is solved, and a top five that supervisors quietly stop trusting.

This is not a theory. It is the most common complaint in every community thread about contact centre gamification, on every platform. One Genesys practitioner described exactly this cycle, speed-only scoreboards leading to rushing and transfers, and the fix their centre landed on: boards built on quality and efficiency together. We built Arena around that lesson from the first commit.

## The scoring has to make rushing a losing strategy

Arena's base points at the default mix are deliberately lopsided. A handled contact earns 6 to 12 points depending on handle time, and the difference between a six-minute contact and a nine-minute one is two points. An evaluation earns up to 30. A strongly positive customer sentiment score earns 8, a top survey answer 10. An evaluation auto-fail removes 40, and no setting in the product can soften that.

Do the arithmetic from an agent's chair. Rushing three extra contacts in a shift is worth perhaps six points. One evaluation that comes back at 95 instead of 70 is worth twenty. One auto-fail wipes out a morning. The fastest way to the top of the board is to do the job well, which is the only kind of leaderboard worth having.

## Customer signals count, and never deduct

Quality cannot rest on evaluations alone, because evaluations touch a handful of contacts a week. Arena also scores customer sentiment from Contact Lens on every analysed contact and post-contact survey answers on every surveyed one. Both add points for good outcomes and add nothing for bad ones. Customers are sometimes unhappy for reasons no agent controls, and a scoring system that punished agents for them would be gamed in a week by cherry-picking easy queues.

## The mix is tunable, with a floor

Supervisors can move the weights between quality, productivity and adherence, per team if they like. A chat team and an escalations team are not the same job. The console warns the moment quality drops under 40 percent, because below that the arithmetic above stops holding and volume can beat quality again. The warning cannot be switched off.

## Flags catch what points cannot

Scores reward the right behaviour; flags catch the wrong one. Arena flags an agent whose volume is far above the team mean while their evaluations are low, an agent who has gone quiet for forty minutes, an agent whose customer sentiment is consistently negative, and an agent receiving far more kudos than the team average, which usually means two people trading them. Each flag is a Coach button away from a plan with an agreed action and a follow-up date.

## What this looks like in practice

A supervisor who sets up Arena with the defaults gets a board where the top three are the agents the team already respects. That is the test. If a leaderboard surprises the people who know the floor, the scoring is wrong, and no amount of prizes will fix it.

Arena runs inside your own AWS account and scores only from Amazon Connect data. The full scoring table is in the [help center](../kb/how-scoring-works.html), and the [demo](../agent-panel.html) runs on simulated contacts so you can watch the arithmetic play out.
