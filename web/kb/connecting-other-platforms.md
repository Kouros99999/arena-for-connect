# Connecting other platforms, and switching without losing history

Arena scores from six plain events. Amazon Connect produces them from its agent event stream and Contact Lens files. Any other platform, or a piece of middleware you run, can produce the same events through the **ingest endpoint**, and everything above that layer, from points to the pages, is the same.

## The ingest endpoint

Supervisors create an **ingest key** from the console's Data button; it is shown once. Then:

```
POST https://<your site>/api/ingest/<key>/events
content-type: application/json

{ "events": [
  { "type": "CONTACT_HANDLED", "agent": "user-42", "at": "2026-10-09T14:03:00Z", "contactId": "c-1", "handleTime": 312, "queue": "Billing", "team": "Billing team", "name": "Priya N" },
  { "type": "EVALUATION_SUBMITTED", "agent": "user-42", "evaluationId": "e-77", "score": 92 }
] }
```

Up to 500 events per call. The response says how many were accepted, how many were duplicates, and which were rejected and why. Sending the same event twice is safe: contacts, evaluations, sentiment, surveys and adherence carry their own identity.

| type | fields |
|---|---|
| CONTACT_HANDLED | `contactId`, `handleTime` in seconds, optional `queue`, `channel`, `escalated` |
| EVALUATION_SUBMITTED | `evaluationId`, `score` 0 to 100 or `autoFail: true`, optional `form`, `reason` |
| SENTIMENT_SCORED | `contactId`, `sentiment` from -5 to 5 |
| CSAT_RECEIVED | `contactId`, `score` on a 1 to 5, 0 to 10 or 0 to 100 scale |
| ADHERENCE_SCORED | `day` as YYYY-MM-DD, `adherence` percent, `adherentHours`, optional `scheduledHours` |
| AGENT_STATE_CHANGE | `state` |

Every event takes `agent` (the platform's id for the person), optional `at` (ISO time, defaults to now), and optional `team`, `username` and `name`. The first event for a new person creates them; `team` is the routing profile or group name the console will show.

## Keeping a person's history when their id changes

A person is keyed by whatever id first fed them. When contacts start arriving under a new id, because you moved platforms or run two, open **People** in the console, choose the person, and **link** the new id. From then on events under the new id land on the same record, and their points, streaks, personal bests, coaching plans and rewards continue. Rows written before the link under the new id stay where they are; link before the switch and there are none.

## Switching providers

1. Set up the new platform's feed: a native connector when one exists, or the ingest endpoint fed by your middleware or the platform's webhooks.
2. In People, link each person's new id to their existing record. The export rows and the People list give you the current ids; the new platform gives you the new ones.
3. Register the agent panel in the new platform's agent desktop, as you did in the Connect agent workspace.
4. Switch the feeds over. Nothing in the console, the report, the wallboard or the agent panel changes.

The stack's `Provider` setting records which platform feeds it; it changes wording in the console and nothing else. The Connect feeds stay available alongside the endpoint, so a centre can run both during a migration.

## What a platform needs to offer

Per-contact events with the handling agent and handle time, for points. Optionally evaluation scores, sentiment per contact, survey scores and daily adherence, each of which adds a point source. A way to embed a web page in the agent desktop, so agents see the panel. Genesys Cloud, Five9, NICE CXone and Talkdesk offer all of these through their APIs; the help center's security article explains what Arena stores.
