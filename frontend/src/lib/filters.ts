import type { RuleFilter, RuleFilterOp } from "../api/client";

export const FILTER_OPS: { value: RuleFilterOp; label: string; needsValue: boolean }[] = [
  { value: "eq", label: "equals", needsValue: true },
  { value: "neq", label: "not equals", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "starts_with", label: "starts with", needsValue: true },
  { value: "ends_with", label: "ends with", needsValue: true },
  { value: "gt", label: "greater than", needsValue: true },
  { value: "gte", label: "greater or equal", needsValue: true },
  { value: "lt", label: "less than", needsValue: true },
  { value: "lte", label: "less or equal", needsValue: true },
  { value: "exists", label: "exists", needsValue: false },
  { value: "not_exists", label: "does not exist", needsValue: false },
];

export function filterNeedsValue(op: string): boolean {
  return op !== "exists" && op !== "not_exists";
}

export function isFilterConfigured(config: Record<string, unknown>): boolean {
  const path = String(config.path ?? "").trim();
  const op = String(config.op ?? "eq");
  if (!path) return false;
  if (!filterNeedsValue(op)) return true;
  return String(config.value ?? "").length > 0 || config.value === 0;
}

export function filterFromNodeConfig(config: Record<string, unknown>): RuleFilter | null {
  if (!isFilterConfigured(config)) return null;
  const path = String(config.path ?? "").trim();
  const op = (String(config.op ?? "eq") || "eq") as RuleFilterOp;
  return {
    path,
    op,
    ...(filterNeedsValue(op) ? { value: String(config.value ?? "") } : {}),
  };
}

export function formatFilterSummary(config: Record<string, unknown>): string {
  const path = String(config.path ?? "").trim() || "…";
  const op = String(config.op ?? "eq");
  const label = FILTER_OPS.find((item) => item.value === op)?.label ?? op;
  if (!filterNeedsValue(op)) return `${path} ${label}`;
  return `${path} ${label} ${String(config.value ?? "")}`;
}

/** Suggested paths for EVENT filters. */
export function eventFilterPathSuggestions(source: string): { value: string; label: string }[] {
  if (source === "homeassistant") {
    return [
      { value: "event.eventType", label: "event.eventType" },
      { value: "event.entityId", label: "event.entityId" },
      { value: "event.data.new_state.state", label: "event.data.new_state.state" },
      { value: "event.data.old_state.state", label: "event.data.old_state.state" },
      { value: "event.source", label: "event.source" },
    ];
  }
  return [
    { value: "event.method", label: "event.method" },
    { value: "event.body", label: "event.body" },
    { value: "event.body.type", label: "event.body.type" },
    { value: "event.query", label: "event.query" },
    { value: "event.source", label: "event.source" },
  ];
}
