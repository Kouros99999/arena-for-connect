# Getting the data out: warehouse export and the read API

Everything Arena computes per agent per day can leave the stack in two ways, for Databricks, Athena, Snowflake, Power BI or anything else that reads JSON. Both carry the same rows and no customer data.

## The rows

One row per agent per local day:

| Field | Meaning |
|---|---|
| day, team | The local day and the routing profile |
| agentArn, agentId, username, name | Who, as Connect names them |
| points | Points scored that day |
| contactsHandled, avgHandleTimeSeconds, escalations | From the agent event stream |
| evaluations, evaluationAvg, autoFails | From Contact Lens evaluations, if enabled |
| sentimentAvg, surveyAvg | From Contact Lens analysis and surveys, if enabled |
| adherencePct, adherentHours | From schedule adherence, if enabled |
| kudosReceived | Kudos from teammates |

Fields that have nothing to say are `null`, never zero, so averages stay honest.

## Nightly files

Set the stack's `DataExport` setting to `enabled`. The stack creates a private, encrypted bucket, named in the `ExportBucketName` output, and every night writes yesterday's rows there:

```
days/dt=2026-10-09/billing-team.json      newline-delimited JSON, one file per team
manifests/2026-10-09.json                 which files were written and how many rows
```

The `dt=` folder is a Hive-style partition, so Athena, Glue crawlers and Databricks Auto Loader pick the day up as a column. Files for a day are rewritten if the job runs again, with the same content. The bucket keeps 400 days and survives stack deletion.

**Databricks.** Point Auto Loader at `s3://<bucket>/days/` with `cloudFiles.format = json`, and the stream follows the nightly files. **Athena.** Create an external table over `s3://<bucket>/days/` with `dt` as a partition and run `MSCK REPAIR TABLE` or use partition projection.

## The read API

A **data key** lets a warehouse or BI tool pull rows over HTTPS without a sign-in. Supervisors create and revoke them from the **Data** button at the top of the console. A key is shown once; store it in your tool's secret store. Keys expire after a year and can be revoked at any time.

```
GET https://<your site>/api/data/<key>/days?from=2026-09-01&to=2026-09-30&team=Billing%20team
```

`from` and `to` are local days, inclusive, up to 92 days per call; `team` is optional. The response is `{ from, to, rows: [...] }`. A signed-in supervisor can read the same rows at `/api/export/days`.

The key is a credential: anyone holding it can read every team's rows. Treat it like a password, and revoke it if it leaks.

## What is not exported

Kudos notes, coaching plans and the supervisor's private notes, reward requests and challenge standings are not in the export. They are available in the console and, for your own warehouse, in the DynamoDB table in your account.
