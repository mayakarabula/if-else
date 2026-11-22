import { useMemo, useState } from "react";
import { Button, Empty, Input, Modal, Space, Typography } from "antd";
import { EditOutlined } from "@ant-design/icons";
import type { ActionMeta, Integration, TriggerMeta } from "../api/client";
import { ConfigFields } from "./ClauseEditors";
import { IntegrationIcon } from "./ui";
import { buildArgumentItems } from "./AvailableVariables";
import {
  isActionKind,
  isSourceKind,
  isTriggerKind,
  type GraphNode,
  type GraphState,
} from "../lib/graph";
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
        border: selected ? "1.5px solid var(--app-primary)" : "1px solid rgba(42,38,31,0.12)",
        background: selected ? "rgba(160,122,58,0.08)" : "var(--app-paper)",
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
  onClose,
  onChange,
}: {
  open: boolean;
  node: GraphNode | null;
  graph: GraphState;
  integrations: Integration[];
  onClose: () => void;
  onChange: (patch: Partial<GraphNode>) => void;
}) {
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState(false);

  const isAction = node ? isActionKind(node.kind) : false;
  const isSource = node ? isSourceKind(node.kind) || node.slot === "source" : false;
  const isTrigger = node ? isTriggerKind(node.kind) : false;

  const selectedIntegration = integrations.find((item) => item.id === node?.integration);
  const selectedTrigger = selectedIntegration?.triggers?.find((item) => item.id === node?.trigger);
  const selectedAction = selectedIntegration?.actions?.find((item) => item.id === node?.action);
  const hasSelection = isTrigger
    ? Boolean(node?.integration && node?.trigger)
    : Boolean(node?.integration && node?.action);

  const ifClauses = graph.nodes
    .filter((n) => isTriggerKind(n.kind))
    .map((n) => ({
      key: n.id,
      integration: n.integration,
      trigger: n.trigger,
      config: n.config,
      slot: n.slot,
    }));
  const argumentItems = useMemo(() => {
    const items = buildArgumentItems(ifClauses, integrations);
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
  }, [ifClauses, integrations, node?.kind]);

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

  const showPicker = !hasSelection || picking;
  const kindLabel = node?.kind.toUpperCase() ?? "Node";

  const overview =
    hasSelection && node
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
              "then",
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

  const help =
    !node
      ? ""
      : isSource
        ? "SOURCE — optional data (like weather) you can insert into Then / Else / Catch fields."
        : node.kind === "or"
          ? "OR — alternative condition. If any OR branch passes, the rule continues."
          : node.kind === "and"
            ? "AND — this condition must also pass."
            : node.kind === "else"
              ? "ELSE — runs when the If conditions do not pass."
              : node.kind === "catch"
                ? "CATCH — runs when a trigger or action throws. Use {{error.message}} in templates."
                : node.kind === "then"
                  ? "THEN — runs when the If conditions pass."
                  : "IF — the starting condition for this automation.";

  return (
    <Modal
      title={`Configure · ${kindLabel}`}
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
      width={680}
      afterOpenChange={(visible) => {
        if (visible && node && !hasSelection) {
          setPicking(true);
        }
      }}
    >
      {node && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Typography.Text type="secondary">{help}</Typography.Text>

          {showPicker ? (
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
                  border: "1px solid rgba(42,38,31,0.12)",
                  background: "rgba(42,38,31,0.03)",
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
