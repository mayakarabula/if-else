/** Where a SOURCE clause should reattach in the editor graph after reload. */
export type SourceAttachTo = "if" | "action" | "else" | "catch";

export interface RuleIfClause {
  integration: string;
  trigger: string;
  config: Record<string, unknown>;
  /**
   * Editor-only hint for data SOURCE nodes. Runtime ignores this — sources still
   * live in `if` so templates resolve — but reload uses it to keep the node under
   * ACTION / ELSE / CATCH instead of always reparenting onto IF.
   */
  attachTo?: SourceAttachTo | "then";
}

export interface RuleIfBlock {
  all?: RuleIfClause[];
  any?: RuleIfClause[];
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

export type ConditionMode = "all" | "any";

export type RuleEventSource = "webhook" | "homeassistant";

export interface RuleEvent {
  source: RuleEventSource;
  eventType?: string;
  entityId?: string;
}

export interface NormalizedIf {
  mode: ConditionMode;
  clauses: RuleIfClause[];
  pollInterval?: string;
}

export function normalizeSourceAttachTo(value: string | undefined): SourceAttachTo {
  if (value === "then") return "action";
  if (value === "action" || value === "else" || value === "catch" || value === "if") return value;
  return "if";
}

export function normalizeIf(ifBlock: RuleIf): NormalizedIf {
  if (typeof ifBlock === "object" && ifBlock !== null && ("all" in ifBlock || "any" in ifBlock)) {
    const block = ifBlock as RuleIfBlock;
    if (Array.isArray(block.any) && block.any.length > 0) {
      return { mode: "any", clauses: block.any, pollInterval: block.pollInterval };
    }
    return { mode: "all", clauses: block.all ?? [], pollInterval: block.pollInterval };
  }

  const legacy = ifBlock as RuleIfClause & { pollInterval?: string };
  const { pollInterval, ...clause } = legacy;
  return { mode: "all", clauses: [clause], pollInterval };
}

export function normalizeThen(thenBlock: RuleThen | undefined | null): { all: RuleThenClause[] } {
  if (!thenBlock) return { all: [] };
  if ("all" in thenBlock && Array.isArray(thenBlock.all)) {
    return thenBlock;
  }

  return { all: [thenBlock as RuleThenClause] };
}

export function serializeIf(
  clauses: RuleIfClause[],
  pollInterval: string,
  mode: ConditionMode = "all",
): RuleIf {
  const key = mode === "any" ? "any" : "all";
  const interval = pollInterval.trim() || "15m";

  if (clauses.length === 0) {
    return { all: [], pollInterval: interval };
  }

  if (clauses.length === 1 && mode === "all") {
    return { ...clauses[0], pollInterval: interval };
  }

  return { [key]: clauses, pollInterval: interval };
}

export function serializeThen(clauses: RuleThenClause[]): RuleThen | undefined {
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return { all: clauses };
}

export function clauseLabel(
  integrations: {
    id: string;
    name: string;
    triggers?: { id: string; label: string }[];
    actions?: { id: string; label: string }[];
  }[],
  clause: RuleIfClause | RuleThenClause,
  side: "if" | "action" | "then",
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
  side: "if" | "action" | "then",
): string[] {
  if (side === "if") {
    const ifClause = clause as RuleIfClause;
    if (ifClause.integration === "time" && ifClause.trigger === "daily_at") {
      return [formatTimeValue(ifClause.config.hour, ifClause.config.minute, ifClause.config.timezone)];
    }
    if (ifClause.integration === "time" && ifClause.trigger === "every") {
      const interval = String(ifClause.config.interval ?? "15m").trim() || "15m";
      return [`Every ${interval}`];
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
  side: "if" | "action" | "then",
): string {
  const summary = formatClauseConfigSummary(integrations, clause, side);
  return summary.join(" · ");
}
