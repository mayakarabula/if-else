import type { RuleIf, RuleIfClause, RuleThen, RuleThenClause } from "../store/rules.js";

export type ConditionMode = "all" | "any";

export interface NormalizedIf {
  mode: ConditionMode;
  clauses: RuleIfClause[];
  pollInterval?: string;
}

export interface NormalizedThen {
  all: RuleThenClause[];
}

function isIfBlock(value: RuleIf): value is {
  all?: RuleIfClause[];
  any?: RuleIfClause[];
  pollInterval?: string;
} {
  return typeof value === "object" && value !== null && ("all" in value || "any" in value);
}

function isThenBlock(value: RuleThen): value is { all: RuleThenClause[] } {
  return "all" in value && Array.isArray(value.all);
}

export function normalizeIf(ifBlock: RuleIf): NormalizedIf {
  if (isIfBlock(ifBlock)) {
    if (Array.isArray(ifBlock.any) && ifBlock.any.length > 0) {
      return { mode: "any", clauses: ifBlock.any, pollInterval: ifBlock.pollInterval };
    }
    return { mode: "all", clauses: ifBlock.all ?? [], pollInterval: ifBlock.pollInterval };
  }

  const legacy = ifBlock as RuleIfClause & { pollInterval?: string };
  const { pollInterval, ...clause } = legacy;
  return { mode: "all", clauses: [clause], pollInterval };
}

export function normalizeThen(thenBlock: RuleThen | undefined | null): NormalizedThen {
  if (!thenBlock) return { all: [] };
  if (isThenBlock(thenBlock)) {
    return { all: thenBlock.all };
  }

  return { all: [thenBlock] };
}

export function clauseKey(clause: RuleIfClause): string {
  return `${clause.integration}:${clause.trigger}`;
}

export function ruleHasTimeTrigger(ifBlock: RuleIf): boolean {
  return normalizeIf(ifBlock).clauses.some((clause) => clause.integration === "time");
}

export function rulePollInterval(ifBlock: RuleIf): number {
  const normalized = normalizeIf(ifBlock);
  if (ruleHasTimeTrigger(ifBlock)) return 30_000;
  return parsePollInterval(normalized.pollInterval);
}

function parsePollInterval(interval?: string): number {
  if (!interval) return 15 * 60 * 1000;
  const match = interval.match(/^(\d+)(m|h|s)$/);
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === "s") return value * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  return value * 60 * 1000;
}
