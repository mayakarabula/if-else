import Queue from "bee-queue";
import type { RunLog } from "../store/rules.js";

export interface EvaluateRuleJob {
  ruleId: string;
  manual?: boolean;
}

export const EVALUATE_RULE_QUEUE = "evaluate-rule";

export function redisConnection() {
  return {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379),
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
  };
}

let producer: Queue<EvaluateRuleJob> | null = null;
let workerQueue: Queue<EvaluateRuleJob> | null = null;

/** API / scheduler: enqueue jobs only (no processing). */
export function getProducerQueue(): Queue<EvaluateRuleJob> {
  if (!producer) {
    producer = new Queue<EvaluateRuleJob>(EVALUATE_RULE_QUEUE, {
      redis: redisConnection(),
      isWorker: false,
      getEvents: true,
      sendEvents: true,
      activateDelayedJobs: true,
      removeOnSuccess: true,
      removeOnFailure: false,
    });

    producer.on("error", (err) => {
      console.error("Rule queue error:", err);
    });
  }
  return producer;
}

/** Worker process: claim and run jobs. */
export function getWorkerQueue(): Queue<EvaluateRuleJob> {
  if (!workerQueue) {
    workerQueue = new Queue<EvaluateRuleJob>(EVALUATE_RULE_QUEUE, {
      redis: redisConnection(),
      isWorker: true,
      getEvents: true,
      sendEvents: true,
      activateDelayedJobs: true,
      removeOnSuccess: true,
      removeOnFailure: false,
    });

    workerQueue.on("error", (err) => {
      console.error("Rule worker queue error:", err);
    });
  }
  return workerQueue;
}

export async function waitForQueueReady(queue: Queue<EvaluateRuleJob>) {
  await queue.ready();
}

/** Enqueue without waiting (scheduled polls). */
export async function enqueueRuleEvaluation(job: EvaluateRuleJob): Promise<string> {
  const queue = getProducerQueue();
  const created = queue.createJob(job).retries(2).timeout(120_000);
  await created.save();
  return String(created.id);
}

/** Enqueue and wait for the worker result (manual Run from the UI). */
export function enqueueRuleEvaluationAndWait(job: EvaluateRuleJob): Promise<RunLog> {
  const queue = getProducerQueue();
  const created = queue.createJob(job).retries(1).timeout(120_000);

  return new Promise<RunLog>((resolve, reject) => {
    const onFailed = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onSucceeded = (result: RunLog) => {
      cleanup();
      resolve(result);
    };
    const cleanup = () => {
      created.removeListener("failed", onFailed);
      created.removeListener("succeeded", onSucceeded);
    };

    created.on("failed", onFailed);
    created.on("succeeded", onSucceeded);

    created.save().catch((err: unknown) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export async function closeQueues() {
  const closing: Promise<unknown>[] = [];
  if (producer) {
    closing.push(producer.close(15_000));
    producer = null;
  }
  if (workerQueue) {
    closing.push(workerQueue.close(15_000));
    workerQueue = null;
  }
  await Promise.all(closing);
}
