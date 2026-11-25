import type { Integration } from "../api/client";
import {
  isActionConfigured,
  isActionKind,
  isConditionConfigured,
  isEventConfigured,
  isEventKind,
  isFilterKind,
  isFilterNodeConfigured,
  isTriggerKind,
  type GraphNode,
  type GraphState,
} from "./graph";
import { filterNeedsValue } from "./filters";

export interface GraphIssue {
  code: string;
  message: string;
}

const TEMPLATE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Paths like `weather.report` or `trigger.weather.report` → integration + rest. */
export function normalizeTemplatePath(raw: string): string {
  const path = raw.trim().replace(/^\.+|\.+$/g, "");
  if (path.startsWith("trigger.")) return path.slice("trigger.".length);
  return path;
}

export function extractTemplatePaths(text: string): string[] {
  const found = new Set<string>();
  TEMPLATE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEMPLATE_RE.exec(text))) {
    const path = normalizeTemplatePath(match[1] ?? "");
    if (path) found.add(path);
  }
  return [...found];
}

function collectConfigText(config: Record<string, unknown>): string {
  return Object.values(config)
    .filter((value) => typeof value === "string")
    .join("\n");
}

/** Tokens the graph can currently resolve (integration.outputPath), plus catch `error.*`. */
export function availableTemplatePaths(
  state: GraphState,
  integrations: Integration[],
  options?: { includeError?: boolean },
): Set<string> {
  const available = new Set<string>();

  for (const node of state.nodes) {
    if (isTriggerKind(node.kind) && isConditionConfigured(node)) {
      const integration = integrations.find((item) => item.id === node.integration);
      const trigger = integration?.triggers?.find((item) => item.id === node.trigger);
      if (integration && trigger) {
        for (const output of trigger.outputs ?? []) {
          available.add(`${integration.id}.${output.path}`);
        }
      }
      continue;
    }

    if (isActionKind(node.kind) && isActionConfigured(node) && node.kind !== "catch") {
      const integration = integrations.find((item) => item.id === node.integration);
      const action = integration?.actions?.find((item) => item.id === node.action);
      if (integration && action) {
        for (const output of action.outputs ?? []) {
          available.add(`${integration.id}.${output.path}`);
        }
      }
    }
  }

  if (options?.includeError) {
    for (const integration of integrations) {
      for (const step of [...(integration.triggers ?? []), ...(integration.actions ?? [])]) {
        for (const field of step.errorCallback ?? []) {
          available.add(`error.${field.path}`);
        }
      }
    }
    for (const path of ["message", "code", "integration", "step", "stepLabel", "kind", "plan"]) {
      available.add(`error.${path}`);
    }
  }

  return available;
}

function describeMissingPath(path: string, integrations: Integration[]): string {
  if (path.startsWith("error.")) {
    return `{{${path}}} is only available on CATCH nodes`;
  }

  const [integrationId, ...rest] = path.split(".");
  const outputPath = rest.join(".");
  const integration = integrations.find((item) => item.id === integrationId);

  if (!integration) {
    return `Uses {{${path}}} but no "${integrationId}" integration is in this flow`;
  }

  const triggerProviders = (integration.triggers ?? []).filter((trigger) =>
    (trigger.outputs ?? []).some(
      (output) => output.path === outputPath || outputPath.startsWith(`${output.path}.`),
    ),
  );
  const actionProviders = (integration.actions ?? []).filter((action) =>
    (action.outputs ?? []).some(
      (output) => output.path === outputPath || outputPath.startsWith(`${output.path}.`),
    ),
  );

  if (triggerProviders.length === 0 && actionProviders.length === 0) {
    return `Uses {{${path}}} — ${integration.name} has no output "${outputPath}"`;
  }

  if (actionProviders.length > 0 && triggerProviders.length === 0) {
    const labels = actionProviders.map((p) => p.label).join(" / ");
    return `Add an ACTION for ${integration.name} · ${labels} (provides {{${path}}})`;
  }

  const kindHint = triggerProviders.some((p) => (p.kind ?? "condition") === "data")
    ? "Add a SOURCE"
    : "Add a condition or SOURCE";
  const labels = triggerProviders.map((p) => p.label).join(" / ");
  return `${kindHint} for ${integration.name} · ${labels} (provides {{${path}}})`;
}

function pathIsAvailable(path: string, available: Set<string>): boolean {
  if (available.has(path)) return true;
  for (const token of available) {
    if (token === path || token.startsWith(`${path}.`) || path.startsWith(`${token}.`)) {
      return true;
    }
  }
  return false;
}

