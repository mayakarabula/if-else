import type { Integration, RuleEvent, RuleEventSource, RuleFilter } from "../api/client";
import { filterFromNodeConfig, isFilterConfigured as filterConfigReady } from "./filters";
import {
  normalizeIf,
  normalizeSourceAttachTo,
  normalizeThen,
  serializeIf,
  serializeThen,
  type ConditionMode,
  type RuleIf,
  type RuleIfClause,
  type RuleThen,
  type RuleThenClause,
  type SourceAttachTo,
} from "./rules";

export type GraphNodeKind =
  | "event"
  | "filter"
  | "if"
  | "and"
  | "or"
  | "source"
  | "action"
  | "else"
  | "catch";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  parentId: string | null;
  /** Condition / source nodes (if / and / or / source) */
  integration: string | null;
  trigger: string | null;
  /** Action nodes (action / else / catch) */
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
    config:
      kind === "event"
        ? { source: "webhook" }
        : kind === "filter"
          ? { path: "event.entityId", op: "eq", value: "" }
          : {},
    slot,
  };
}

export function createEmptyGraph(): GraphState {
  return {
    nodes: [createNode("if", null, "condition")],
    pollInterval: "15m",
  };
}

export function isEventKind(kind: GraphNodeKind): boolean {
  return kind === "event";
}

export function isFilterKind(kind: GraphNodeKind): boolean {
  return kind === "filter";
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
  return kind === "action" || kind === "else" || kind === "catch";
}

export function isConditionConfigured(node: GraphNode): boolean {
  return Boolean(node.integration && node.trigger);
}

export function isActionConfigured(node: GraphNode): boolean {
  return Boolean(node.integration && node.action);
}

export function isEventConfigured(node: GraphNode): boolean {
  const source = String(node.config.source ?? "");
  return source === "webhook" || source === "homeassistant";
}

export function isFilterNodeConfigured(node: GraphNode): boolean {
  return isFilterKind(node.kind) && filterConfigReady(node.config);
}

export function childrenOf(nodes: GraphNode[], parentId: string): GraphNode[] {
  return nodes.filter((node) => node.parentId === parentId);
}

export function graphRoot(nodes: GraphNode[]): GraphNode | undefined {
  return (
    nodes.find((n) => n.kind === "event" && n.parentId === null) ??
    nodes.find((n) => n.kind === "if" && n.parentId === null) ??
    nodes.find((n) => n.parentId === null)
  );
}

export function eventSourceFromNode(node: GraphNode | undefined): RuleEventSource {
  const source = String(node?.config.source ?? "webhook");
  return source === "homeassistant" ? "homeassistant" : "webhook";
}

export function eventConfigFromGraph(state: GraphState): RuleEvent | undefined {
  const eventNode = state.nodes.find((n) => n.kind === "event");
  if (!eventNode) return undefined;
  const source = eventSourceFromNode(eventNode);
  const eventType = String(eventNode.config.eventType ?? "").trim();
  const entityId = String(eventNode.config.entityId ?? "").trim();
  return {
    source,
    ...(source === "homeassistant"
      ? {
          eventType: eventType || "state_changed",
          ...(entityId ? { entityId } : {}),
        }
      : {}),
  };
}

/** Ensure an EVENT root exists (reparents a configured IF underneath; drops empty IF). */
export function ensureEventRoot(state: GraphState): GraphState {
  const existing = state.nodes.find((n) => n.kind === "event" && n.parentId === null);
  if (existing) return state;

  const event = createNode("event", null);
  const previousRoot = state.nodes.find((n) => n.parentId === null);

  // Empty IF placeholder isn't useful under EVENT — user can add a filter later.
  if (
    previousRoot &&
    previousRoot.kind === "if" &&
    !isConditionConfigured(previousRoot) &&
    childrenOf(state.nodes, previousRoot.id).length === 0
  ) {
    return { ...state, nodes: [event] };
  }

  const nodes = state.nodes.map((n) =>
    previousRoot && n.id === previousRoot.id ? { ...n, parentId: event.id } : n,
  );
  return { ...state, nodes: [event, ...nodes] };
}

/** Remove EVENT root and promote its children to top-level (timer mode). */
export function stripEventRoot(state: GraphState): GraphState {
  const event = state.nodes.find((n) => n.kind === "event" && n.parentId === null);
  if (!event) return state;

  const kids = childrenOf(state.nodes, event.id);
  const nodes = state.nodes
    .filter((n) => n.id !== event.id)
    .map((n) => (n.parentId === event.id ? { ...n, parentId: null } : n));

  // Prefer a single IF root if present.
  const ifRoot = kids.find((n) => n.kind === "if") ?? nodes.find((n) => n.kind === "if");
  if (ifRoot) {
    return {
      ...state,
      nodes: nodes.map((n) =>
        n.id === ifRoot.id
          ? { ...n, parentId: null }
          : n.parentId === null && n.id !== ifRoot.id && isConditionKind(n.kind)
            ? { ...n, parentId: ifRoot.id }
            : n,
      ),
    };
  }

  if (nodes.every((n) => n.parentId !== null) || nodes.length === 0) {
    return { ...state, nodes: [createNode("if", null, "condition"), ...nodes] };
  }

  return { ...state, nodes };
}

