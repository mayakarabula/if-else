# Local development

You still need Redis:

```bash
docker compose up redis -d
```

Then in separate terminals:

```bash
cd backend && npm install && npm run dev
cd backend && npm run dev:worker
cd frontend && npm install && npm run dev
```

Set `REDIS_HOST=127.0.0.1` in `backend/.env`.

## Wiki

With Docker Compose the wiki is already on http://localhost:5174. Without Docker:

```bash
npm run wiki
```

Opens VitePress at http://localhost:5174 (see root `package.json`).

## Install everything

```bash
npm run install:all
```
