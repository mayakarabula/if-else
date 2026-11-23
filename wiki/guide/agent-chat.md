# Agent chat

A robot **Agent** button opens a chat drawer on every signed-in page. The model receives the current path/page (and rule id when editing) and can create or edit rules, configure integrations, and **create custom HTTP integrations**.

## Setup

Configure under **Integrations → Agent chat**:

- **Provider:** Auto / OpenAI-compatible / Cursor Agent
- OpenAI: API key, base URL, model
- Cursor: uses **`CURSOR_API_KEY` by default** (optional UI override), plus optional model + repo URL

```bash
# backend/.env
CURSOR_API_KEY=...          # default for Cursor Agent chat (+ Cursor integration)
# CHAT_PROVIDER=auto|openai|cursor
# CHAT_API_KEY=sk-...
```

With only `CURSOR_API_KEY` set, Auto picks Cursor. Create a key at [Cursor Dashboard → API Keys](https://cursor.com/dashboard).

## History

Use **History** in the drawer to reopen past sessions. **New chat** starts a fresh thread without deleting history. Sessions are stored in `config/chat-sessions.json`.

## Live UI updates

When the agent mutates a rule or integration, the UI refreshes as tools run (rules list, integrations, and the open rule editor).

## Cursor runs

Cursor allows one active run per agent. if-else waits for (or cancels) a busy run before follow-ups so you should not see `409 Agent already has an active run` during normal use.
