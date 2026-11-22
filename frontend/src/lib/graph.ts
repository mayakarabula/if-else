import type { Integration } from "../api/client";
import {
  normalizeIf,
  normalizeThen,
  serializeIf,
  serializeThen,
  type ConditionMode,
  type RuleIf,
  type RuleIfClause,
  type RuleThen,
  type RuleThenClause,
} from "./rules";

export type GraphNodeKind = "if" | "and" | "or" | "source" | "then" | "else" | "catch";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  parentId: string | null;
  /** Condition / source nodes (if / and / or / source) */
  integration: string | null;
  trigger: string | null;
  /** Action nodes (then / else / catch) */
  action: string | null;
  config: Record<string, unknown>;
  /** condition gates; source supplies template data */
  slot: "condition" | "source";
}

export interface GraphState {
  nodes: GraphNode[];
  pollInterval: string;
}

export function createNode(
  kind: GraphNodeKind,
  parentId: string | null = null,
  slot: "condition" | "source" = kind === "source" ? "source" : "condition",
): GraphNode {
  return {
    id: crypto.randomUUID(),
    kind,
    parentId,
    integration: null,
    trigger: null,
    action: null,
    config: {},
    slot,
  };
}

export function createEmptyGraph(): GraphState {
  return {
    nodes: [createNode("if", null, "condition")],
    pollInterval: "15m",
  };
}

export function isConditionKind(kind: GraphNodeKind): boolean {
  return kind === "if" || kind === "and" || kind === "or";
}

export function isSourceKind(kind: GraphNodeKind): boolean {
  return kind === "source";
}

/** Nodes that pick a trigger (conditions + data sources). */
export function isTriggerKind(kind: GraphNodeKind): boolean {
  return isConditionKind(kind) || isSourceKind(kind);
}

export function isActionKind(kind: GraphNodeKind): boolean {
  return kind === "then" || kind === "else" || kind === "catch";
}

export function isConditionConfigured(node: GraphNode): boolean {
  return Boolean(node.integration && node.trigger);
}

export function isActionConfigured(node: GraphNode): boolean {
  return Boolean(node.integration && node.action);
}

export function childrenOf(nodes: GraphNode[], parentId: string): GraphNode[] {
  return nodes.filter((node) => node.parentId === parentId);
}

export function allowedChildKinds(node: GraphNode, _nodes: GraphNode[]): GraphNodeKind[] {
  if (isConditionKind(node.kind)) {
    const kinds: GraphNodeKind[] = ["and", "or", "source", "then"];
    const hasElse = _nodes.some((n) => n.kind === "else");
    if (!hasElse) kinds.push("else");
    const hasCatch = _nodes.some((n) => n.kind === "catch");
    if (!hasCatch) kinds.push("catch");
    return kinds;
  }

  if (isSourceKind(node.kind)) {
    return ["source"];
  }

  if (isActionKind(node.kind)) {
    // SOURCE from any action node; AND adds another action of the same kind.
    return ["source", "and"];
  }

  return [];
}

export function addChild(state: GraphState, parentId: string, kind: GraphNodeKind): GraphState {
  const parent = state.nodes.find((n) => n.id === parentId);
  if (!parent) return state;
  if (!allowedChildKinds(parent, state.nodes).includes(kind)) return state;

  let childKind: GraphNodeKind = kind;
  let slot: "condition" | "source" = "condition";

  if (kind === "and" && isActionKind(parent.kind)) {
    childKind = parent.kind;
  } else if (kind === "source") {
    childKind = "source";
    slot = "source";
  }

  const child = createNode(childKind, parentId, slot);
  return { ...state, nodes: [...state.nodes, child] };
}

export function removeNode(state: GraphState, nodeId: string): GraphState {
  const root = state.nodes.find((n) => n.kind === "if" && n.parentId === null);
  if (root && root.id === nodeId) return state;

  const toRemove = new Set<string>();
  const walk = (id: string) => {
    toRemove.add(id);
    for (const child of childrenOf(state.nodes, id)) walk(child.id);
  };
  walk(nodeId);

  return {
    ...state,
    nodes: state.nodes.filter((n) => !toRemove.has(n.id)),
  };
}

export function updateNode(state: GraphState, nodeId: string, patch: Partial<GraphNode>): GraphState {
  return {
    ...state,
    nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
  };
}

export function conditionMode(nodes: GraphNode[]): ConditionMode {
  return nodes.some((n) => n.kind === "or") ? "any" : "all";
}

