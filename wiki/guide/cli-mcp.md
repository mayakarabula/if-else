# CLI & MCP

Both operate on the same `rules/` + `config/` store as the UI. Set `DATA_ROOT` if those live elsewhere.

## CLI

From the repo root:

```bash
npm run cli -- list
npm run cli -- get <id>
npm run cli -- create --file ./path/to/rule.yaml
npm run cli -- create --body '{"name":"Demo","enabled":true,"if":{"integration":"time","trigger":"every","config":{"interval":"15m"}},"action":{"integration":"telegram","action":"send_message","config":{"text":"hi"}},"catch":{"integration":"telegram","action":"send_message","config":{"text":"failed"}}}'
npm run cli -- update <id> --file ./path/to/rule.yaml
npm run cli -- get <id> --json
npm run cli -- enable <id>
npm run cli -- disable <id>
npm run cli -- delete <id>
npm run cli -- integrations
npm run cli -- runs --limit 20
```

Or from `backend/`: `npm run cli -- …`.

## MCP (stdio)

Tools: `list_rules`, `get_rule`, `create_rule`, `update_rule`, `delete_rule`, `set_rule_enabled`, `list_integrations`, `list_runs`.

Example Cursor MCP config:

```json
{
  "mcpServers": {
    "if-else": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/if-else/backend",
      "env": {
        "DATA_ROOT": "/absolute/path/to/if-else"
      }
    }
  }
}
```

Call `list_integrations` before creating rules so the model uses valid trigger/action ids and field schemas.
