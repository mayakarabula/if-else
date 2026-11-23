# Custom HTTP integrations

Ask Agent chat to add a service that is not built-in (Discord webhook, Slack, arbitrary REST API). The agent uses `create_integration` and stores the definition in `config/custom-integrations.yaml`.

## What you get

- Appears in **Integrations** with a **Custom** tag
- `configFields` for secrets (e.g. webhook URL)
- HTTP **actions** and optional **triggers** (condition or data SOURCE)
- Templates: <code v-pre>{{config.field}}</code>, action field keys, trigger paths like <code v-pre>{{weather.temp}}</code>

## Example shape

```yaml
discord:
  name: Discord
  icon: discord
  color: "#5865F2"
  description: Post to a Discord webhook
  configFields:
    - key: webhookUrl
      label: Webhook URL
      type: text
      required: true
  actions:
    - id: send_message
      label: Send message
      fields:
        - key: content
          label: Content
          type: textarea
          required: true
      request:
        method: POST
        url: "{{config.webhookUrl}}"
        headers:
          Content-Type: application/json
        body: '{"content":"{{content}}"}'
```

After create, set the webhook under **Integrations → Discord** (or have the agent call `update_integration_config`), then use it in a rule’s Then / Catch.

## Chat tools

- `create_integration` / `update_integration` / `get_custom_integration` / `delete_integration`
- Built-in ids are reserved and cannot be overwritten
