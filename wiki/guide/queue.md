# Queue & runs

- Rules run on a **timer**, via a **webhook**, or stay **paused**
- Timer cadence comes from **Time → Every** (e.g. `15m`); without one, default is `15m`
- The API ticks every **30s** and enqueues due timer rules (webhook rules are skipped)
- **Time → Every day at** also checks every 30s so the scheduled minute is not missed
- Manual **Run** and webhook calls enqueue a job and wait for the worker result
- Worker concurrency: `WORKER_CONCURRENCY` (default `2`)
- **Arena** dashboard at [/arena](http://localhost:5173/arena) (proxied; requires login)

Webhook shape: `GET|POST /api/hooks/:token` where `token` is the rule’s `webhookToken`.
