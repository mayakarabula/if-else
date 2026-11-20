import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { Button, Dropdown, Space, Typography, theme } from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  SettingOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  AimOutlined,
} from "@ant-design/icons";
import type { Integration } from "../api/client";
import {
  NODE_COLORS,
  allowedChildKinds,
  isActionConfigured,
  isActionKind,
  isConditionConfigured,
  isConditionKind,
  type GraphNode,
  type GraphNodeKind,
  type GraphState,
} from "../lib/graph";
import { clauseLabel, formatClauseOverview } from "../lib/rules";

const NODE_W = 188;
const NODE_H = 84;
const H_GAP = 56;
const V_GAP = 36;
const ACCENT_W = 5;

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

function layoutGraph(nodes: GraphNode[]): { laid: LayoutNode[]; links: LayoutLink[]; width: number; height: number } {
  if (nodes.length === 0) {
    return { laid: [], links: [], width: 400, height: 240 };
  }

  const root = nodes.find((n) => n.kind === "if" && n.parentId === null) ?? nodes[0];
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
        k === "and" || k === "or" ? 0 : k === "then" ? 1 : k === "else" ? 2 : 3;
      return order(a.kind) - order(b.kind) || a.id.localeCompare(b.id);
    });

  const laid: LayoutNode[] = [];
  const links: LayoutLink[] = [];
  let leafIndex = 0;

  const place = (node: GraphNode, depth: number): LayoutNode => {
    const kids = sortKids(byParent.get(node.id) ?? []);
    const childLayouts = kids.map((k) => place(k, depth + 1));

    let y: number;
    if (childLayouts.length === 0) {
      y = leafIndex * (NODE_H + V_GAP);
      leafIndex += 1;
    } else {
      const top = childLayouts[0].y;
      const bottom = childLayouts[childLayouts.length - 1].y;
      y = (top + bottom) / 2;
    }

    const layout: LayoutNode = {
      id: node.id,
      node,
      x: depth * (NODE_W + H_GAP),
      y,
      depth,
    };
    laid.push(layout);

    for (const child of childLayouts) {
      let label: string | undefined;
      if (child.node.kind === "and" || child.node.kind === "or") {
        label = child.node.kind.toUpperCase();
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
  const minY = Math.min(...laid.map((n) => n.y), 0);
  for (const n of laid) n.y = n.y - minY + pad;
  for (const n of laid) n.x += pad;

  const width = Math.max(...laid.map((n) => n.x), 0) + NODE_W + pad * 2;
  const height = Math.max(...laid.map((n) => n.y), 0) + NODE_H + pad * 2;

  return { laid, links, width, height };
}

function nodeSubtitle(node: GraphNode, integrations: Integration[]): string {
  if (isConditionKind(node.kind)) {
    if (!isConditionConfigured(node)) return "Pick a condition…";
    const overview = formatClauseOverview(
      integrations,
      { integration: node.integration!, trigger: node.trigger!, config: node.config },
      "if",
    );
    if (overview) return overview;
    return clauseLabel(
      integrations,
      { integration: node.integration!, trigger: node.trigger!, config: node.config },
      "if",
    );
  }

  if (!isActionConfigured(node)) return "Pick an action…";
  const overview = formatClauseOverview(
    integrations,
    { integration: node.integration!, action: node.action!, config: node.config },
    "then",
  );
  if (overview) return overview;
  return clauseLabel(
    integrations,
    { integration: node.integration!, action: node.action!, config: node.config },
    "then",
  );
}

function kindLabel(node: GraphNode, nodes: GraphNode[]): string {
  if (isActionKind(node.kind) && node.parentId) {
    const parent = nodes.find((n) => n.id === node.parentId);
    if (parent && parent.kind === node.kind) return "AND";
  }
  return NODE_COLORS[node.kind].label;
}

export function RuleGraph({
  state,
  integrations,
  selectedId,
  onSelect,
  onConfigure,
  onAddChild,
  onRemove,
}: {
  state: GraphState;
  integrations: Integration[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onConfigure: (id: string) => void;
  onAddChild: (parentId: string, kind: GraphNodeKind) => void;
  onRemove: (id: string) => void;
}) {
  const { token } = theme.useToken();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [viewport, setViewport] = useState({ w: 800, h: 420 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { laid, links, width, height } = useMemo(() => layoutGraph(state.nodes), [state.nodes]);

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
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;

    const svg = d3.select<SVGSVGElement, unknown>(el);

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 2.5])
      .on("zoom", (event) => {
        svg.select<SVGGElement>("g.viewport").attr("transform", event.transform.toString());
      });

    zoomRef.current = zoom;
    svg.call(zoom);

    const scale = Math.min(1, (viewport.w - 40) / Math.max(width, 1), (viewport.h - 40) / Math.max(height, 1));
    const tx = (viewport.w - width * scale) / 2;
    const ty = Math.max(16, (viewport.h - height * scale) / 2);
    svg.transition().duration(350).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));

    return () => {
      svg.on(".zoom", null);
    };
  }, [width, height, viewport.w, viewport.h]);

  function zoomBy(factor: number) {
    const el = svgRef.current;
    if (!el || !zoomRef.current) return;
    d3.select<SVGSVGElement, unknown>(el).transition().duration(200).call(zoomRef.current.scaleBy, factor);
  }

  function resetZoom() {
    const el = svgRef.current;
    if (!el || !zoomRef.current) return;
    const scale = Math.min(1, (viewport.w - 40) / Math.max(width, 1), (viewport.h - 40) / Math.max(height, 1));
    const tx = (viewport.w - width * scale) / 2;
    const ty = Math.max(16, (viewport.h - height * scale) / 2);
    d3.select<SVGSVGElement, unknown>(el)
      .transition()
      .duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  const linkPath = (link: LayoutLink) => {
    const x1 = link.source.x + NODE_W;
    const y1 = link.source.y + NODE_H / 2;
    const x2 = link.target.x;
    const y2 = link.target.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };

  return (
    <div
      ref={containerRef}
      className="rule-graph"
      style={{
        position: "relative",
        width: "100%",
        height: 440,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: `
          radial-gradient(circle at 20% 20%, rgba(160,122,58,0.08), transparent 45%),
          radial-gradient(circle at 80% 70%, rgba(61,107,79,0.07), transparent 40%),
          linear-gradient(160deg, ${token.colorBgContainer} 0%, #e8e0d2 100%)
        `,
        overflow: "hidden",
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
          zIndex: 2,
          fontSize: 12,
          letterSpacing: 0.04,
        }}
      >
        FLOW GRAPH · drag to pan · scroll to zoom
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
          <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.12" />
          </filter>
        </defs>

        <g className="viewport">
          {links.map((link) => {
            const midX = (link.source.x + NODE_W + link.target.x) / 2;
            const midY = (link.source.y + link.target.y) / 2 + NODE_H / 2;
            return (
              <g key={`${link.source.id}-${link.target.id}`}>
                <path
                  d={linkPath(link)}
                  fill="none"
                  stroke={token.colorTextSecondary}
                  strokeOpacity={0.45}
                  strokeWidth={2}
                  markerEnd="url(#rule-arrow)"
                />
                {link.label && (
                  <g transform={`translate(${midX}, ${midY})`}>
                    <rect
                      x={-18}
                      y={-10}
                      width={36}
                      height={20}
                      rx={6}
                      fill={token.colorBgContainer}
                      stroke={token.colorBorder}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={10}
                      fontWeight={700}
                      fill={token.colorTextSecondary}
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
            const colors = NODE_COLORS[item.node.kind];
            const selected = selectedId === item.id;
            const addOptions = allowedChildKinds(item.node, state.nodes);
            const canRemove = !(item.node.kind === "if" && item.node.parentId === null);
            const title = kindLabel(item.node, state.nodes);
            const subtitle = nodeSubtitle(item.node, integrations);

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
                    fill={selected ? token.colorPrimaryBg : token.colorBgContainer}
                    className="rule-graph-node"
                  />
                  {/* Kind accent — left border only */}
                  <rect width={ACCENT_W} height={NODE_H} fill={colors.fill} />
                </g>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={12}
                  fill="none"
                  stroke={token.colorBorder}
                  strokeWidth={1.25}
                  pointerEvents="none"
                />

                <text
                  x={ACCENT_W + 12}
                  y={24}
                  fontSize={11}
                  fontWeight={800}
                  letterSpacing="0.08em"
                  fill={colors.fill}
                >
                  {title}
                </text>

                <foreignObject x={ACCENT_W + 10} y={32} width={NODE_W - ACCENT_W - 44} height={42}>
                  <div
                    style={{
                      fontSize: 11,
                      lineHeight: 1.3,
                      color: token.colorTextSecondary,
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
                          label: `Add ${NODE_COLORS[kind].label}`,
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
          bottom: 12,
          zIndex: 2,
        }}
      >
        <Space size={8} wrap>
          {(["if", "and", "or", "then", "else"] as GraphNodeKind[]).map((kind) => (
            <span
              key={kind}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: token.colorTextSecondary,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: NODE_COLORS[kind].fill,
                }}
              />
              {NODE_COLORS[kind].label}
            </span>
          ))}
        </Space>
      </div>
    </div>
  );
}
