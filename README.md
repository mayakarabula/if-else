# if-else

Simple if-this-then-that automations with a React UI and Node backend.

Rule setup uses a **d3 flow graph**: start from an **IF** node, then branch with **AND** / **OR** conditions and **THEN** / **ELSE** / **CATCH** actions.

## Architecture

- **api** — Express HTTP API + scheduler that *enqueues* due rules
- **worker** — bee-queue consumer that evaluates rules and runs actions
- **redis** — job queue backing store
- **frontend** — Vite + React UI

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

- Every 30s the API enqueues enabled rules whose poll interval has elapsed
- Manual **Run** enqueues a job and waits for the worker result
- Workers process with concurrency `WORKER_CONCURRENCY` (default 2)
- **Arena** dashboard at [/arena](http://localhost:5173/arena) (proxied; requires login)
