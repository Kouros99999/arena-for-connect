# The results report

The report answers one question: is this working? Open it from **Results report** in the console. Supervisors only.

## Reading it

Pick a period: the last 7, 14, 30 or 90 days. The report compares it with the same number of days before.

- **Headline**: one sentence on how the evaluation average moved.
- **Tiles**: evaluation average, customer sentiment, survey score, auto-fails, escalation rate, handle time, contacts and points, each with its change against the earlier period. Up and down are marked in words as well as colour.
- **Chart**: one measure by day, with the earlier period's average as a dashed line. Choose the measure above the chart. Hover for the day's value. The same figures are in a table under the chart.
- **Agents**: every agent's points, contacts, evaluation average now and before, change, sentiment, survey, auto-fails and days active.
- **Coaching**: every plan with the evaluation average before and after, and the average change across closed plans.

Evaluation averages leave out auto-fails, which are counted separately. Days are in UTC.

## Sharing it

- **Download CSV** gives the daily figures and the agent table.
- **Print** uses a layout without the controls, which also works for saving as a PDF.

## When it is empty

A new install has no history, so the report compares nothing until Arena has recorded enough days. The 30-day view needs 60 days for a comparison. The tiles say "no earlier period yet" until then.