export function graphToRulePayload(state: GraphState): {
  if: RuleIf;
  then: RuleThen;
  else?: RuleThen;
  catch?: RuleThen;
} {
  const conditionNodes = state.nodes.filter(
    (n) => isConditionKind(n.kind) && isConditionConfigured(n),
  );
  const sourceNodes = state.nodes.filter(
    (n) => isSourceKind(n.kind) && isConditionConfigured(n),
  );

  const ifClauses: RuleIfClause[] = [...conditionNodes, ...sourceNodes].map((n) => ({
    integration: n.integration!,
    trigger: n.trigger!,
    config: n.config,
  }));

  const thenNodes = state.nodes.filter((n) => n.kind === "then" && isActionConfigured(n));
  const elseNodes = state.nodes.filter((n) => n.kind === "else" && isActionConfigured(n));
  const catchNodes = state.nodes.filter((n) => n.kind === "catch" && isActionConfigured(n));

  const thenClauses: RuleThenClause[] = thenNodes.map((n) => ({
    integration: n.integration!,
    action: n.action!,
    config: n.config,
  }));

  const elseClauses: RuleThenClause[] = elseNodes.map((n) => ({
    integration: n.integration!,
    action: n.action!,
    config: n.config,
  }));

  const catchClauses: RuleThenClause[] = catchNodes.map((n) => ({
    integration: n.integration!,
    action: n.action!,
    config: n.config,
  }));

  const mode = conditionMode(state.nodes);
  const ifBlock = serializeIf(ifClauses, state.pollInterval, mode);
  const thenBlock = serializeThen(thenClauses) ?? { all: [] as RuleThenClause[] };
  const elseBlock = serializeThen(elseClauses);
  const catchBlock = serializeThen(catchClauses);

  return {
    if: ifBlock,
    then: thenBlock,
    ...(elseBlock ? { else: elseBlock } : {}),
    ...(catchBlock ? { catch: catchBlock } : {}),
  };
}

function isDataClause(clause: RuleIfClause, integrations: Integration[]): boolean {
  const integration = integrations.find((i) => i.id === clause.integration);
  const trigger = integration?.triggers?.find((t) => t.id === clause.trigger);
  return trigger?.kind === "data";
}

export function ruleToGraph(
  rule: {
    if: RuleIf;
    then: RuleThen;
    else?: RuleThen;
    catch?: RuleThen;
  },
  integrations: Integration[] = [],
): GraphState {
  const ifBlock = normalizeIf(rule.if);
  const thenBlock = normalizeThen(rule.then);
  const elseBlock = normalizeThen(rule.else);
  const catchBlock = normalizeThen(rule.catch);
  const mode = ifBlock.mode;

  const conditionClauses = ifBlock.clauses.filter((c) => !isDataClause(c, integrations));
  const sourceClauses = ifBlock.clauses.filter((c) => isDataClause(c, integrations));

  // Without integrations yet, treat everything as conditions; refineGraphSlots will fix later.
  const useSplit = integrations.length > 0;
  const conditions = useSplit ? conditionClauses : ifBlock.clauses;
  const sources = useSplit ? sourceClauses : [];

  const nodes: GraphNode[] = [];
  let conditionParentId: string | null = null;
  let lastConditionId: string | null = null;

  conditions.forEach((clause, index) => {
    const kind: GraphNodeKind =
      index === 0 ? "if" : mode === "any" ? "or" : "and";
    const node = createNode(kind, conditionParentId, "condition");
    node.integration = clause.integration;
    node.trigger = clause.trigger;
    node.config = clause.config;
    nodes.push(node);
    conditionParentId = node.id;
    lastConditionId = node.id;
  });

  if (nodes.length === 0) {
    nodes.push(createNode("if", null, "condition"));
    lastConditionId = nodes[0].id;
  }

  let sourceParentId = lastConditionId!;
  for (const clause of sources) {
    const node = createNode("source", sourceParentId, "source");
    node.integration = clause.integration;
    node.trigger = clause.trigger;
    node.config = clause.config;
    nodes.push(node);
    sourceParentId = node.id;
  }

  const attachPoint = lastConditionId!;

  thenBlock.all.forEach((clause, index) => {
    const parent = index === 0 ? attachPoint : nodes.filter((n) => n.kind === "then").at(-1)?.id ?? attachPoint;
    const node = createNode("then", parent);
    node.integration = clause.integration;
    node.action = clause.action;
    node.config = clause.config;
    nodes.push(node);
  });

  elseBlock.all.forEach((clause, index) => {
    const parent = index === 0 ? attachPoint : nodes.filter((n) => n.kind === "else").at(-1)?.id ?? attachPoint;
    const node = createNode("else", parent);
    node.integration = clause.integration;
    node.action = clause.action;
    node.config = clause.config;
    nodes.push(node);
  });

  catchBlock.all.forEach((clause, index) => {
    const parent =
      index === 0 ? attachPoint : nodes.filter((n) => n.kind === "catch").at(-1)?.id ?? attachPoint;
    const node = createNode("catch", parent);
    node.integration = clause.integration;
    node.action = clause.action;
    node.config = clause.config;
    nodes.push(node);
  });

  return {
    nodes,
    pollInterval: ifBlock.pollInterval ?? "15m",
  };
}

