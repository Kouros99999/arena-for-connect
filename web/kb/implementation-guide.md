# Implementation guide for partners

A runbook for an integrator or consultancy deploying Arena for a client. It assumes you know Amazon Connect and have deployed CloudFormation before. A first team is live in about half a day; the hours below are for one implementer.

## Before the engagement (1 hour)

Ask the client:

- Which **Connect instance** and region, and who holds admin on it.
- Which **routing profiles** map to the teams they want on leaderboards. Arena uses routing profile names as team names.
- Whether they have **Contact Lens** evaluations and conversational analytics, and which S3 bucket and prefix those write to. Without them Arena scores contacts, kudos, streaks and surveys only.
- Whether they use **Connect scheduling**. If so, adherence can be a point source.
- Their **time zone** and what hour a daily digest should arrive.
- Who the **supervisors** are and whether sign-in should use the stack's Cognito pool or their identity provider (OIDC).
- Whether they want **Slack or Microsoft Teams** notifications, and who can create an incoming webhook.
- Whether this is a **Marketplace subscription** or a **pilot** outside Marketplace (same stack, billing settings left empty).

Have the client's security team read [security and your data](kb.html?a=security-and-data) early. It answers the questions they will ask.

## 1. Subscribe or prepare a pilot (15 minutes)

Marketplace: the client subscribes to Arena, chooses **Set up your account**, and the registration page gives a launch link with their subscription prefilled. Follow [getting started](kb.html?a=getting-started). Pilot: launch the public template directly in CloudFormation with the Marketplace settings empty; the release notes name the current template URL.

## 2. Launch the stack (30 minutes, mostly waiting)

On the launch page set, at minimum:

- **Timezone**, for example `America/Chicago`.
- **ConnectInstanceArn** and leave **BackfillDays** at 90, so the first screen is not empty and every user appears in the console.
- **EvaluationsBucket** and **AnalysisBucket** if Contact Lens is on, with their prefixes.
- **ScheduleAdherence** enabled if the client schedules in Connect.
- **AlarmEmail** for operational alarms and **DigestEmail** if the daily digest should go by email.
- **WallboardNames** to `first` or `initials` if screens are in a public area.

Tick all three acknowledgement boxes, then create the stack. Every setting is explained in the [settings reference](kb.html?a=settings-reference) and can be changed later by updating the stack.

## 3. Connect the data (30 minutes)

1. In the Connect console, **Data streaming**, set the agent event stream to the `StreamArn` output. Optionally send contact records to the same stream for survey scores from a contact attribute.
2. If Contact Lens is on, enable **EventBridge notifications** on the evaluations and analysis buckets. The stack's rules do the rest.
3. Within the hour, the backfill job loads up to 90 days of history. Check the console: every agent should be listed, with points on past days.

## 4. Put the panel in the agent workspace (20 minutes)

Register `<SiteUrl>/agent-panel.html` as a third-party application in Connect and grant it on the agents' security profiles. See [getting started](kb.html?a=getting-started) step 3. For a custom contact control panel, the panel opens in a browser tab instead.

## 5. Sign-ins (30 minutes)

Cognito, the default: open the console as the stack's first supervisor (created by the sync script or the Cognito console), then use **People** to add the rest, picking each Connect agent so names and teams fill in. Agents without email get a temporary password shown once. For a large instance, run the sync script once. External identity provider: see [users and sign-in](kb.html?a=users-and-sign-in).

## 6. Configure with the client's supervisor (1 hour)

Sit with the supervisor who will own Arena and do these together, so they can repeat them:

- **Scoring mix** per team, if a team should weight quality or productivity differently. Default is fine for most.
- **Reward catalog and balance period** from the Catalog button; the default catalog is a placeholder.
- A **monthly reward budget** if finance wants a cap.
- **Notifications**: paste the Slack or Teams webhook, pick the digest hour, send a test.
- **Brand**: company name, colours and logo.
- Start one **challenge** from the suggestions, so the floor sees something on day one.
- Mint a **TV link** for the wallboard and set its size and contrast on the screen.

## 7. Handover (30 minutes)

Give the client:

- The stack name and region, the site URL, and the console, report and wallboard links.
- The help center link and the [troubleshooting](kb.html?a=troubleshooting) article.
- Where the alarms go and what each means.
- How to update: update the stack to the template URL in the newest [release notes](releases.html).
- Who to contact: [support@arenaforconnect.com](mailto:support@arenaforconnect.com), one business day.

## Other platforms

For a client not on Amazon Connect, the stack still deploys into their AWS account and events arrive through the [ingest endpoint](kb.html?a=connecting-other-platforms) from middleware you build against the platform's APIs. Budget a week for the middleware the first time.

## Common questions from clients

- **Can agents game it?** Scores come only from platform data; kudos are capped and self-kudos refused; races have minimum qualifiers. See [how scoring works](kb.html?a=how-scoring-works).
- **What leaves our account?** One number a day for billing. See [security and your data](kb.html?a=security-and-data).
- **Can we get the data?** Nightly files to a bucket and a read API. See [warehouse export](kb.html?a=data-export).
- **What does it cost beyond the subscription?** About $15 a month of AWS resources for a 500-agent centre.
