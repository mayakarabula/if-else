import { useMemo, useState } from "react";
import {
  AutoComplete,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  ApiOutlined,
  EditOutlined,
  FilterOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import type { ActionMeta, Integration, TriggerMeta } from "../api/client";
import { ConfigFields } from "./ClauseEditors";
import { formLayout, IntegrationIcon, verticalFormProps } from "./ui";
import { buildArgumentItems } from "./AvailableVariables";
import {
  isActionKind,
  isEventConfigured,
  isEventKind,
  isFilterKind,
  isFilterNodeConfigured,
  isSourceKind,
  isTriggerKind,
  type GraphNode,
  type GraphState,
} from "../lib/graph";
import {
  FILTER_OPS,
  eventFilterPathSuggestions,
  filterNeedsValue,
} from "../lib/filters";
import { formatClauseOverview } from "../lib/rules";

function defaultConfig(fields: { key: string; default?: string | number; type: string }[] = []) {
  return Object.fromEntries(
    fields.map((field) => [field.key, field.default ?? (field.type === "number" ? 0 : "")]),
  );
}

function OptionCard({
  integration,
  title,
  description,
  selected,
  onClick,
}: {
  integration: Integration;
  title: string;
  description?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        boxSizing: "border-box",
        width: "100%",
        maxWidth: "100%",
        textAlign: "left",
        padding: 12,
        borderRadius: 12,
        border: selected
          ? "1.5px solid var(--app-primary)"
          : "1px solid var(--app-border-soft, rgba(42,38,31,0.12))",
        background: selected
          ? "color-mix(in srgb, var(--app-primary, #a07a3a) 12%, transparent)"
          : "var(--app-paper)",
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      <div style={{ flex: "0 0 auto" }}>
        <IntegrationIcon integration={integration} size="sm" />
      </div>
      <div style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden" }}>
        <Typography.Text strong ellipsis style={{ display: "block", width: "100%" }}>
          {integration.name}
        </Typography.Text>
        <Typography.Text type="secondary" ellipsis style={{ display: "block", width: "100%" }}>
          {title}
        </Typography.Text>
        {description && (
          <Typography.Paragraph
            type="secondary"
            ellipsis={{ rows: 2 }}
            style={{ marginBottom: 0, marginTop: 4 }}
          >
            {description}
          </Typography.Paragraph>
        )}
      </div>
    </button>
  );
}

export function GraphNodeConfigModal({
  open,
  node,
  graph,
  integrations,
  webhookUrl,
  onClose,
  onChange,
}: {
  open: boolean;
  node: GraphNode | null;
  graph: GraphState;
  integrations: Integration[];
  /** Shown when configuring an EVENT with HTTP webhook source. */
  webhookUrl?: string;
  onClose: () => void;
  onChange: (patch: Partial<GraphNode>) => void;
}) {
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState(false);

  const isEvent = node ? isEventKind(node.kind) : false;
  const isFilter = node ? isFilterKind(node.kind) : false;
  const isAction = node ? isActionKind(node.kind) : false;
  const isSource = node ? isSourceKind(node.kind) || node.slot === "source" : false;
  const isTrigger = node ? isTriggerKind(node.kind) : false;

  const selectedIntegration = integrations.find((item) => item.id === node?.integration);
  const selectedTrigger = selectedIntegration?.triggers?.find((item) => item.id === node?.trigger);
  const selectedAction = selectedIntegration?.actions?.find((item) => item.id === node?.action);
  const hasSelection = isEvent
    ? Boolean(node && isEventConfigured(node))
    : isFilter
      ? Boolean(node && isFilterNodeConfigured(node))
      : isTrigger
        ? Boolean(node?.integration && node?.trigger)
        : Boolean(node?.integration && node?.action);

  const eventNode = graph.nodes.find((n) => n.kind === "event");
  const eventSource = String(eventNode?.config.source ?? node?.config.source ?? "webhook");
  const filterPathOptions = useMemo(() => {
    const suggestions = eventFilterPathSuggestions(eventSource);
    const fromTriggers = buildArgumentItems(
      graph.nodes
        .filter((n) => isTriggerKind(n.kind))
        .map((n) => ({ integration: n.integration, trigger: n.trigger })),
      integrations,
    ).map((item) => ({ value: item.short, label: item.short }));
    const seen = new Set<string>();
    return [...suggestions, ...fromTriggers].filter((item) => {
      if (seen.has(item.value)) return false;
      seen.add(item.value);
      return true;
    });
  }, [eventSource, graph.nodes, integrations]);

  const templateSourceClauses = useMemo(
    () => [
      ...graph.nodes
        .filter((n) => isTriggerKind(n.kind))
        .map((n) => ({ integration: n.integration, trigger: n.trigger })),
      ...graph.nodes
        .filter((n) => n.kind === "action" || n.kind === "else")
        .filter((n) => !node || n.id !== node.id)
        .map((n) => ({ integration: n.integration, action: n.action })),
    ],
    [graph.nodes, node],
  );
  const argumentItems = useMemo(() => {
    const items = buildArgumentItems(templateSourceClauses, integrations);
    if (node?.kind !== "catch") return items;

    const seen = new Set<string>();
    const errorFields: { path: string; label: string; description?: string }[] = [];
    for (const integration of integrations) {
      for (const step of [...(integration.triggers ?? []), ...(integration.actions ?? [])]) {
        for (const field of step.errorCallback ?? []) {
          if (seen.has(field.path)) continue;
          seen.add(field.path);
          errorFields.push(field);
        }
      }
    }

    if (errorFields.length === 0) {
      errorFields.push(
        { path: "message", label: "Error message" },
        { path: "plan", label: "Action plan" },
        { path: "integration", label: "Integration id" },
        { path: "stepLabel", label: "Step label" },
      );
    }

    for (const field of errorFields.reverse()) {
      items.unshift({
        token: `{{error.${field.path}}}`,
        short: `error.${field.path}`,
        label: field.label,
        description: field.description,
        groupLabel: "Catch · error callback",
      });
    }
    return items;
  }, [templateSourceClauses, integrations, node?.kind]);

  const options = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (isTrigger) {
      return integrations
        .filter((integration) => integration.triggers?.length)
        .flatMap((integration) =>
          (integration.triggers ?? []).map((trigger) => ({
            key: `${integration.id}:${trigger.id}`,
            integration,
            trigger,
          })),
        )
        .filter(({ trigger }) => {
          const kind = trigger.kind ?? "condition";
          return isSource ? kind === "data" : kind !== "data";
        })
        .filter(({ integration, trigger }) => {
          if (!query) return true;
          return [integration.name, trigger.label, trigger.description, trigger.id, integration.id]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(query));
        });
    }

    return integrations
      .filter((integration) => integration.actions?.length)
      .flatMap((integration) =>
        (integration.actions ?? []).map((action) => ({
          key: `${integration.id}:${action.id}`,
          integration,
          action,
        })),
      )
      .filter(({ integration, action }) => {
        if (!query) return true;
        return [integration.name, action.label, action.description, action.id, integration.id]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));
      });
  }, [integrations, search, isTrigger, isSource]);

  const showPicker = !isEvent && !isFilter && (!hasSelection || picking);
  const kindLabel = node?.kind.toUpperCase() ?? "Node";
  const nodeEventSource = String(node?.config.source ?? "webhook");
  const kindIcon =
    node?.kind === "filter" ? (
      <FilterOutlined />
    ) : node?.kind === "event" ? (
      <ApiOutlined />
    ) : node?.kind === "if" || node?.kind === "and" || node?.kind === "or" ? (
      <QuestionCircleOutlined />
    ) : null;
  const filterOp = String(node?.config.op ?? "eq");
  const needsFilterValue = filterNeedsValue(filterOp);

  const overview =
    hasSelection && node && !isEvent && !isFilter
      ? isTrigger && node.integration && node.trigger
        ? formatClauseOverview(
            integrations,
            { integration: node.integration, trigger: node.trigger, config: node.config },
            "if",
          )
        : node.integration && node.action
          ? formatClauseOverview(
              integrations,
              { integration: node.integration, action: node.action, config: node.config },
              "action",
            )
          : ""
      : "";

  function selectTrigger(integrationId: string, trigger: TriggerMeta) {
    const same = node?.integration === integrationId && node?.trigger === trigger.id;
    const asSource = isSource || trigger.kind === "data";
    onChange({
      integration: integrationId,
      trigger: trigger.id,
      action: null,
      config: same ? node!.config : defaultConfig(trigger.fields),
      slot: asSource ? "source" : "condition",
      ...(asSource && node && !isSourceKind(node.kind) ? { kind: "source" as const } : {}),
    });
    setPicking(false);
    setSearch("");
  }

  function selectAction(integrationId: string, action: ActionMeta) {
    const same = node?.integration === integrationId && node?.action === action.id;
    onChange({
      integration: integrationId,
      action: action.id,
      trigger: null,
      config: same ? node!.config : defaultConfig(action.fields),
    });
    setPicking(false);
    setSearch("");
  }

  function patchEventConfig(patch: Record<string, unknown>) {
    if (!node) return;
    onChange({ config: { ...node.config, ...patch } });
  }

  function patchFilterConfig(patch: Record<string, unknown>) {
    if (!node) return;
    onChange({ config: { ...node.config, ...patch } });
  }

  const help =
    !node
      ? ""
      : isEvent
        ? "EVENT — when this rule starts (webhook or Home Assistant)."
        : isFilter
          ? "Keep only events where a path matches a value. All filters must pass."
          : isSource
            ? "SOURCE — optional data (like weather) you can insert into Action / Else / Catch fields."
            : node.kind === "or"
              ? "OR — alternative condition. If any OR branch passes, the rule continues."
              : node.kind === "and"
                ? "AND — this condition must also pass."
                : node.kind === "else"
                  ? "ELSE — runs when the If conditions do not pass."
                  : node.kind === "catch"
                    ? "CATCH — runs when a trigger or action throws. Use {{error.message}} in templates."
                    : node.kind === "action"
                      ? "ACTION — runs when the If conditions pass."
                      : "IF — the starting condition for this automation.";

  return (
    <Modal
      title={
        <Space size={8}>
          {kindIcon}
          <span>{`Configure · ${kindLabel}`}</span>
        </Space>
      }
      open={open && Boolean(node)}
      onCancel={() => {
        setPicking(false);
        setSearch("");
        onClose();
      }}
      onOk={() => {
        setPicking(false);
        setSearch("");
        onClose();
      }}
      okText="Done"
      destroyOnHidden
      centered
      width="min(680px, calc(100vw - 24px))"
      styles={{ body: { maxHeight: "min(70vh, 640px)", overflowY: "auto" } }}
      afterOpenChange={(visible) => {
        if (visible && node && !isEvent && !isFilter && !hasSelection) {
          setPicking(true);
        }
      }}
    >
      {node && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Typography.Text type="secondary">{help}</Typography.Text>

          {isFilter ? (
            <Form {...verticalFormProps} style={{ maxWidth: formLayout.controlWidth + 48 }}>
              <Form.Item label="Path" style={{ marginBottom: 12 }}>
                <AutoComplete
                  style={{ width: "100%", maxWidth: formLayout.controlWidth }}
                  options={filterPathOptions}
                  value={String(node.config.path ?? "")}
                  onChange={(value) => patchFilterConfig({ path: value })}
                  placeholder="event.entityId"
                  filterOption={(input, option) =>
                    String(option?.value ?? "")
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {filterPathOptions.slice(0, 8).map((option) => (
                    <Tag
                      key={option.value}
                      style={{ cursor: "pointer", marginInlineEnd: 0 }}
                      onClick={() => patchFilterConfig({ path: option.value })}
                    >
                      {option.label}
                    </Tag>
                  ))}
                </div>
              </Form.Item>
              <Form.Item label="Operator" style={{ marginBottom: 12 }}>
                <Select
                  style={{ width: "100%", maxWidth: formLayout.controlWidth }}
                  value={filterOp}
                  options={FILTER_OPS.map((op) => ({ value: op.value, label: op.label }))}
                  onChange={(op) => patchFilterConfig({ op })}
                />
              </Form.Item>
              {needsFilterValue && (
                <Form.Item label="Value" style={{ marginBottom: 0 }}>
                  <Input
                    style={{ width: "100%", maxWidth: formLayout.controlWidth }}
                    value={String(node.config.value ?? "")}
                    placeholder="e.g. light.kitchen"
                    onChange={(e) => patchFilterConfig({ value: e.target.value })}
                  />
                </Form.Item>
              )}
            </Form>
          ) : isEvent ? (
            <Form {...verticalFormProps} style={{ maxWidth: formLayout.controlWidth + 48 }}>
              <Form.Item label="Source" style={{ marginBottom: 12 }}>
                <Radio.Group
                  optionType="button"
                  buttonStyle="solid"
                  value={nodeEventSource === "homeassistant" ? "homeassistant" : "webhook"}
                  onChange={(e) => {
                    const source = e.target.value as "webhook" | "homeassistant";
                    patchEventConfig(
                      source === "homeassistant"
                        ? {
                            source,
                            eventType: String(node.config.eventType ?? "").trim() || "state_changed",
                            entityId: String(node.config.entityId ?? ""),
                          }
                        : { source },
                    );
                  }}
                  options={[
                    { label: "HTTP webhook", value: "webhook" },
                    { label: "Home Assistant", value: "homeassistant" },
                  ]}
                />
              </Form.Item>

              {nodeEventSource === "homeassistant" ? (
                <>
                  <Form.Item label="Event type" style={{ marginBottom: 12 }}>
                    <Input
                      value={String(node.config.eventType ?? "state_changed")}
                      placeholder="state_changed"
                      onChange={(e) => patchEventConfig({ eventType: e.target.value })}
                      style={{ maxWidth: formLayout.controlWidth }}
                    />
                  </Form.Item>
                  <Form.Item label="Entity ID" style={{ marginBottom: 0 }}>
                    <Input
                      value={String(node.config.entityId ?? "")}
                      placeholder="optional, e.g. light.kitchen"
                      onChange={(e) => patchEventConfig({ entityId: e.target.value })}
                      style={{ maxWidth: formLayout.controlWidth }}
                    />
                  </Form.Item>
                </>
              ) : (
                <Form.Item label="Webhook URL" style={{ marginBottom: 0 }}>
                  {webhookUrl ? (
                    <Input
                      readOnly
                      value={webhookUrl}
                      style={{
                        maxWidth: formLayout.controlWidth + 80,
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 12,
                      }}
                    />
                  ) : (
                    <Typography.Text type="secondary">Shown under Run when</Typography.Text>
                  )}
                </Form.Item>
              )}
            </Form>
          ) : showPicker ? (
            <>
              <Input.Search
                allowClear
                autoFocus
                placeholder={
                  isTrigger
                    ? isSource
                      ? "Search integrations or sources"
                      : "Search integrations or conditions"
                    : "Search integrations or actions"
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div
                style={{
                  maxHeight: "min(46vh, 380px)",
                  overflowX: "hidden",
                  overflowY: "auto",
                }}
              >
                {options.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      isTrigger
                        ? isSource
                          ? "No matching sources"
                          : "No matching conditions"
                        : "No matching actions"
                    }
                  />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                    {options.map((option) => {
                      if ("trigger" in option) {
                        const { key, integration, trigger } = option;
                        return (
                          <OptionCard
                            key={key}
                            integration={integration}
                            title={trigger.label}
                            description={trigger.description}
                            selected={node.integration === integration.id && node.trigger === trigger.id}
                            onClick={() => selectTrigger(integration.id, trigger)}
                          />
                        );
                      }
                      const { key, integration, action } = option;
                      return (
                        <OptionCard
                          key={key}
                          integration={integration}
                          title={action.label}
                          description={action.description}
                          selected={node.integration === integration.id && node.action === action.id}
                          onClick={() => selectAction(integration.id, action)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
              {hasSelection && (
                <Button type="link" onClick={() => setPicking(false)} style={{ paddingInline: 0 }}>
                  Cancel change
                </Button>
              )}
            </>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: 14,
                  borderRadius: 12,
                  border: "1px solid var(--app-border-soft, rgba(42,38,31,0.12))",
                  background: "color-mix(in srgb, var(--app-ink, #2a261f) 4%, transparent)",
                }}
              >
                <Space size={12}>
                  {selectedIntegration && <IntegrationIcon integration={selectedIntegration} size="sm" />}
                  <div>
                    <Typography.Text strong>{selectedIntegration?.name}</Typography.Text>
                    <div>
                      <Typography.Text type="secondary">
                        {overview ||
                          (isTrigger ? selectedTrigger?.label : selectedAction?.label) ||
                          "Selected"}
                      </Typography.Text>
                    </div>
                  </div>
                </Space>
                <Button icon={<EditOutlined />} onClick={() => { setSearch(""); setPicking(true); }}>
                  Change
                </Button>
              </div>

              {((isTrigger && selectedTrigger?.actionPlan?.length) ||
                (isAction && selectedAction?.actionPlan?.length)) && (
                <div>
                  <Typography.Text strong style={{ fontSize: 12, letterSpacing: 0.04 }}>
                    ACTION PLAN
                  </Typography.Text>
                  <ol style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                    {(isTrigger ? selectedTrigger?.actionPlan : selectedAction?.actionPlan)?.map((step) => (
                      <li key={step}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {step}
                        </Typography.Text>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {isTrigger && selectedTrigger && selectedTrigger.fields.length > 0 && (
                <ConfigFields
                  fields={selectedTrigger.fields}
                  values={node.config}
                  onChange={(patch) => onChange({ config: { ...node.config, ...patch } })}
                />
              )}

              {isAction && selectedAction && selectedAction.fields.length > 0 && (
                <ConfigFields
                  fields={selectedAction.fields}
                  values={node.config}
                  onChange={(patch) => onChange({ config: { ...node.config, ...patch } })}
                  arguments={argumentItems}
                />
              )}

              {((isTrigger && selectedTrigger && selectedTrigger.fields.length === 0) ||
                (isAction && selectedAction && selectedAction.fields.length === 0)) && (
                <Typography.Text type="secondary">No extra fields for this step.</Typography.Text>
              )}
            </>
          )}
        </Space>
      )}
    </Modal>
  );
}
