# Gamification on Amazon Connect: what AWS gives you and what it does not

Two years ago the honest answer to "what does Amazon Connect lack" was a long list: workforce management, quality management, coaching, knowledge. AWS has since shipped most of it. If you are choosing add-ons for a Connect centre in late 2026, the list of real gaps is short, and it is worth being precise about where the line is.

## What is native now

**Workforce management.** Forecasting, capacity planning and scheduling are in Connect, with intraday forecasts that refresh every fifteen minutes, time-off and overtime requests within limits, shift bidding since September 2026, and scheduling for tasks and email since July. A third-party WFM for Connect is a shrinking market.

**Quality management.** Contact Lens evaluates voice, chat, email and tasks, with generative AI scoring, calibration, automatic selection of contacts to review, and a permission that lets agents see their own evaluations. Screen recording is native and PCI DSS compliant.

**Coaching.** Since March 2026 managers give feedback inside the Connect UI, agents acknowledge it, and the history lives on one page. Since July, Connect finds example evaluations for a coaching topic by itself.

**Knowledge.** Amazon Q in Connect puts recommended answers in the agent workspace.

**Non-voice analytics.** Contact Lens sentiment and evaluations cover chat and email. That gap closed.

## What is still missing

**Post-contact surveys.** There is no native survey product. Centres wire CSAT from disconnect flows, the post-chat widget or outbound tasks, using an AWS sample from GitHub, and then have no survey reporting. This is the clearest opening left.

**Reporting and wallboards.** Native reporting is a handful of stock reports aimed at a supervisor's screen. Centres still buy wallboards and build their own BI.

**Engagement.** Connect measures agents thoroughly and motivates them not at all. There is no leaderboard, no recognition, no contest, no reward, no streak, nothing that turns the numbers it collects into something an agent wants to look at. Every CCaaS suite that competes with Connect bundles a gamification module. Connect does not, and AWS has shown no sign of building one.

## Where Arena sits

Arena is the engagement layer and nothing else. It does not evaluate, schedule, record or coach in competition with AWS. It reads what Connect already produces, the agent event stream, Contact Lens evaluations and sentiment, survey attributes, schedule adherence, and turns them into points, leaderboards, challenges, rewards, kudos and spotlights that agents see inside the agent workspace. Coaching plans in Arena are a before-and-after measurement layer over the coaching AWS now provides, not a parallel system.

The architecture follows from that. Arena deploys as a CloudFormation stack into your own AWS account; the data never leaves it; the only thing that goes outside is a daily count for billing. If AWS ships something native that Arena duplicates, the right move is to drop the duplicate, which is what happened with coaching session structure this year.

## How to use this when you plan

Buy nothing that AWS now does natively. Build or buy surveys, because every quality score downstream depends on them. Add an engagement layer if attrition and floor energy are problems you are paying for, and measure it with the [ROI calculator](../roi.html) against your own numbers before you believe anyone's case study, ours included.
