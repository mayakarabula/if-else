import { v4 as uuidv4 } from "uuid";
import { IntegrationError, toCatchErrorPayload } from "../integrations/errors.js";
import { getAction, getTrigger } from "../integrations/registry.js";
import { enqueueRuleEvaluation } from "./queue.js";
import { evaluateFilters, normalizeFilters } from "./filters.js";
import { clauseKey, normalizeIf, normalizeThen, ruleHasTimeTrigger, rulePollInterval } from "./normalize.js";
import {
  appendRun,
  isEventRunTrigger,
  loadIntegrationConfig,
  listRules,
  ruleActionBlock,
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
    throw new IntegrationError({
      message: `Unknown trigger: ${clause.integration}.${clause.trigger}`,
      code: "engine.unknown_trigger",
      integration: clause.integration,
      step: clause.trigger,
      stepLabel: clause.trigger,
      kind: "trigger",
      plan: [],
    });
  }

  const key = clauseKey(clause);
  try {
    const result = await trigger.evaluate(clause.config, {
      integrationConfig: integrationConfig[clause.integration] ?? {},
      lastState: clauseStates[key],
      manual,
    });
    return { key, result };
  } catch (err) {
    if (err instanceof IntegrationError) throw err;
    throw new IntegrationError({
      message: err instanceof Error ? err.message : "Trigger evaluation failed",
      code: "engine.trigger_failed",
      integration: clause.integration,
      step: trigger.id,
      stepLabel: trigger.label,
      kind: "trigger",
      plan: trigger.actionPlan,
    });
  }
}

async function evaluateIfBlock(
  ifBlock: ReturnType<typeof normalizeIf>,
  state: RuleState,
  integrationConfig: Record<string, Record<string, unknown>>,
  options?: { manual?: boolean; emptyIfPasses?: boolean },
) {
  const manual = options?.manual;
  const mergedData: Record<string, unknown> = {};
  const clauseStates = { ...state.clauses };

  const conditions = ifBlock.clauses.filter((clause) => !isDataClause(clause));
  const dataClauses = ifBlock.clauses.filter((clause) => isDataClause(clause));

  let fired = ifBlock.mode === "all" ? true : false;

  if (conditions.length === 0) {
    // Event-driven rules may omit IF filters and run actions on every event.
    fired = Boolean(options?.emptyIfPasses);
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
      throw new IntegrationError({
        message: `Unknown action: ${clause.integration}.${clause.action}`,
        code: "engine.unknown_action",
        integration: clause.integration,
        step: clause.action,
        stepLabel: clause.action,
        kind: "action",
        plan: [],
      });
    }
    try {
      await action.execute(clause.config, {
        integrationConfig: integrationConfig[clause.integration] ?? {},
        triggerData,
      });
    } catch (err) {
      if (err instanceof IntegrationError) throw err;
      throw new IntegrationError({
        message: err instanceof Error ? err.message : "Action execution failed",
        code: "engine.action_failed",
        integration: clause.integration,
        step: action.id,
        stepLabel: action.label,
        kind: "action",
        plan: action.actionPlan,
      });
    }
  }
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Unknown error";
}

/** Evaluate a rule immediately (worker). Prefer enqueueing via the queue from the API. */
export async function evaluateRule(
  rule: Rule,
  options?: { manual?: boolean; eventPayload?: Record<string, unknown> },
): Promise<RunLog> {
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
  const thenBlock = normalizeThen(ruleActionBlock(rule));
  const elseBlock = normalizeThen(rule.else);
  const catchBlock = normalizeThen(rule.catch);
  const integrationConfig = await loadIntegrationConfig();
  const emptyIfPasses = isEventRunTrigger(rule.runTrigger) || Boolean(options?.eventPayload);

  for (const clause of [...thenBlock.all, ...elseBlock.all, ...catchBlock.all]) {
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

  let lastTriggerData: Record<string, unknown> = {};

  try {
    const state = ruleStates.get(rule.id) ?? { lastChecked: 0, clauses: {} };
    const result = await evaluateIfBlock(ifBlock, state, integrationConfig, {
      manual: options?.manual,
      emptyIfPasses,
    });
    if (options?.eventPayload) {
      result.data.event = options.eventPayload;
    }
    const filters = normalizeFilters(rule.filters);
    const filtersPass = evaluateFilters(filters, result.data);
    const fired = result.fired && filtersPass;
    lastTriggerData = result.data;

    ruleStates.set(rule.id, {
      lastChecked: Date.now(),
      lastFired: state.lastFired,
      clauses: result.clauses,
    });

    if (!fired) {
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
        lastTriggerData = data;

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
        message: filtersPass ? "Trigger condition not met" : "Filter condition not met",
        triggerData: result.data,
      };
      await appendRun(run);
      return run;
    }

    if (thenBlock.all.length === 0) {
      const run: RunLog = {
        ...base,
        status: "skipped",
        message: "No actions configured",
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
    const message = errorMessage(err);
    const triggerData = {
      ...lastTriggerData,
      error: toCatchErrorPayload(err),
    };

    if (catchBlock.all.length > 0) {
      try {
        await runActions(catchBlock.all, integrationConfig, triggerData);
        const run: RunLog = {
          ...base,
          status: "error",
          message: `Caught error: ${message}`,
          triggerData,
        };
        await appendRun(run);
        return run;
      } catch (catchErr) {
        const run: RunLog = {
          ...base,
          status: "error",
          message: `${message} (catch failed: ${errorMessage(catchErr)})`,
          triggerData: {
            ...triggerData,
            catchError: toCatchErrorPayload(catchErr),
          },
        };
        await appendRun(run);
        return run;
      }
    }

    const run: RunLog = {
      ...base,
      status: "error",
      message,
      triggerData,
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
    // Event rules only run when a webhook / Home Assistant message arrives.
    if (isEventRunTrigger(rule.runTrigger)) continue;

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
