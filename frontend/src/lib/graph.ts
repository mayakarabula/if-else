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

export type GraphNodeKind = "if" | "and" | "or" | "then" | "else" | "catch";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  parentId: string | null;
  /** Condition nodes (if / and / or) */
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
  slot: "condition" | "source" = "condition",
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

export function allowedChildKinds(node: GraphNode, nodes: GraphNode[]): GraphNodeKind[] {
  const kids = childrenOf(nodes, node.id);

  if (isConditionKind(node.kind)) {
    const kinds: GraphNodeKind[] = ["and", "or", "then"];
    const hasElse = kids.some((k) => k.kind === "else") || nodes.some((n) => n.kind === "else");
    if (!hasElse) kinds.push("else");
    const hasCatch = kids.some((k) => k.kind === "catch") || nodes.some((n) => n.kind === "catch");
    if (!hasCatch) kinds.push("catch");
    return kinds;
  }

  if (isActionKind(node.kind)) {
    return ["and"];
  }

  return [];
}

export function addChild(state: GraphState, parentId: string, kind: GraphNodeKind): GraphState {
  const parent = state.nodes.find((n) => n.id === parentId);
  if (!parent) return state;
  if (!allowedChildKinds(parent, state.nodes).includes(kind)) return state;

  // Extra actions hang off Then/Else/Catch as another same-kind node; the edge is labeled AND.
  const childKind: GraphNodeKind =
    kind === "and" && isActionKind(parent.kind) ? parent.kind : kind;

  const child = createNode(childKind, parentId, "condition");
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
    (n) => isConditionKind(n.kind) && isConditionConfigured(n) && n.slot === "condition",
  );
  const sourceNodes = state.nodes.filter(
    (n) => isConditionKind(n.kind) && isConditionConfigured(n) && n.slot === "source",
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
  // Persist an empty then block when only else/catch is configured so the rule shape stays stable.
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

export function ruleToGraph(rule: {
  if: RuleIf;
  then: RuleThen;
  else?: RuleThen;
  catch?: RuleThen;
}): GraphState {
  const ifBlock = normalizeIf(rule.if);
  const thenBlock = normalizeThen(rule.then);
  const elseBlock = normalizeThen(rule.else);
  const catchBlock = normalizeThen(rule.catch);
  const mode = ifBlock.mode;

  const nodes: GraphNode[] = [];
  let parentId: string | null = null;

  ifBlock.clauses.forEach((clause, index) => {
    const kind: GraphNodeKind =
      index === 0 ? "if" : mode === "any" ? "or" : "and";
    const node = createNode(kind, parentId, "condition");
    node.integration = clause.integration;
    node.trigger = clause.trigger;
    node.config = clause.config;
    nodes.push(node);
    parentId = node.id;
  });

  if (nodes.length === 0) {
    nodes.push(createNode("if", null, "condition"));
    parentId = nodes[0].id;
  }

  const attachPoint = parentId!;

  thenBlock.all.forEach((clause, index) => {
    const parent = index === 0 ? attachPoint : nodes[nodes.length - 1].id;
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

/** Refine condition/source slots using integration metadata. */
export function refineGraphSlots(state: GraphState, integrations: Integration[]): GraphState {
  return {
    ...state,
    nodes: state.nodes.map((node) => {
      if (!isConditionKind(node.kind) || !node.integration || !node.trigger) return node;
      const integration = integrations.find((i) => i.id === node.integration);
      const trigger = integration?.triggers?.find((t) => t.id === node.trigger);
      const slot = trigger?.kind === "data" ? "source" : "condition";
      return { ...node, slot };
    }),
  };
}

export function graphValidation(state: GraphState): { ok: boolean; message?: string } {
  const conditions = state.nodes.filter(
    (n) => isConditionKind(n.kind) && n.slot === "condition" && isConditionConfigured(n),
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
  then: { fill: "#3d6b4f", stroke: "#2f5440", label: "THEN" },
  else: { fill: "#8b4d3b", stroke: "#6f3d2f", label: "ELSE" },
  catch: { fill: "#b45309", stroke: "#92400e", label: "CATCH" },
};
