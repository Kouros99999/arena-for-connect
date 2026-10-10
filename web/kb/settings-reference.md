# Settings reference

These are the settings on the stack's launch page. Change any of them later by updating the stack in the CloudFormation console. Settings filled in by the registration page are marked.

## Connect and data feeds

| Setting | Default | What it does |
|---|---|---|
| ConnectInstanceUrl | empty | Your Connect instance's access URL, so only that instance may frame the agent panel. Empty allows any Connect instance. |
| EvaluationsBucket | empty | Bucket where Connect writes Contact Lens evaluations. Turns on evaluation scoring. Enable EventBridge notifications on the bucket. |
| EvaluationsPrefix | `Evaluations/` | Key prefix for evaluation files. |
| AnalysisBucket | empty | Bucket where Contact Lens writes conversational analytics. Turns on customer sentiment scoring. Enable EventBridge notifications on the bucket. |
| AnalysisPrefix | `Analysis/` | Key prefix for analysis files. |
| CsatAttribute | `csat` | Contact attribute your survey writes. Used only if contact records are sent to the Arena stream. |
| ShardCount | 1 | Kinesis shards. One handles thousands of agents. |

## People and display

| Setting | Default | What it does |
|---|---|---|
| DefaultTeam | empty | Team the console and wallboard open on for a user with no team attribute. |
| WallboardNames | `full` | How names appear on sign-in-free wallboards: `full`, `first` or `initials`. |
| KudosDailyLimit | 5 | Kudos one person may send per day. |

## Sign-in

| Setting | Default | What it does |
|---|---|---|
| AuthMode | `cognito` | `cognito` creates a user pool in the stack. `external` uses your identity provider. |
| JwtIssuer | empty | External mode only. Your provider's issuer URL. |
| JwtAudience | empty | External mode only. The client id expected in tokens. |
| AllowedOrigin | `*` | Origin allowed to call the API. Set it to your `SiteUrl` after launch to lock it down. |

## Operations

| Setting | Default | What it does |
|---|---|---|
| AlarmEmail | empty | Email that receives alarms: ingest errors, the stream falling behind, API errors, a failed usage report. Confirm the subscription email AWS sends. |

## Filled in by the registration page

| Setting | What it does |
|---|---|
| MarketplaceProductCode | Identifies Arena to AWS Marketplace billing. |
| MarketplaceLicenseArn | Your subscription's license. Usage is reported against it. |
| MarketplaceCustomerAccountId | The AWS account that subscribed. |
| SiteArchiveUrl | The pages for this release. The stack installs them itself. |

Leave these four as the registration page set them. For a pilot outside Marketplace, leave the three Marketplace settings empty and nothing is reported.
