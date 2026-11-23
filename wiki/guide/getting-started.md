# Getting started

## Docker (recommended)

```bash
cp backend/.env.example backend/.env
# edit secrets / OAuth / CURSOR_API_KEY as needed

docker compose up --build
```

| Service  | URL / port            |
| -------- | --------------------- |
| Frontend | http://localhost:5173 |
| Wiki     | http://localhost:5174 |
| API      | http://localhost:3001 |
| Redis    | localhost:6379        |

Rule YAML and integration config are mounted from `./rules` and `./config`.

## First hour checklist

1. Open the UI and sign in (Google OAuth if configured).
2. Visit **Integrations** — configure at least one action target (e.g. Telegram) or set `CURSOR_API_KEY` for Agent chat.
3. Create a rule on **/create**: add an **IF** (e.g. Time → Every `15m`), a **THEN**, and fill the auto-added **CATCH**.
4. Enable the rule and watch **Activity** / Arena for runs.

## This wiki

Included in `docker compose up` at http://localhost:5174. Locally without Docker:

```bash
npm run wiki          # http://localhost:5174
npm run wiki:build    # static site in wiki/.vitepress/dist
```

Docs live in [`wiki/`](https://github.com/mayakarabula/if-else/tree/main/wiki) and are built with [VitePress](https://vitepress.dev/).
