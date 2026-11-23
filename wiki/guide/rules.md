# Rules & graph editor

Rules are if-this-then-that documents stored as YAML. The UI edits them as a **d3 flow graph**.

## Node kinds

| Kind | Role |
| ---- | ---- |
| **IF / AND / OR** | Conditions (AND = all, OR = any) |
| **SOURCE** | Data for templates (e.g. weather report) — does not gate the rule |
| **THEN** | Actions when conditions pass |
| **ELSE** | Actions when conditions fail |
| **CATCH** | Actions when a trigger or action throws |

**Then always gets a Catch.** Adding Then auto-adds an empty Catch node; you cannot remove the last Catch while Then exists. Configure Catch to notify yourself with <code v-pre>{{error.message}}</code> (and other <code v-pre>{{error.*}}</code> fields).

## Run modes

When enabled, a rule runs as:

- **Timer** (default) — polled; cadence from **Time → Every** (else `15m`)
- **Webhook** — only via `GET|POST /api/hooks/:token`
- **Paused** — `enabled: false`

Manual **Run** in the UI enqueues a job and waits for the worker.

## Templates

Action and script fields interpolate trigger data, e.g. <code v-pre>{{weather.report}}</code>, <code v-pre>{{error.message}}</code> on Catch.

## Tips

- Prefer one clear IF path; use SOURCE under Then when you need data only for the success branch.
- After Agent chat edits a rule, the open editor reloads automatically.
