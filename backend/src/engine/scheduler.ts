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
  type RuleThenClause,
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

async function evaluateClause(
  clause: RuleIfClause,
  clauseStates: Record<string, Record<string, unknown>>,
  integrationConfig: Record<string, Record<string, unknown>>,
  manual?: boolean,
) {
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

  return { key, result };
}

async function evaluateIfBlock(
  ifBlock: ReturnType<typeof normalizeIf>,
  state: RuleState,
  integrationConfig: Record<string, Record<string, unknown>>,
  manual?: boolean,
) {
  const mergedData: Record<string, unknown> = {};
  const clauseStates = { ...state.clauses };

  const conditions = ifBlock.clauses.filter((clause) => !isDataClause(clause));
  const dataClauses = ifBlock.clauses.filter((clause) => isDataClause(clause));

  let fired = ifBlock.mode === "all" ? true : false;

  if (conditions.length === 0) {
    fired = false;
  } else if (ifBlock.mode === "any") {
    fired = false;
    for (const clause of conditions) {
      const { key, result } = await evaluateClause(clause, clauseStates, integrationConfig, manual);
      if (result.state) clauseStates[key] = result.state;
      mergedData[clause.integration] = result.data;
      if (result.fired) fired = true;
    }
  } else {
    for (const clause of conditions) {
      const { key, result } = await evaluateClause(clause, clauseStates, integrationConfig, manual);
      if (result.state) clauseStates[key] = result.state;
      mergedData[clause.integration] = result.data;
      if (!result.fired) {
        fired = false;
        break;
      }
    }
  }

  // Data sources always run when we reach actions (then or else) so templates resolve.
  // For the fired path we gather them here; else path gathers in evaluateRule.
  if (fired) {
    for (const clause of dataClauses) {
      const { key, result } = await evaluateClause(clause, clauseStates, integrationConfig, manual);
      if (result.state) clauseStates[key] = result.state;
      mergedData[clause.integration] = result.data;
    }
  }

  return { fired, data: mergedData, clauses: clauseStates, dataClauses };
}

async function runActions(
  actions: RuleThenClause[],
  integrationConfig: Record<string, Record<string, unknown>>,
  triggerData: Record<string, unknown>,
) {
  for (const clause of actions) {
    const action = getAction(clause.integration, clause.action);
    if (!action) {
      throw new Error(`Unknown action: ${clause.integration}.${clause.action}`);
    }
    await action.execute(clause.config, {
      integrationConfig: integrationConfig[clause.integration] ?? {},
      triggerData,
    });
  }
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
  const elseBlock = normalizeThen(rule.else);
  const integrationConfig = await loadIntegrationConfig();

  for (const clause of [...thenBlock.all, ...elseBlock.all]) {
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
      if (elseBlock.all.length > 0) {
        // Still resolve data sources so else templates can use them.
        const clauseStates = { ...result.clauses };
        const data = { ...result.data };
        for (const clause of result.dataClauses) {
          const { key, result: clauseResult } = await evaluateClause(
            clause,
            clauseStates,
            integrationConfig,
            options?.manual,
          );
          if (clauseResult.state) clauseStates[key] = clauseResult.state;
          data[clause.integration] = clauseResult.data;
        }

        await runActions(elseBlock.all, integrationConfig, data);

        ruleStates.set(rule.id, {
          lastChecked: Date.now(),
          lastFired: Date.now(),
          clauses: clauseStates,
        });

        const run: RunLog = {
          ...base,
          status: "success",
          message:
            elseBlock.all.length === 1
              ? "Else action executed"
              : `${elseBlock.all.length} else actions executed`,
          triggerData: data,
        };
        await appendRun(run);
        return run;
      }

      const run: RunLog = {
        ...base,
        status: "skipped",
        message: "Trigger condition not met",
        triggerData: result.data,
      };
      await appendRun(run);
      return run;
    }

    if (thenBlock.all.length === 0) {
      const run: RunLog = {
        ...base,
        status: "skipped",
        message: "No then actions configured",
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

    await runActions(thenBlock.all, integrationConfig, result.data);

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
