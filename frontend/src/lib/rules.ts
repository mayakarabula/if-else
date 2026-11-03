export interface RuleIfClause {
  integration: string;
  trigger: string;
  config: Record<string, unknown>;
}

export interface RuleIfBlock {
  all: RuleIfClause[];
  pollInterval?: string;
}

export type RuleIf = RuleIfClause | RuleIfBlock;

export interface RuleThenClause {
  integration: string;
  action: string;
  config: Record<string, unknown>;
}

export interface RuleThenBlock {
  all: RuleThenClause[];
}

export type RuleThen = RuleThenClause | RuleThenBlock;

export function normalizeIf(ifBlock: RuleIf): RuleIfBlock {
  if ("all" in ifBlock && Array.isArray(ifBlock.all)) {
    return ifBlock;
  }

  const legacy = ifBlock as RuleIfClause & { pollInterval?: string };
  const { pollInterval, ...clause } = legacy;
  return { all: [clause], pollInterval };
}

export function normalizeThen(thenBlock: RuleThen): RuleThenBlock {
  if ("all" in thenBlock && Array.isArray(thenBlock.all)) {
    return thenBlock;
  }

  return { all: [thenBlock as RuleThenClause] };
}

export function serializeIf(clauses: RuleIfClause[], pollInterval: string): RuleIf {
  const hasTime = clauses.some((clause) => clause.integration === "time");

  if (clauses.length === 1) {
    const clause = clauses[0];
    if (hasTime) return clause;
    return { ...clause, pollInterval };
  }

  if (hasTime) return { all: clauses };
  return { all: clauses, pollInterval };
}

export function serializeThen(clauses: RuleThenClause[]): RuleThen {
  if (clauses.length === 1) return clauses[0];
  return { all: clauses };
}

export function clauseLabel(
  integrations: { id: string; name: string; triggers?: { id: string; label: string }[]; actions?: { id: string; label: string }[] }[],
  clause: RuleIfClause | RuleThenClause,
  side: "if" | "then",
) {
  const integration = integrations.find((item) => item.id === clause.integration);
  if (side === "if") {
    const trigger = integration?.triggers?.find((item) => item.id === (clause as RuleIfClause).trigger);
    return `${integration?.name ?? clause.integration} · ${trigger?.label ?? (clause as RuleIfClause).trigger}`;
  }

  const action = integration?.actions?.find((item) => item.id === (clause as RuleThenClause).action);
  return `${integration?.name ?? clause.integration} · ${action?.label ?? (clause as RuleThenClause).action}`;
}

type IntegrationMeta = {
  id: string;
  triggers?: { id: string; fields: { key: string; label: string; type: string }[] }[];
  actions?: { id: string; fields: { key: string; label: string; type: string }[] }[];
};

function formatTimeValue(hour: unknown, minute: unknown, timezone: unknown) {
  const h = Number(hour ?? 0);
  const m = Number(minute ?? 0);
  const time = m === 0 ? String(h) : `${h}:${String(m).padStart(2, "0")}`;
  const tzRaw = timezone ? String(timezone) : "";
  const tzShort = tzRaw.includes("/") ? tzRaw.split("/").pop()!.replace(/_/g, " ") : tzRaw;
  return tzShort ? `Every day at ${time} ${tzShort} time` : `Every day at ${time}`;
}

export function formatClauseConfigSummary(
  integrations: IntegrationMeta[],
  clause: RuleIfClause | RuleThenClause,
  side: "if" | "then",
): string[] {
  if (side === "if") {
    const ifClause = clause as RuleIfClause;
    if (ifClause.integration === "time" && ifClause.trigger === "daily_at") {
      return [formatTimeValue(ifClause.config.hour, ifClause.config.minute, ifClause.config.timezone)];
    }
  }

  const integration = integrations.find((item) => item.id === clause.integration);
  const fields =
    side === "if"
      ? integration?.triggers?.find((item) => item.id === (clause as RuleIfClause).trigger)?.fields ?? []
      : integration?.actions?.find((item) => item.id === (clause as RuleThenClause).action)?.fields ?? [];

  return fields
    .map((field) => {
      const value = clause.config[field.key];
      if (value === undefined || value === "") return null;

      if (field.type === "textarea") {
        const text = String(value).trim();
        const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
        return `${field.label}: ${preview.replace(/\n/g, " ")}`;
      }

      if (field.type === "select") {
        return `${field.label}: ${value}`;
      }

      return `${field.label}: ${value}`;
    })
    .filter((line): line is string => Boolean(line));
}

export function formatClauseOverview(
  integrations: IntegrationMeta[],
  clause: RuleIfClause | RuleThenClause,
  side: "if" | "then",
): string {
  const summary = formatClauseConfigSummary(integrations, clause, side);
  return summary.join(" · ");
}

