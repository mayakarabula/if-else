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
 * Classify leftover data triggers (when loaded without integrations) as SOURCE nodes.
 */
export function refineGraphSlots(state: GraphState, integrations: Integration[]): GraphState {
  if (integrations.length === 0) return state;

  const byId = new Map(state.nodes.map((n) => [n.id, n]));

  // First pass: mark data triggers as source (except root IF — keep as condition shell).
  let nodes = state.nodes.map((node) => {
    if (!node.integration || !node.trigger) return node;
    if (!isTriggerKind(node.kind) && node.kind !== "and" && node.kind !== "or" && node.kind !== "if") {
      return node;
    }
    const integration = integrations.find((i) => i.id === node.integration);
    const trigger = integration?.triggers?.find((t) => t.id === node.trigger);
    if (trigger?.kind !== "data") {
      if (node.kind === "source") {
        return {
          ...node,
          kind: (node.parentId ? "and" : "if") as GraphNodeKind,
          slot: "condition" as const,
        };
      }
      return { ...node, slot: "condition" as const };
    }
    if (node.kind === "if" && !node.parentId) {
      // Root IF that is somehow a data trigger — still show as IF but slot source is wrong;
      // leave as IF condition for gating; rare.
      return { ...node, slot: "condition" as const };
    }
    return { ...node, kind: "source" as const, slot: "source" as const };
  });

  byId.clear();
  for (const n of nodes) byId.set(n.id, n);

  // Re-attach sources that sat in the condition chain onto the nearest condition ancestor,
  // then chain sources under that condition.
  const sourceNodes = nodes.filter((n) => n.kind === "source");
  const conditionAttach = new Map<string, string>();

  for (const source of sourceNodes) {
    let attach = source.parentId;
    let cursor = source.parentId ? byId.get(source.parentId) : undefined;
    while (cursor) {
      if (isConditionKind(cursor.kind)) {
        attach = cursor.id;
        break;
      }
      if (!cursor.parentId) break;
      cursor = byId.get(cursor.parentId);
    }
    if (attach) conditionAttach.set(source.id, attach);
  }

  // Group sources by condition attach point, preserve original order.
  const groups = new Map<string, string[]>();
  for (const source of sourceNodes) {
    const attach = conditionAttach.get(source.id);
    if (!attach) continue;
    const list = groups.get(attach) ?? [];
    list.push(source.id);
    groups.set(attach, list);
  }

  const newParent = new Map<string, string>();
  for (const [attach, ids] of groups) {
    ids.forEach((id, index) => {
      newParent.set(id, index === 0 ? attach : ids[index - 1]);
    });
  }

  // Also fix children of converted sources: then/else/catch that pointed at a former AND
  // should point at the condition attach if their parent became a source mid-chain.
  nodes = nodes.map((node) => {
    if (node.kind === "source") {
      const parentId = newParent.get(node.id);
      return parentId ? { ...node, parentId } : node;
    }
    if (!node.parentId) return node;
    const parent = byId.get(node.parentId);
    if (parent?.kind === "source" && isActionKind(node.kind)) {
      // Prefer attaching actions to the condition that owns this source chain.
      const attach = conditionAttach.get(parent.id) ?? node.parentId;
      return { ...node, parentId: attach };
    }
    return node;
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