function requiredFieldIssues(node: GraphNode, integrations: Integration[]): GraphIssue[] {
  const issues: GraphIssue[] = [];

  if (isEventKind(node.kind)) {
    if (!isEventConfigured(node)) {
      issues.push({
        code: "unconfigured",
        message: "Configure the Event source",
      });
    }
    return issues;
  }

  if (isFilterKind(node.kind)) {
    if (!isFilterNodeConfigured(node)) {
      const path = String(node.config.path ?? "").trim();
      const op = String(node.config.op ?? "eq");
      issues.push({
        code: "unconfigured",
        message: !path
          ? "Pick a path to filter"
          : filterNeedsValue(op)
            ? "Enter a filter value"
            : "Configure the filter",
      });
    }
    return issues;
  }

  if (isTriggerKind(node.kind)) {
    if (!isConditionConfigured(node)) {
      issues.push({
        code: "unconfigured",
        message:
          node.kind === "source"
            ? "Pick a data source"
            : node.kind === "if" && !node.parentId
              ? "Pick a starting condition"
              : "Pick a condition",
      });
      return issues;
    }

    const integration = integrations.find((item) => item.id === node.integration);
    const trigger = integration?.triggers?.find((item) => item.id === node.trigger);
    for (const field of trigger?.fields ?? []) {
      if (!field.required) continue;
      const value = node.config[field.key];
      if (value === undefined || value === null || String(value).trim() === "") {
        issues.push({
          code: "missing_field",
          message: `Missing "${field.label}"`,
        });
      }
    }
    return issues;
  }

  if (isActionKind(node.kind)) {
    if (!isActionConfigured(node)) {
      issues.push({
        code: "unconfigured",
        message: "Pick an action",
      });
      return issues;
    }

    const integration = integrations.find((item) => item.id === node.integration);
    const action = integration?.actions?.find((item) => item.id === node.action);
    for (const field of action?.fields ?? []) {
      if (!field.required) continue;
      const value = node.config[field.key];
      if (value === undefined || value === null || String(value).trim() === "") {
        issues.push({
          code: "missing_field",
          message: `Missing "${field.label}"`,
        });
      }
    }
  }

  return issues;
}

function templateIssues(
  node: GraphNode,
  state: GraphState,
  integrations: Integration[],
): GraphIssue[] {
  if (!isActionKind(node.kind) || !isActionConfigured(node)) return [];

  const text = collectConfigText(node.config);
  const refs = extractTemplatePaths(text);
  if (refs.length === 0) return [];

  const available = availableTemplatePaths(state, integrations, {
    includeError: node.kind === "catch",
  });

  const issues: GraphIssue[] = [];
  const seen = new Set<string>();

  for (const path of refs) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (pathIsAvailable(path, available)) continue;
    issues.push({
      code: "missing_template_source",
      message: describeMissingPath(path, integrations),
    });
  }

  return issues;
}

export function analyzeNodeIssues(
  node: GraphNode,
  state: GraphState,
  integrations: Integration[],
): GraphIssue[] {
  // Optional IF under EVENT: ignore until the user configures a filter.
  if (node.kind === "if" && !isConditionConfigured(node)) {
    const parent = state.nodes.find((n) => n.id === node.parentId);
    if (parent?.kind === "event") {
      return templateIssues(node, state, integrations);
    }
  }
  return [...requiredFieldIssues(node, integrations), ...templateIssues(node, state, integrations)];
}

export function analyzeGraphIssues(
  state: GraphState,
  integrations: Integration[],
  options?: {
    /**
     * When set, only nodes in this set get issues reported (for UI highlighting).
     * Omit to analyze every node (save validation, edit preload).
     */
    touchedIds?: Set<string>;
  },
): Map<string, GraphIssue[]> {
  const map = new Map<string, GraphIssue[]>();
  for (const node of state.nodes) {
    if (options?.touchedIds && !options.touchedIds.has(node.id)) continue;
    const issues = analyzeNodeIssues(node, state, integrations);
    if (issues.length > 0) map.set(node.id, issues);
  }
  return map;
}

export function firstGraphIssueMessage(
  state: GraphState,
  integrations: Integration[],
): string | undefined {
  const issues = analyzeGraphIssues(state, integrations);
  for (const node of state.nodes) {
    const list = issues.get(node.id);
    if (list?.[0]) return list[0].message;
  }
  return undefined;
}

/** Structural graph checks plus logical setup issues (templates, required fields). */
export function validateGraphSetup(
  state: GraphState,
  integrations: Integration[],
  structural: { ok: boolean; message?: string },
): { ok: boolean; message?: string } {
  if (!structural.ok) return structural;
  const issue = firstGraphIssueMessage(state, integrations);
  if (issue) return { ok: false, message: issue };
  return { ok: true };
}
