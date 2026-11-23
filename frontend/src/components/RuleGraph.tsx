import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { Button, Dropdown, Space, Tooltip, Typography, theme } from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  SettingOutlined,
  WarningFilled,
  ZoomInOutlined,
  ZoomOutOutlined,
  AimOutlined,
} from "@ant-design/icons";
import type { Integration } from "../api/client";
import {
  nodeColorsForMode,
  allowedChildKinds,
  graphRoot,
  isActionConfigured,
  isActionKind,
  isConditionConfigured,
  isEventConfigured,
  isEventKind,
  isSourceKind,
  isTriggerKind,
  type GraphNode,
  type GraphNodeKind,
  type GraphState,
} from "../lib/graph";
import { analyzeGraphIssues, type GraphIssue } from "../lib/graphIssues";
import { clauseLabel, formatClauseOverview } from "../lib/rules";
import { useThemeMode } from "../theme";

const ISSUE_RED = "#c45c4a";

const NODE_W = 188;
const NODE_H = 84;
const H_GAP = 56;
const V_GAP = 36;
const ACCENT_W = 5;
const MOBILE_BREAKPOINT = 768;

type GraphOrientation = "horizontal" | "vertical";

interface LayoutNode {
  id: string;
  node: GraphNode;
  x: number;
  y: number;
  depth: number;
}

interface LayoutLink {
  source: LayoutNode;
  target: LayoutNode;
  label?: string;
}

function layoutGraph(
  nodes: GraphNode[],
  orientation: GraphOrientation,
): { laid: LayoutNode[]; links: LayoutLink[]; width: number; height: number } {
  if (nodes.length === 0) {
    return { laid: [], links: [], width: 400, height: 240 };
  }

  const root = graphRoot(nodes) ?? nodes[0];
  const byParent = new Map<string | null, GraphNode[]>();
  for (const n of nodes) {
    const key = n.parentId;
    const list = byParent.get(key) ?? [];
    list.push(n);
    byParent.set(key, list);
  }

  const sortKids = (kids: GraphNode[]) =>
    [...kids].sort((a, b) => {
      const order = (k: GraphNodeKind) =>
        k === "event"
          ? 0
          : k === "and" || k === "or"
            ? 1
            : k === "source"
              ? 2
              : k === "action"
                ? 3
                : k === "else"
                  ? 4
                  : k === "catch"
                    ? 5
                    : 6;
      return order(a.kind) - order(b.kind) || a.id.localeCompare(b.id);
    });

  const vertical = orientation === "vertical";
  const laid: LayoutNode[] = [];
  const links: LayoutLink[] = [];
  let leafIndex = 0;

  const place = (node: GraphNode, depth: number): LayoutNode => {
    const kids = sortKids(byParent.get(node.id) ?? []);
    const childLayouts = kids.map((k) => place(k, depth + 1));

    let cross: number;
    if (childLayouts.length === 0) {
      cross = leafIndex * ((vertical ? NODE_W : NODE_H) + (vertical ? H_GAP * 0.55 : V_GAP));
      leafIndex += 1;
    } else {
      const first = childLayouts[0];
      const last = childLayouts[childLayouts.length - 1];
      cross = vertical ? (first.x + last.x) / 2 : (first.y + last.y) / 2;
    }

    const layout: LayoutNode = {
      id: node.id,
      node,
      x: vertical ? cross : depth * (NODE_W + H_GAP),
      y: vertical ? depth * (NODE_H + V_GAP) : cross,
      depth,
    };
    laid.push(layout);

    for (const child of childLayouts) {
      let label: string | undefined;
      if (child.node.kind === "and" || child.node.kind === "or") {
        label = child.node.kind.toUpperCase();
      } else if (child.node.kind === "source") {
        label = isSourceKind(node.kind) ? "AND" : "SOURCE";
      } else if (child.node.kind === "catch") {
        label = "ERROR";
      } else if (
        isActionKind(node.kind) &&
        isActionKind(child.node.kind) &&
        node.kind === child.node.kind
      ) {
        label = "AND";
      }
      links.push({ source: layout, target: child, label });
    }

    return layout;
  };

  place(root, 0);

  const pad = 24;
  if (vertical) {
    const minX = Math.min(...laid.map((n) => n.x), 0);
    for (const n of laid) n.x = n.x - minX + pad;
    for (const n of laid) n.y += pad;
  } else {
    const minY = Math.min(...laid.map((n) => n.y), 0);
    for (const n of laid) n.y = n.y - minY + pad;
    for (const n of laid) n.x += pad;
  }

  const width = Math.max(...laid.map((n) => n.x), 0) + NODE_W + pad * 2;
  const height = Math.max(...laid.map((n) => n.y), 0) + NODE_H + pad * 2;

  return { laid, links, width, height };
}

