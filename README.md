# if-else

Simple if-this-then-that automations with a React UI and Node backend.

Rule setup uses a **d3 flow graph**: start from an **IF** node, then branch with **AND** / **OR** conditions and **THEN** / **ELSE** / **CATCH** actions.

## Architecture

- **api** — Express HTTP API + scheduler that *enqueues* due rules
- **worker** — bee-queue consumer that evaluates rules and runs actions
- **redis** — job queue backing store
- **frontend** — Vite + React UI
- **CLI / MCP** — create, read, list, update, and delete rules from the terminal or chat (same YAML store as the UI)
- **Agent chat** — floating assistant on authenticated pages; knows the current route and can manage rules/integrations via tools (including **custom HTTP integrations**)

## Agent chat (in-app)

A robot **Agent** button opens a chat drawer on every signed-in page. It sends the current path/page (and rule id when editing) so the model can create or edit rules and update integration settings in a multi-turn conversation.

Configure under **Integrations → Agent chat** (preferred):

- **Provider:** Auto / OpenAI-compatible / Cursor Agent
- OpenAI: API key, base URL, model
- Cursor: uses **`CURSOR_API_KEY` by default** (optional UI override), plus optional model + repo URL

Env:

```bash
# backend/.env
CURSOR_API_KEY=...          # default for Cursor Agent chat (+ Cursor integration)
# CHAT_PROVIDER=auto|openai|cursor
# CHAT_API_KEY=sk-...
# CHAT_BASE_URL=https://api.openai.com/v1
# CHAT_MODEL=gpt-4o-mini
# CHAT_CURSOR_REPO_URL=https://github.com/org/repo
```

With only `CURSOR_API_KEY` set, Auto picks Cursor.

## CLI

Operates directly on `rules/` + `config/` (set `DATA_ROOT` if those live elsewhere). From the repo root:

```bash
npm run cli -- list
npm run cli -- get <id>
npm run cli -- create --file ./path/to/rule.yaml
npm run cli -- create --body '{"name":"Demo","enabled":true,"if":{"integration":"time","trigger":"every","config":{"interval":"15m"}},"then":{"integration":"telegram","action":"send_message","config":{"text":"hi"}}}'
npm run cli -- update <id> --file ./path/to/rule.yaml
npm run cli -- get <id> --json
npm run cli -- enable <id>
npm run cli -- disable <id>
npm run cli -- delete <id>
npm run cli -- integrations
npm run cli -- runs --limit 20
```

Or from `backend/`: `npm run cli -- …`.

## MCP (chat)

Stdio MCP server for Cursor / other MCP clients — tools: `list_rules`, `get_rule`, `create_rule`, `update_rule`, `delete_rule`, `set_rule_enabled`, `list_integrations`, `list_runs`.

Example Cursor MCP config (absolute paths):

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

## Docker (recommended)

Requires Docker Compose. From the repo root:

```bash
cp backend/.env.example backend/.env
# edit secrets / OAuth as needed

docker compose up --build
```

Services:

| Service   | URL / port        |
|-----------|-------------------|
| Frontend  | http://localhost:5173 |
| API       | http://localhost:3001 |
| Redis     | localhost:6379 |

Rule YAML and integration config are mounted from `./rules` and `./config`.

### Gmail

Configure under **Integrations → Gmail** with your Gmail address and a [Google App Password](https://myaccount.google.com/apppasswords) (2-Step Verification required). Action: **Send an email** (use a Weather SOURCE for report templates).

### Home Assistant

Configure under **Integrations → Home Assistant** with your instance URL and a [long-lived access token](https://www.home-assistant.io/docs/authentication/). Conditions can match entity state; actions can turn entities on/off/toggle or call any service.

### Zigbee (Zigbee2MQTT)

Configure under **Integrations → Zigbee** with your MQTT broker URL (and optional credentials / base topic, default `zigbee2mqtt`). Conditions read device state over MQTT; actions publish to `<device>/set`.

### Google Docs / Sheets

Configure under **Integrations** with an OAuth **refresh token** that includes Docs and/or Sheets scopes. Client ID/secret default to `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Actions can append/create docs and append/update sheet rows; SOURCE nodes can fetch document text or a sheet range.

### Notion

Configure under **Integrations → Notion** with an [internal integration token](https://www.notion.so/my-integrations). Share target pages/databases with the integration. Actions: append paragraph, create page.

### Cursor Agent

Configure under **Integrations → Cursor Agent** with a Cursor API key (or set `CURSOR_API_KEY`). Action: **Launch cloud agent** against a repository via the Cloud Agents API.

### Shell script

Configure optional defaults under **Integrations → Shell script** (working directory, shell, timeout). THEN action **Run script** and SOURCE **Capture script output** accept either **inline code** or a **file path** (templates like `{{weather.report}}` work in the script body/path).

## Local development (without full Docker)

You still need Redis for the queue:

```bash
docker compose up redis -d
```

Then install deps (needed after pulling dependency changes such as `d3`) and run in separate terminals (via `nix-shell` if you use it):

```bash
cd backend && npm install && npm run dev

# Worker
cd backend && npm run dev:worker

# UI
cd frontend && npm install && npm run dev
```

Set `REDIS_HOST=127.0.0.1` in `backend/.env` (see `.env.example`).

## Queue behavior

- Rules can run **on a timer** (default), via a **webhook URL** (`GET|POST /api/hooks/:token`), or stay **paused**
- Timer cadence comes from a **Time → Every** If condition (e.g. `15m`); without one, rules default to `15m`. The API ticks every 30s and enqueues due timer rules (webhook rules are skipped)
- Rules with **Time → Every day at** check every 30s so the scheduled minute is not missed
- Manual **Run** and webhook calls enqueue a job and wait for the worker result
- Workers process with concurrency `WORKER_CONCURRENCY` (default 2)
- **Arena** dashboard at [/arena](http://localhost:5173/arena) (proxied; requires login)
