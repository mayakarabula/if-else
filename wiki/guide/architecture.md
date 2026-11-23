# Architecture

if-else splits scheduling from execution so the API stays responsive while workers run integrations.

```
┌────────────┐     enqueue      ┌─────────┐     jobs      ┌────────┐
│  api +     │ ───────────────► │  redis  │ ───────────► │ worker │
│  scheduler │                  └─────────┘              └────────┘
└────────────┘                         ▲
       ▲                               │
       │ REST                          │ bee-queue
       ▼                               │
┌────────────┐                   rules/ + config/
│  frontend  │                   (YAML / JSON on disk)
└────────────┘
```

| Piece        | Role |
| ------------ | ---- |
| **api**      | Express HTTP API, auth, chat, scheduler that *enqueues* due rules |
| **worker**   | bee-queue consumer — evaluates IF / runs THEN·ELSE·CATCH |
| **redis**    | Queue backing store |
| **frontend** | Vite + React UI (graph editor, integrations, activity) |
| **CLI / MCP**| Same YAML store as the UI |
| **Agent chat** | In-app tools over rules + integrations (including custom HTTP) |

## Data on disk

Under `DATA_ROOT` (repo root by default, `/data` in Docker):

- `rules/*.yaml` — automation documents
- `config/integrations.yaml` — secrets and settings per integration id
- `config/custom-integrations.yaml` — AI/user-defined HTTP integrations
- `config/chat-sessions.json` — agent chat history
- `config/runs.json` — recent run log

See [Data layout](/reference/data).