export function allowedChildKinds(node: GraphNode, _nodes: GraphNode[]): GraphNodeKind[] {
  if (isEventKind(node.kind)) {
    const kinds: GraphNodeKind[] = ["filter", "action"];
    const hasIf = _nodes.some((n) => n.kind === "if");
    if (!hasIf) kinds.splice(1, 0, "if");
    return kinds;
  }

  if (isFilterKind(node.kind)) {
    return ["filter", "action"];
  }

  if (isConditionKind(node.kind)) {
    const kinds: GraphNodeKind[] = ["and", "or", "source", "filter", "action"];
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
    const kinds: GraphNodeKind[] = ["source", "and"];
    if (
      (node.kind === "action" || node.kind === "else") &&
      !_nodes.some((n) => n.kind === "catch" && n.parentId === node.id)
    ) {
      kinds.push("catch");
    }
    return kinds;
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
  const root = graphRoot(state.nodes);
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

/** Walk ancestors to find which branch a SOURCE should reattach to after save/load. */
export function sourceAttachTo(node: GraphNode, nodes: GraphNode[]): SourceAttachTo {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cursor: string | null = node.parentId;
  while (cursor) {
    const parent = byId.get(cursor);
    if (!parent) break;
    if (parent.kind === "action" || parent.kind === "else" || parent.kind === "catch") {
      return parent.kind;
    }
    if (isConditionKind(parent.kind) || isEventKind(parent.kind)) return "if";
    cursor = parent.parentId;
  }
  return "if";
}

export function graphToRulePayload(state: GraphState): {
  if: RuleIf;
  action: RuleThen;
  else?: RuleThen;
  catch?: RuleThen;
  event?: RuleEvent;
  filters?: RuleFilter[];
} {
  const conditionNodes = state.nodes.filter(
    (n) => isConditionKind(n.kind) && isConditionConfigured(n),
  );
  const sourceNodes = state.nodes.filter(
    (n) => isSourceKind(n.kind) && isConditionConfigured(n),
  );

  const ifClauses: RuleIfClause[] = [
    ...conditionNodes.map((n) => ({
      integration: n.integration!,
      trigger: n.trigger!,
      config: n.config,
    })),
    ...sourceNodes.map((n) => {
      const attachTo = sourceAttachTo(n, state.nodes);
      const clause: RuleIfClause = {
        integration: n.integration!,
        trigger: n.trigger!,
        config: n.config,
      };
      if (attachTo !== "if") clause.attachTo = attachTo;
      return clause;
    }),
  ];

  const filters = state.nodes
    .filter((n) => isFilterNodeConfigured(n))
    .map((n) => filterFromNodeConfig(n.config))
    .filter((item): item is RuleFilter => Boolean(item));

  const actionNodes = state.nodes.filter((n) => n.kind === "action" && isActionConfigured(n));
  const elseNodes = state.nodes.filter((n) => n.kind === "else" && isActionConfigured(n));
  const catchNodes = state.nodes.filter((n) => n.kind === "catch" && isActionConfigured(n));

  const actionClauses: RuleThenClause[] = actionNodes.map((n) => ({
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
  const everyClause = ifClauses.find(
    (clause) => clause.integration === "time" && clause.trigger === "every",
  );
  const pollInterval = everyClause
    ? String(everyClause.config.interval ?? "15m").trim() || "15m"
    : state.pollInterval;
  const ifBlock = serializeIf(ifClauses, pollInterval, mode);
  const actionBlock = serializeThen(actionClauses) ?? { all: [] as RuleThenClause[] };
  const elseBlock = serializeThen(elseClauses);
  const catchBlock = serializeThen(catchClauses);
  const event = eventConfigFromGraph(state);

  return {
    if: ifBlock,
    action: actionBlock,
    ...(elseBlock ? { else: elseBlock } : {}),
    ...(catchBlock ? { catch: catchBlock } : {}),
    ...(event ? { event } : {}),
    filters,
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
    action?: RuleThen;
    then?: RuleThen;
    else?: RuleThen;
    catch?: RuleThen;
    runTrigger?: string;
    event?: RuleEvent;
    filters?: RuleFilter[];
  },
  integrations: Integration[] = [],
): GraphState {
  const ifBlock = normalizeIf(rule.if);
  const actionBlock = normalizeThen(rule.action ?? rule.then);
  const elseBlock = normalizeThen(rule.else);
  const catchBlock = normalizeThen(rule.catch);
  const mode = ifBlock.mode;
  const isEventRule = rule.runTrigger === "event" || rule.runTrigger === "webhook";
  const filters = Array.isArray(rule.filters) ? rule.filters : [];

  const conditionClauses = ifBlock.clauses.filter((c) => !isDataClause(c, integrations));
  const sourceClauses = ifBlock.clauses.filter((c) => isDataClause(c, integrations));

  const useSplit = integrations.length > 0;
  const conditions = useSplit ? conditionClauses : ifBlock.clauses;
  const sources = useSplit ? sourceClauses : [];

  const nodes: GraphNode[] = [];
  let eventId: string | null = null;

  if (isEventRule) {
    const eventNode = createNode("event", null);
    const source = rule.event?.source === "homeassistant" ? "homeassistant" : "webhook";
    eventNode.config = {
      source,
      ...(source === "homeassistant"
        ? {
            eventType: rule.event?.eventType ?? "state_changed",
            entityId: rule.event?.entityId ?? "",
          }
        : {}),
    };
    nodes.push(eventNode);
    eventId = eventNode.id;
  }

  let conditionParentId: string | null = eventId;
  let lastConditionId: string | null = null;

  conditions.forEach((clause, index) => {
    const kind: GraphNodeKind = index === 0 ? "if" : mode === "any" ? "or" : "and";
    const node = createNode(kind, index === 0 ? eventId : conditionParentId, "condition");
    node.integration = clause.integration;
    node.trigger = clause.trigger;
    node.config = clause.config;
    nodes.push(node);
    conditionParentId = node.id;
    lastConditionId = node.id;
  });

  if (!lastConditionId && !isEventRule) {
    nodes.push(createNode("if", null, "condition"));
    lastConditionId = nodes[nodes.length - 1].id;
  }

  const attachPoint = lastConditionId ?? eventId;
  if (!attachPoint) {
    nodes.push(createNode("if", null, "condition"));
  }

  const filterParent = eventId ?? lastConditionId ?? nodes[0]?.id ?? null;
  let lastFilterId: string | null = null;
  for (const filter of filters) {
    const node = createNode("filter", filterParent);
    node.config = {
      path: filter.path,
      op: filter.op,
      value: filter.value ?? "",
    };
    nodes.push(node);
    lastFilterId = node.id;
  }

  const actionParent = lastConditionId ?? lastFilterId ?? eventId ?? nodes[0].id;

  actionBlock.all.forEach((clause, index) => {
    const parent =
      index === 0 ? actionParent : nodes.filter((n) => n.kind === "action").at(-1)?.id ?? actionParent;
    const node = createNode("action", parent);
    node.integration = clause.integration;
    node.action = clause.action;
    node.config = clause.config;
    nodes.push(node);
  });

  elseBlock.all.forEach((clause, index) => {
    const parent =
      index === 0
        ? lastConditionId ?? actionParent
        : nodes.filter((n) => n.kind === "else").at(-1)?.id ?? lastConditionId ?? actionParent;
    const node = createNode("else", parent);
    node.integration = clause.integration;
    node.action = clause.action;
    node.config = clause.config;
    nodes.push(node);
  });

  const firstActionForCatch = nodes.find((n) => n.kind === "action");
  const catchAttach = firstActionForCatch?.id ?? actionParent;

  catchBlock.all.forEach((clause, index) => {
    const parent =
      index === 0
        ? catchAttach
        : nodes.filter((n) => n.kind === "catch").at(-1)?.id ?? catchAttach;
    const node = createNode("catch", parent);
    node.integration = clause.integration;
    node.action = clause.action;
    node.config = clause.config;
    nodes.push(node);
  });

  const placeSources = (clauses: RuleIfClause[], seedParentId: string) => {
    let parentId = seedParentId;
    for (const clause of clauses) {
      const node = createNode("source", parentId, "source");
      node.integration = clause.integration;
      node.trigger = clause.trigger;
      node.config = clause.config;
      nodes.push(node);
      parentId = node.id;
    }
  };

  const sourcesByAttach = (target: SourceAttachTo) =>
    sources.filter((clause) => normalizeSourceAttachTo(clause.attachTo) === target);

  if (lastConditionId) placeSources(sourcesByAttach("if"), lastConditionId);

  const firstAction = nodes.find((n) => n.kind === "action");
  const firstElse = nodes.find((n) => n.kind === "else");
  const firstCatch = nodes.find((n) => n.kind === "catch");

  placeSources(sourcesByAttach("action"), firstAction?.id ?? lastConditionId ?? actionParent);
  placeSources(sourcesByAttach("else"), firstElse?.id ?? lastConditionId ?? actionParent);
  placeSources(sourcesByAttach("catch"), firstCatch?.id ?? lastConditionId ?? actionParent);

  return {
    nodes,
    pollInterval: ifBlock.pollInterval ?? "15m",
  };
}

/**
 * Classify trigger nodes as condition vs source from integration metadata.
 * Preserves parent links — SOURCE stays attached to wherever it was added.
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
      if (node.kind === "if" && !node.parentId) {
        return { ...node, slot: "condition" as const };
      }
      // IF under EVENT should stay IF even for data triggers if it's the filter root.
      if (node.kind === "if") {
        return { ...node, slot: "condition" as const };
      }
      return { ...node, kind: "source" as const, slot: "source" as const };
    }

    if (node.kind === "source") {
      return {
        ...node,
        kind: (node.parentId && !isEventKind(
          state.nodes.find((n) => n.id === node.parentId)?.kind ?? "if",
        )
          ? "and"
          : "if") as GraphNodeKind,
        slot: "condition" as const,
      };
    }

    return { ...node, slot: "condition" as const };
  });

  return { ...state, nodes };
}

export function graphValidation(state: GraphState): { ok: boolean; message?: string } {
  const eventNode = state.nodes.find((n) => n.kind === "event");
  const conditions = state.nodes.filter(
    (n) => isConditionKind(n.kind) && isConditionConfigured(n),
  );
  const actions = state.nodes.filter((n) => n.kind === "action" && isActionConfigured(n));
  const elses = state.nodes.filter((n) => n.kind === "else" && isActionConfigured(n));
  const catches = state.nodes.filter((n) => n.kind === "catch" && isActionConfigured(n));
  const incompleteFilter = state.nodes.find((n) => isFilterKind(n.kind) && !isFilterNodeConfigured(n));

  if (eventNode && !isEventConfigured(eventNode)) {
    return { ok: false, message: "Configure the Event source (webhook or Home Assistant)." };
  }

  if (incompleteFilter) {
    return { ok: false, message: "Configure each Filter (path, operator, value)." };
  }

  if (!eventNode && conditions.length === 0) {
    return { ok: false, message: "Add at least one If condition." };
  }

  if (actions.length === 0 && elses.length === 0 && catches.length === 0) {
    return { ok: false, message: "Add an Action, Else, or Catch." };
  }
  return { ok: true };
}

export const NODE_COLORS: Record<GraphNodeKind, { fill: string; stroke: string; label: string }> = {
  event: { fill: "#3f4f6a", stroke: "#2f3c52", label: "EVENT" },
  filter: { fill: "#5c4a32", stroke: "#463724", label: "FILTER" },
  if: { fill: "#2a261f", stroke: "#2a261f", label: "IF" },
  and: { fill: "#a07a3a", stroke: "#8a6830", label: "AND" },
  or: { fill: "#5b7c99", stroke: "#4a6780", label: "OR" },
  source: { fill: "#0f766e", stroke: "#0d9488", label: "SOURCE" },
  action: { fill: "#3d6b4f", stroke: "#2f5440", label: "ACTION" },
  else: { fill: "#8b4d3b", stroke: "#6f3d2f", label: "ELSE" },
  catch: { fill: "#b45309", stroke: "#92400e", label: "CATCH" },
};

/** Dark-mode accents stay in the same warm family but stay readable on espresso parchment. */
export const NODE_COLORS_DARK: Record<GraphNodeKind, { fill: string; stroke: string; label: string }> = {
  event: { fill: "#8fa3c4", stroke: "#6f86a8", label: "EVENT" },
  filter: { fill: "#c4a882", stroke: "#a88860", label: "FILTER" },
  if: { fill: "#d9cdb6", stroke: "#cfc3a8", label: "IF" },
  and: { fill: "#c4a05a", stroke: "#a88840", label: "AND" },
  or: { fill: "#7aa2d4", stroke: "#5b7c99", label: "OR" },
  source: { fill: "#2dd4bf", stroke: "#14b8a6", label: "SOURCE" },
  action: { fill: "#6b9b7a", stroke: "#4f7d60", label: "ACTION" },
  else: { fill: "#c47862", stroke: "#a05c48", label: "ELSE" },
  catch: { fill: "#e0a04a", stroke: "#c4842e", label: "CATCH" },
};

export function nodeColorsForMode(mode: "light" | "dark") {
  return mode === "dark" ? NODE_COLORS_DARK : NODE_COLORS;
}