function nodeSubtitle(node: GraphNode, integrations: Integration[]): string {
  if (isEventKind(node.kind)) {
    if (!isEventConfigured(node)) return "Configure event…";
    const source = String(node.config.source ?? "webhook");
    if (source === "homeassistant") {
      const eventType = String(node.config.eventType ?? "state_changed").trim() || "state_changed";
      const entityId = String(node.config.entityId ?? "").trim();
      return entityId ? `HA · ${eventType} · ${entityId}` : `HA · ${eventType}`;
    }
    return "HTTP webhook";
  }

  if (isTriggerKind(node.kind)) {
    if (!isConditionConfigured(node)) {
      return isSourceKind(node.kind) ? "Pick a data source…" : "Pick a condition…";
    }
    const clause = {
      integration: node.integration!,
      trigger: node.trigger!,
      config: node.config,
    };
    const label = clauseLabel(integrations, clause, "if");
    const overview = formatClauseOverview(integrations, clause, "if");
    return overview ? `${label} · ${overview}` : label;
  }

  if (!isActionConfigured(node)) return "Pick an action…";
  const clause = {
    integration: node.integration!,
    action: node.action!,
    config: node.config,
  };
  const label = clauseLabel(integrations, clause, "action");
  const overview = formatClauseOverview(integrations, clause, "action");
  return overview ? `${label} · ${overview}` : label;
}

function kindLabel(
  node: GraphNode,
  nodes: GraphNode[],
  colors: ReturnType<typeof nodeColorsForMode>,
): string {
  if (node.parentId) {
    const parent = nodes.find((n) => n.id === node.parentId);
    if (parent && parent.kind === node.kind && (isActionKind(node.kind) || isSourceKind(node.kind))) {
      return "AND";
    }
  }
  return colors[node.kind].label;
}

function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);

  return mobile;
}

