import { v4 as uuidv4 } from "uuid";
import { getAction, getTrigger } from "../integrations/registry.js";
import { enqueueRuleEvaluation } from "./queue.js";
import { clauseKey, normalizeIf, normalizeThen, ruleHasTimeTrigger, rulePollInterval } from "./normalize.js";
import {
  appendRun,
  loadIntegrationConfig,
  listRules,
  type Rule,
  type RuleIfClause,
  type RunLog,
} from "../store/rules.js";

interface RuleState {
  lastChecked: number;
  lastFired?: number;
  clauses: Record<string, Record<string, unknown>>;
}

const ruleStates = new Map<string, RuleState>();
const COOLDOWN_MS = 5 * 60 * 1000;

function isDataClause(clause: RuleIfClause): boolean {
  const trigger = getTrigger(clause.integration, clause.trigger);
  return trigger?.kind === "data";
}

async function evaluateIfBlock(
  ifBlock: ReturnType<typeof normalizeIf>,
  state: RuleState,
  integrationConfig: Record<string, Record<string, unknown>>,
  manual?: boolean,
) {
  const mergedData: Record<string, unknown> = {};
  const clauseStates = { ...state.clauses };

  const conditions = ifBlock.all.filter((clause) => !isDataClause(clause));
  const dataClauses = ifBlock.all.filter((clause) => isDataClause(clause));

  for (const clause of conditions) {
    const trigger = getTrigger(clause.integration, clause.trigger);
    if (!trigger) {
      throw new Error(`Unknown trigger: ${clause.integration}.${clause.trigger}`);
    }

    const key = clauseKey(clause);
    const result = await trigger.evaluate(clause.config, {
      integrationConfig: integrationConfig[clause.integration] ?? {},
      lastState: clauseStates[key],
      manual,
    });

    if (result.state) {
      clauseStates[key] = result.state;
    }

    mergedData[clause.integration] = result.data;

    if (!result.fired) {
      return { fired: false, data: mergedData, clauses: clauseStates };
    }
  }

  for (const clause of dataClauses) {
    const trigger = getTrigger(clause.integration, clause.trigger);
    if (!trigger) {
      throw new Error(`Unknown trigger: ${clause.integration}.${clause.trigger}`);
    }

    const key = clauseKey(clause);
    const result = await trigger.evaluate(clause.config, {
      integrationConfig: integrationConfig[clause.integration] ?? {},
      lastState: clauseStates[key],
      manual,
    });

    if (result.state) {
      clauseStates[key] = result.state;
    }

    mergedData[clause.integration] = result.data;
  }

  return { fired: true, data: mergedData, clauses: clauseStates };
}

/** Evaluate a rule immediately (worker). Prefer enqueueing via the queue from the API. */
export async function evaluateRule(rule: Rule, options?: { manual?: boolean }): Promise<RunLog> {
  const base: Omit<RunLog, "status" | "message"> = {
    id: uuidv4(),
    ruleId: rule.id,
    ruleName: rule.name,
    timestamp: new Date().toISOString(),
  };

  if (!rule.enabled && !options?.manual) {
    const run: RunLog = { ...base, status: "skipped", message: "Rule is disabled" };
    await appendRun(run);
    return run;
  }

  const ifBlock = normalizeIf(rule.if);
  const thenBlock = normalizeThen(rule.then);
  const integrationConfig = await loadIntegrationConfig();

  for (const clause of thenBlock.all) {
    if (!getAction(clause.integration, clause.action)) {
      const run: RunLog = {
        ...base,
        status: "error",
        message: `Unknown action: ${clause.integration}.${clause.action}`,
      };
      await appendRun(run);
      return run;
    }
  }

  try {
    const state = ruleStates.get(rule.id) ?? { lastChecked: 0, clauses: {} };
    const result = await evaluateIfBlock(ifBlock, state, integrationConfig, options?.manual);

    ruleStates.set(rule.id, {
      lastChecked: Date.now(),
      lastFired: state.lastFired,
      clauses: result.clauses,
    });

    if (!result.fired) {
      const run: RunLog = {
        ...base,
        status: "skipped",
        message: "Trigger condition not met",
        triggerData: result.data,
      };
      await appendRun(run);
      return run;
    }

    const skipCooldown = options?.manual || ruleHasTimeTrigger(rule.if);
    if (!skipCooldown && state.lastFired && Date.now() - state.lastFired < COOLDOWN_MS) {
      const run: RunLog = {
        ...base,
        status: "skipped",
        message: "Cooldown active",
        triggerData: result.data,
      };
      await appendRun(run);
      return run;
    }

    for (const clause of thenBlock.all) {
      const action = getAction(clause.integration, clause.action)!;
      await action.execute(clause.config, {
        integrationConfig: integrationConfig[clause.integration] ?? {},
        triggerData: result.data,
      });
    }

    ruleStates.set(rule.id, {
      lastChecked: Date.now(),
      lastFired: Date.now(),
      clauses: result.clauses,
    });

    const actionCount = thenBlock.all.length;
    const run: RunLog = {
      ...base,
      status: "success",
      message: actionCount === 1 ? "Action executed" : `${actionCount} actions executed`,
      triggerData: result.data,
    };
    await appendRun(run);
    return run;
  } catch (err) {
    const run: RunLog = {
      ...base,
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
    await appendRun(run);
    return run;
  }
}

/** Mark due rules and push evaluate jobs onto the Redis queue. */
export async function enqueueDueRules() {
  const rules = await listRules();
  const now = Date.now();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const state = ruleStates.get(rule.id) ?? { lastChecked: 0, clauses: {} };
    const interval = rulePollInterval(rule.if);

    if (now - state.lastChecked < interval) continue;

    // Reserve the slot on the API process so we don't re-enqueue every 30s while a job is pending.
    ruleStates.set(rule.id, {
      ...state,
      lastChecked: now,
    });

    await enqueueRuleEvaluation({ ruleId: rule.id });
  }
}

export function startScheduler() {
  const tick = () => {
    enqueueDueRules().catch((err) => {
      console.error("Scheduler enqueue error:", err);
    });
  };

  tick();
  setInterval(tick, 30_000);
  console.log("Rule scheduler started (enqueues due rules every 30s)");
}
