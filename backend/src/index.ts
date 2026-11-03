import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import { authRouter } from "./auth/routes.js";
import { requireAuth, requireAuthPage } from "./auth/middleware.js";
import { configurePassport } from "./auth/passport.js";
import { integrationsRouter, rulesRouter, runsRouter } from "./api/routes.js";
import { createArenaMiddleware } from "./engine/arena.js";
import { getProducerQueue, waitForQueueReady } from "./engine/queue.js";
import { startScheduler } from "./engine/scheduler.js";
import { ensureDirs } from "./store/rules.js";

const PORT = Number(process.env.PORT ?? 3001);
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-session-secret-change-me";

async function main() {
  await ensureDirs();
  configurePassport();

  const queue = getProducerQueue();
  await waitForQueueReady(queue);

  const app = express();

  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: FRONTEND_URL,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      queue: queue.isRunning() ? "up" : "down",
      redis: `${process.env.REDIS_HOST ?? "127.0.0.1"}:${process.env.REDIS_PORT ?? 6379}`,
      arena: "/arena",
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/rules", requireAuth, rulesRouter);
  app.use("/api/integrations", requireAuth, integrationsRouter);
  app.use("/api/runs", requireAuth, runsRouter);

  // Bee-Queue dashboard (login required)
  app.use("/arena", requireAuthPage, createArenaMiddleware());

  app.listen(PORT, () => {
    console.log(`if-else backend listening on http://localhost:${PORT}`);
    console.log(`Arena dashboard at http://localhost:${PORT}/arena`);
    startScheduler();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
