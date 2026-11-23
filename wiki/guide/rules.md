# Rules & graph editor

Rules are if-this-then-that documents stored as YAML. The UI edits them as a **d3 flow graph**.

## Node kinds

| Kind | Role |
| ---- | ---- |
| **EVENT** | Start node for event-driven rules (HTTP webhook or Home Assistant websocket) |
| **IF / AND / OR** | Conditions / filters (AND = all, OR = any). Optional under EVENT |
| **SOURCE** | Data for templates (e.g. weather report) — does not gate the rule |
| **ACTION** | Actions when conditions pass (or when an event fires with no IF) |
| **ELSE** | Actions when conditions fail |
| **CATCH** | Actions when a trigger or action throws |

**Action always gets a Catch.** Adding Action auto-adds an empty Catch under that Action (error edge). You can also add Catch from an Action/Else node’s “+” menu, or once under IF when none exists yet. You cannot remove the last Catch while Action exists. Configure Catch with <code v-pre>{{error.message}}</code> (and other <code v-pre>{{error.*}}</code> fields).

## Run modes

When enabled, a rule runs as:

- **Timer** (default) — polled; cadence from **Time → Every** (else `15m`); graph starts at **IF**
- **Event** — starts at **EVENT**; fires from an HTTP webhook (`GET|POST /api/hooks/:token`) or a Home Assistant websocket message. Payload is available as <code v-pre>{{event.*}}</code>
- **Paused** — `enabled: false`

YAML uses `runTrigger: event` (legacy `webhook` still loads) and prefers `action:` over legacy `then:`.

Manual **Run** in the UI enqueues a job and waits for the worker.

## Templates

Action and script fields interpolate trigger data, e.g. <code v-pre>{{weather.report}}</code>, <code v-pre>{{error.message}}</code> on Catch, <code v-pre>{{event.body}}</code> for webhooks.

## Tips

- Prefer one clear IF path; use SOURCE under Action when you need data only for the success branch.
- After Agent chat edits a rule, the open editor reloads automatically.
