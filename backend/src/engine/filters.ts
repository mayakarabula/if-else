export type FilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "exists"
  | "not_exists";

export interface RuleFilter {
  path: string;
  op: FilterOp;
  value?: string;
}

const OPS = new Set<FilterOp>([
  "eq",
  "neq",
  "contains",
  "starts_with",
  "ends_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "not_exists",
]);

export function normalizeFilterOp(value: unknown): FilterOp {
  const op = String(value ?? "eq") as FilterOp;
  return OPS.has(op) ? op : "eq";
}

/** Resolve dotted paths like `event.body.type` or `weather.temp`. */
export function getPathValue(data: Record<string, unknown>, rawPath: string): unknown {
  const path = rawPath.trim().replace(/^\{\{\s*|\s*\}\}$/g, "");
  if (!path) return undefined;
  const parts = path.split(".").filter(Boolean);
  let cursor: unknown = data;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(asString(value));
  return Number.isFinite(n) ? n : null;
}

export function evaluateFilter(filter: RuleFilter, data: Record<string, unknown>): boolean {
  const path = String(filter.path ?? "").trim();
  if (!path) return false;

  const op = normalizeFilterOp(filter.op);
  const actual = getPathValue(data, path);
  const expected = filter.value ?? "";

  switch (op) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "not_exists":
      return actual === undefined || actual === null || actual === "";
    case "eq":
      return asString(actual) === String(expected);
    case "neq":
      return asString(actual) !== String(expected);
    case "contains":
      return asString(actual).includes(String(expected));
    case "starts_with":
      return asString(actual).startsWith(String(expected));
    case "ends_with":
      return asString(actual).endsWith(String(expected));
    case "gt": {
      const a = asNumber(actual);
      const b = asNumber(expected);
      return a != null && b != null && a > b;
    }
    case "gte": {
      const a = asNumber(actual);
      const b = asNumber(expected);
      return a != null && b != null && a >= b;
    }
    case "lt": {
      const a = asNumber(actual);
      const b = asNumber(expected);
      return a != null && b != null && a < b;
    }
    case "lte": {
      const a = asNumber(actual);
      const b = asNumber(expected);
      return a != null && b != null && a <= b;
    }
    default:
      return false;
  }
}

/** All filters must pass (AND). Empty list passes. */
export function evaluateFilters(filters: RuleFilter[] | undefined, data: Record<string, unknown>): boolean {
  if (!filters?.length) return true;
  return filters.every((filter) => evaluateFilter(filter, data));
}

export function normalizeFilters(raw: unknown): RuleFilter[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const path = String(row.path ?? "").trim();
      if (!path) return null;
      const op = normalizeFilterOp(row.op);
      const value = row.value == null ? "" : String(row.value);
      return {
        path,
        op,
        ...(op === "exists" || op === "not_exists" ? {} : { value }),
      } satisfies RuleFilter;
    })
    .filter((item): item is RuleFilter => Boolean(item));
}