export function RuleGraph({
  state,
  integrations,
  selectedId,
  touchedIds,
  onSelect,
  onConfigure,
  onAddChild,
  onRemove,
}: {
  state: GraphState;
  integrations: Integration[];
  selectedId: string | null;
  /** Nodes that may show red setup warnings; untouched nodes stay quiet. */
  touchedIds?: Set<string>;
  onSelect: (id: string | null) => void;
  onConfigure: (id: string) => void;
  onAddChild: (parentId: string, kind: GraphNodeKind) => void;
  onRemove: (id: string) => void;
}) {
  const { token } = theme.useToken();
  const { mode } = useThemeMode();
  const colors = useMemo(() => nodeColorsForMode(mode), [mode]);
  const isMobile = useIsMobile();
  const orientation: GraphOrientation = isMobile ? "vertical" : "horizontal";

  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [viewport, setViewport] = useState({ w: 800, h: 420 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { laid, links, width, height } = useMemo(
    () => layoutGraph(state.nodes, orientation),
    [state.nodes, orientation],
  );

  const pathNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedId) return ids;
    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    let cursor: string | null = selectedId;
    while (cursor) {
      ids.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return ids;
  }, [selectedId, state.nodes]);

  const nodeIssues = useMemo(
    () => analyzeGraphIssues(state, integrations, { touchedIds: touchedIds ?? new Set() }),
    [state, integrations, touchedIds],
  );

  const PATH_BLUE = mode === "dark" ? "#8eb6e0" : "#7aa2d4";
  const graphHeight = isMobile ? Math.min(Math.max(height + 48, 520), 720) : 440;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewport({ w: entry.contentRect.width, h: Math.max(360, entry.contentRect.height) });
    });
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: Math.max(360, el.clientHeight) });
    return () => ro.disconnect();
  }, [graphHeight]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;

    const svg = d3.select<SVGSVGElement, unknown>(el);

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.35, 2.5])
      .on("zoom", (event) => {
        svg.select<SVGGElement>("g.viewport").attr("transform", event.transform.toString());
      });

    zoomRef.current = zoom;
    svg.call(zoom);

    const scale = Math.min(
      1,
      (viewport.w - 40) / Math.max(width, 1),
      (viewport.h - 40) / Math.max(height, 1),
    );
    const tx = (viewport.w - width * scale) / 2;
    const ty = Math.max(16, (viewport.h - height * scale) / 2);
    svg.transition().duration(350).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));

    return () => {
      svg.on(".zoom", null);
    };
  }, [width, height, viewport.w, viewport.h, orientation]);

  function zoomBy(factor: number) {
    const el = svgRef.current;
    if (!el || !zoomRef.current) return;
    d3.select<SVGSVGElement, unknown>(el).transition().duration(200).call(zoomRef.current.scaleBy, factor);
  }

  function resetZoom() {
    const el = svgRef.current;
    if (!el || !zoomRef.current) return;
    const scale = Math.min(
      1,
      (viewport.w - 40) / Math.max(width, 1),
      (viewport.h - 40) / Math.max(height, 1),
    );
    const tx = (viewport.w - width * scale) / 2;
    const ty = Math.max(16, (viewport.h - height * scale) / 2);
    d3.select<SVGSVGElement, unknown>(el)
      .transition()
      .duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  const linkPath = (link: LayoutLink) => {
    if (orientation === "vertical") {
      const x1 = link.source.x + NODE_W / 2;
      const y1 = link.source.y + NODE_H;
      const x2 = link.target.x + NODE_W / 2;
      const y2 = link.target.y;
      const my = (y1 + y2) / 2;
      return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
    }
    const x1 = link.source.x + NODE_W;
    const y1 = link.source.y + NODE_H / 2;
    const x2 = link.target.x;
    const y2 = link.target.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };

  const linkLabelPos = (link: LayoutLink) => {
    if (orientation === "vertical") {
      return {
        x: (link.source.x + link.target.x) / 2 + NODE_W / 2,
        y: (link.source.y + NODE_H + link.target.y) / 2,
      };
    }
    return {
      x: (link.source.x + NODE_W + link.target.x) / 2,
      y: (link.source.y + link.target.y) / 2 + NODE_H / 2,
    };
  };

  return (
    <div
      ref={containerRef}
      className="rule-graph"
      style={{
        position: "relative",
        width: "100%",
        height: graphHeight,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: `
          radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--app-primary, #a07a3a) 12%, transparent), transparent 45%),
          radial-gradient(circle at 80% 70%, rgba(61,107,79,0.07), transparent 40%),
          linear-gradient(160deg, ${token.colorBgContainer} 0%, color-mix(in srgb, var(--app-bg, ${token.colorBgLayout}) 70%, ${token.colorBgContainer}) 100%)
        `,
        overflow: "hidden",
        touchAction: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 2,
          display: "flex",
          gap: 6,
        }}
      >
        <Button size="small" icon={<ZoomInOutlined />} onClick={() => zoomBy(1.2)} />
        <Button size="small" icon={<ZoomOutOutlined />} onClick={() => zoomBy(1 / 1.2)} />
        <Button size="small" icon={<AimOutlined />} onClick={resetZoom} />
      </div>

      <Typography.Text
        type="secondary"
        style={{
          position: "absolute",
          left: 14,
          top: 12,
          right: 120,
          zIndex: 2,
          fontSize: 12,
          letterSpacing: 0.04,
        }}
      >
        {isMobile ? "FLOW · pinch / drag · top → bottom" : "FLOW GRAPH · drag to pan · scroll to zoom"}
      </Typography.Text>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ display: "block", cursor: "grab" }}
        onClick={() => onSelect(null)}
      >
        <defs>
          <marker
            id="rule-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={token.colorTextSecondary} opacity="0.55" />
          </marker>
          <marker
            id="rule-arrow-path"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={PATH_BLUE} />
          </marker>
        </defs>

        <g className="viewport">
          {links.map((link) => {
            const onPath =
              pathNodeIds.has(link.target.id) && pathNodeIds.has(link.source.id);
            const labelPos = linkLabelPos(link);
            return (
              <g key={`${link.source.id}-${link.target.id}`}>
                <path
                  d={linkPath(link)}
                  fill="none"
                  stroke={onPath ? PATH_BLUE : token.colorTextSecondary}
                  strokeOpacity={onPath ? 0.9 : 0.45}
                  strokeWidth={2}
                  markerEnd={onPath ? "url(#rule-arrow-path)" : "url(#rule-arrow)"}
                />
                {link.label && (
                  <g transform={`translate(${labelPos.x}, ${labelPos.y})`}>
                    <rect
                      x={-(link.label.length * 3.6 + 10)}
                      y={-10}
                      width={link.label.length * 7.2 + 20}
                      height={20}
                      rx={6}
                      fill={token.colorBgContainer}
                      stroke={onPath ? PATH_BLUE : token.colorBorder}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={10}
                      fontWeight={700}
                      fill={onPath ? PATH_BLUE : token.colorTextSecondary}
                      letterSpacing="0.06em"
                    >
                      {link.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {laid.map((item) => {
            const nodeColor = colors[item.node.kind];
            const selected = selectedId === item.id;
            const issues: GraphIssue[] = nodeIssues.get(item.id) ?? [];
            const hasIssue = issues.length > 0;
            const addOptions = allowedChildKinds(item.node, state.nodes);
            const rootNode = graphRoot(state.nodes);
            const canRemove = item.id !== rootNode?.id;
            const title = kindLabel(item.node, state.nodes, colors);
            const subtitle = hasIssue
              ? issues.map((issue) => issue.message).join(" · ")
              : nodeSubtitle(item.node, integrations);
            const fill = hasIssue
              ? "color-mix(in srgb, #c45c4a 10%, transparent)"
              : selected
                ? token.colorPrimaryBg
                : token.colorBgContainer;

            return (
              <g
                key={item.id}
                transform={`translate(${item.x}, ${item.y})`}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(item.id);
                }}
              >
                <defs>
                  <clipPath id={`node-clip-${item.id}`}>
                    <rect width={NODE_W} height={NODE_H} rx={12} />
                  </clipPath>
                </defs>
                <g clipPath={`url(#node-clip-${item.id})`}>
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    fill={fill}
                    className="rule-graph-node"
                  />
                  <rect width={ACCENT_W} height={NODE_H} fill={hasIssue ? ISSUE_RED : nodeColor.fill} />
                </g>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={12}
                  fill="none"
                  stroke={hasIssue ? ISSUE_RED : token.colorBorder}
                  strokeWidth={hasIssue ? 2 : 1.25}
                  pointerEvents="none"
                />

                <text
                  x={ACCENT_W + 12}
                  y={24}
                  fontSize={11}
                  fontWeight={800}
                  letterSpacing="0.08em"
                  fill={hasIssue ? ISSUE_RED : nodeColor.fill}
                >
                  {title}
                </text>

                <foreignObject x={ACCENT_W + 10} y={32} width={NODE_W - ACCENT_W - 44} height={42}>
                  <div
                    style={{
                      fontSize: 11,
                      lineHeight: 1.3,
                      color: hasIssue ? ISSUE_RED : token.colorTextSecondary,
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      fontFamily: "inherit",
                    }}
                  >
                    {subtitle}
                  </div>
                </foreignObject>

                {hasIssue && (
                  <foreignObject x={NODE_W - 62} y={8} width={28} height={28}>
                    <Tooltip
                      title={
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {issues.map((issue, index) => (
                            <div key={`${issue.code}-${index}`}>{issue.message}</div>
                          ))}
                        </div>
                      }
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          width: 22,
                          height: 22,
                          alignItems: "center",
                          justifyContent: "center",
                          color: ISSUE_RED,
                          fontSize: 14,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <WarningFilled />
                      </span>
                    </Tooltip>
                  </foreignObject>
                )}

                <foreignObject x={NODE_W - 34} y={8} width={28} height={28}>
                  <button
                    type="button"
                    className="rule-graph-configure"
                    title="Configure"
                    onClick={(e) => {
                      e.stopPropagation();
                      onConfigure(item.id);
                    }}
                  >
                    <SettingOutlined style={{ fontSize: 12 }} />
                  </button>
                </foreignObject>

                {addOptions.length > 0 && (
                  <foreignObject x={NODE_W - 28} y={NODE_H - 14} width={36} height={28}>
                    <Dropdown
                      trigger={["click"]}
                      menu={{
                        items: addOptions.map((kind) => ({
                          key: kind,
                          label: colors[kind].label,
                          onClick: () => onAddChild(item.id, kind),
                        })),
                      }}
                    >
                      <button
                        type="button"
                        className="rule-graph-add"
                        onClick={(e) => e.stopPropagation()}
                        title="Add node"
                      >
                        <PlusOutlined style={{ fontSize: 11 }} />
                      </button>
                    </Dropdown>
                  </foreignObject>
                )}

                {canRemove && (
                  <foreignObject x={NODE_W - 56} y={NODE_H - 14} width={28} height={28}>
                    <button
                      type="button"
                      className="rule-graph-remove"
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(item.id);
                      }}
                    >
                      <DeleteOutlined style={{ fontSize: 11 }} />
                    </button>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div
        style={{
          position: "absolute",
          left: 14,
          right: 14,
          bottom: 12,
          zIndex: 2,
          overflowX: "auto",
        }}
      >
        <Space size={8} wrap={!isMobile}>
          {(["event", "if", "and", "or", "source", "action", "else", "catch"] as GraphNodeKind[]).map((kind) => (
            <span
              key={kind}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: token.colorTextSecondary,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: colors[kind].fill,
                }}
              />
              {colors[kind].label}
            </span>
          ))}
        </Space>
      </div>
    </div>
  );
}
