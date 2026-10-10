# Customer sentiment and survey scores

Evaluations cover only the few contacts a reviewer gets to. Two more signals cover the rest, and both count as quality in the scoring mix. Neither ever deducts points: customers are sometimes unhappy for reasons no agent controls.

## Customer sentiment from Contact Lens

Contact Lens conversational analytics writes one analysis file per contact to an S3 bucket, usually the same bucket as call recordings. Arena reads the customer's overall sentiment from it, on a scale of -5 to +5, and scores it.

To turn it on:

1. On the stack's launch page, or by updating the stack later, set **AnalysisBucket** to that bucket's name. Leave **AnalysisPrefix** at `Analysis/` unless you changed where Connect writes.
2. In the S3 console, open the bucket's **Properties** and turn on **Amazon EventBridge** notifications. Arena is told about each new analysis file this way.

Each analysed contact scores once, for the agent who handled it. If the analysis arrives before the agent event that names the handler, Arena retries for up to an hour.

An agent whose average sentiment stays at or below -1 across five or more analysed contacts is flagged in the console, so a run of difficult calls gets a conversation rather than a penalty.

## Survey scores

If your post-contact survey writes the customer's answer to a contact attribute, Arena can score it:

1. In the Connect console, under **Data streaming**, send **Contact records** to the same Kinesis stream as the agent events.
2. Set the stack's **CsatAttribute** to the attribute's name. The default is `csat`.

Answers on a 1 to 5 scale are used as they are. 0 to 10 scales are halved and 0 to 100 scales divided by 20, so a 9 of 10 counts as 4.5.

### Survey tools outside Connect

A supervisor's sign-in can post a score directly, which suits survey tools that run outside Connect. Replace the placeholders:

```bash
curl -X POST "<ApiUrl>/teams/<team>/metrics" -H "authorization: Bearer <supervisor token>" \
  -d '{"agentId":"<agent ARN>","metric":"csat","score":5,"contactId":"<contact id>"}'
```

`metric` may be `csat` (1 to 5) or `sentiment` (-5 to 5). Including the contact id makes repeats harmless: the same contact scores once.

## Where they show

- A team tile in the console, with the survey average beside it.
- Sentiment and survey columns in the console leaderboard.
- Tiles in the agent panel.
- Measures in the [results report](kb.html?a=results-report), with their change against the previous period.
