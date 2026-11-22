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

### Gmail

Configure under **Integrations → Gmail** with your Gmail address and a [Google App Password](https://myaccount.google.com/apppasswords) (2-Step Verification required). Action: **Send an email** (use a Weather SOURCE for report templates).

### Home Assistant

Configure under **Integrations → Home Assistant** with your instance URL and a [long-lived access token](https://www.home-assistant.io/docs/authentication/). Conditions can match entity state; actions can turn entities on/off/toggle or call any service.

### Zigbee (Zigbee2MQTT)

Configure under **Integrations → Zigbee** with your MQTT broker URL (and optional credentials / base topic, default `zigbee2mqtt`). Conditions read device state over MQTT; actions publish to `<device>/set`.

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
- Every 30s the API enqueues enabled timer rules whose poll interval has elapsed (webhook rules are skipped)
- Manual **Run** and webhook calls enqueue a job and wait for the worker result
- Workers process with concurrency `WORKER_CONCURRENCY` (default 2)
- **Arena** dashboard at [/arena](http://localhost:5173/arena) (proxied; requires login)
