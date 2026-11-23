import "dotenv/config";
import { getWorkerQueue, waitForQueueReady } from "./engine/queue.js";
import { evaluateRule } from "./engine/scheduler.js";
import { reloadCustomIntegrations } from "./integrations/registry.js";
import { ensureDirs, loadRule } from "./store/rules.js";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 2);

async function main() {
  await ensureDirs();
  await reloadCustomIntegrations();

  const queue = getWorkerQueue();
  await waitForQueueReady(queue);

  queue.process(CONCURRENCY, async (job) => {
    const { ruleId, manual } = job.data;
    console.log(`Processing rule ${ruleId} (job ${job.id}${manual ? ", manual" : ""})`);

    // Pick up custom integrations created while the worker is running.
    await reloadCustomIntegrations();

    const rule = await loadRule(ruleId);
    if (!rule) {
      throw new Error(`Rule not found: ${ruleId}`);
    }

    return evaluateRule(rule, { manual: Boolean(manual) });
  });

  console.log(
    `if-else worker ready (queue=evaluate-rule, concurrency=${CONCURRENCY}, redis=${process.env.REDIS_HOST ?? "127.0.0.1"}:${process.env.REDIS_PORT ?? 6379})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