/**
 * Classify trigger nodes as condition vs source from integration metadata.
 * Preserves parent links — SOURCE stays attached to wherever it was added (IF or THEN).
 */
export function refineGraphSlots(state: GraphState, integrations: Integration[]): GraphState {
  if (integrations.length === 0) return state;

  const nodes = state.nodes.map((node) => {
    if (!node.integration || !node.trigger) return node;
    if (!isTriggerKind(node.kind)) return node;

    const integration = integrations.find((i) => i.id === node.integration);
    const trigger = integration?.triggers?.find((t) => t.id === node.trigger);
    if (!trigger) return node;

    if (trigger.kind === "data") {
      // Never convert the root IF into a source node.
      if (node.kind === "if" && !node.parentId) {
        return { ...node, slot: "condition" as const };
      }
      return { ...node, kind: "source" as const, slot: "source" as const };
    }

    if (node.kind === "source") {
      return {
        ...node,
        kind: (node.parentId ? "and" : "if") as GraphNodeKind,
        slot: "condition" as const,
      };
    }

    return { ...node, slot: "condition" as const };
  });

  return { ...state, nodes };
}

export function graphValidation(state: GraphState): { ok: boolean; message?: string } {
  const conditions = state.nodes.filter(
    (n) => isConditionKind(n.kind) && isConditionConfigured(n),
  );
  const thens = state.nodes.filter((n) => n.kind === "then" && isActionConfigured(n));
  const elses = state.nodes.filter((n) => n.kind === "else" && isActionConfigured(n));
  const catches = state.nodes.filter((n) => n.kind === "catch" && isActionConfigured(n));

  if (conditions.length === 0) {
    return { ok: false, message: "Add at least one If condition." };
  }
  if (thens.length === 0 && elses.length === 0 && catches.length === 0) {
    return { ok: false, message: "Add a Then, Else, or Catch action." };
  }
  return { ok: true };
}

export const NODE_COLORS: Record<GraphNodeKind, { fill: string; stroke: string; label: string }> = {
  if: { fill: "#2a261f", stroke: "#2a261f", label: "IF" },
  and: { fill: "#a07a3a", stroke: "#8a6830", label: "AND" },
  or: { fill: "#5b7c99", stroke: "#4a6780", label: "OR" },
  source: { fill: "#0f766e", stroke: "#0d9488", label: "SOURCE" },
  then: { fill: "#3d6b4f", stroke: "#2f5440", label: "THEN" },
  else: { fill: "#8b4d3b", stroke: "#6f3d2f", label: "ELSE" },
  catch: { fill: "#b45309", stroke: "#92400e", label: "CATCH" },
};

/** Dark-mode accents stay in the same warm family but stay readable on espresso parchment. */
export const NODE_COLORS_DARK: Record<GraphNodeKind, { fill: string; stroke: string; label: string }> = {
  if: { fill: "#d9cdb6", stroke: "#cfc3a8", label: "IF" },
  and: { fill: "#c4a05a", stroke: "#a88840", label: "AND" },
  or: { fill: "#7aa2d4", stroke: "#5b7c99", label: "OR" },
  source: { fill: "#2dd4bf", stroke: "#14b8a6", label: "SOURCE" },
  then: { fill: "#6b9b7a", stroke: "#4f7d60", label: "THEN" },
  else: { fill: "#c47862", stroke: "#a05c48", label: "ELSE" },
  catch: { fill: "#e0a04a", stroke: "#c4842e", label: "CATCH" },
};

export function nodeColorsForMode(mode: "light" | "dark") {
  return mode === "dark" ? NODE_COLORS_DARK : NODE_COLORS;
}
