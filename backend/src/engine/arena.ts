import Arena from "bull-arena";
import BeeQueue from "bee-queue";
import type { RequestHandler } from "express";
import { EVALUATE_RULE_QUEUE, redisConnection } from "./queue.js";

/** Mount Bee-Queue Arena UI under `/arena` (caller applies auth + path). */
export function createArenaMiddleware(): RequestHandler {
  return Arena(
    {
      Bee: BeeQueue,
      queues: [
        {
          type: "bee",
          name: EVALUATE_RULE_QUEUE,
          hostId: "if-else",
          redis: redisConnection(),
        },
      ],
    },
    {
      // Mounted via app.use('/arena', …) so links resolve under that baseUrl.
      disableListen: true,
    },
  );
}
