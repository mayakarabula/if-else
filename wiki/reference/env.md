# Environment variables

Copy `backend/.env.example` → `backend/.env`. Docker Compose loads that file into the API (and related vars into services).

| Variable | Purpose |
| -------- | ------- |
| `DATA_ROOT` | Root for `rules/` + `config/` (Docker: `/data`) |
| `REDIS_HOST` / `REDIS_PORT` | Queue |
| `SESSION_SECRET` | Cookie sessions |
| `FRONTEND_URL` | CORS + OAuth redirects |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google login + Docs/Sheets |
| `CURSOR_API_KEY` | Cursor Agent chat + Cursor integration |
| `CHAT_PROVIDER` | `auto` \| `openai` \| `cursor` |
| `CHAT_API_KEY` / `CHAT_BASE_URL` / `CHAT_MODEL` | OpenAI-compatible chat |
| `CHAT_CURSOR_REPO_URL` / `CHAT_CURSOR_MODEL` | Optional Cursor chat defaults |
| `WORKER_CONCURRENCY` | Parallel rule evaluations |
| `PORT` | API port (default `3001`) |
