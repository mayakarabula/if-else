import { useMemo, useState } from "react";
import { Button, Col, Empty, Input, Modal, Row, Space, Typography } from "antd";
import { EditOutlined } from "@ant-design/icons";
import type { ActionMeta, Integration, TriggerMeta } from "../api/client";
import { ConfigFields } from "./ClauseEditors";
import { IntegrationIcon } from "./ui";
import { buildArgumentItems } from "./AvailableVariables";
import {
  isActionKind,
  isConditionKind,
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
        width: "100%",
        textAlign: "left",
        padding: 12,
        borderRadius: 12,
        border: selected ? "1.5px solid var(--app-primary)" : "1px solid rgba(42,38,31,0.12)",
        background: selected ? "rgba(160,122,58,0.08)" : "var(--app-paper)",
        cursor: "pointer",
      }}
    >
      <Space align="start" size={12}>
        <IntegrationIcon integration={integration} size="sm" />
        <div style={{ minWidth: 0 }}>
          <Typography.Text strong>{integration.name}</Typography.Text>
          <div>
            <Typography.Text type="secondary">{title}</Typography.Text>
          </div>
          {description && (
            <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0, marginTop: 4 }}>
              {description}
            </Typography.Paragraph>
          )}
        </div>
      </Space>
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

  const isCondition = node ? isConditionKind(node.kind) : false;
  const isAction = node ? isActionKind(node.kind) : false;
  const isSource = node?.slot === "source";

  const selectedIntegration = integrations.find((item) => item.id === node?.integration);
  const selectedTrigger = selectedIntegration?.triggers?.find((item) => item.id === node?.trigger);
  const selectedAction = selectedIntegration?.actions?.find((item) => item.id === node?.action);
  const hasSelection = isCondition
    ? Boolean(node?.integration && node?.trigger)
    : Boolean(node?.integration && node?.action);

  const ifClauses = graph.nodes
    .filter((n) => isConditionKind(n.kind))
    .map((n) => ({
      key: n.id,
      integration: n.integration,
      trigger: n.trigger,
      config: n.config,
      slot: n.slot,
    }));
  const argumentItems = useMemo(() => {
    const items = buildArgumentItems(ifClauses, integrations);
    if (node?.kind === "catch") {
      items.unshift({
        token: "{{error.message}}",
        short: "error.message",
        label: "Error message",
        description: "Message from the failed trigger or action",
        groupLabel: "Catch",
      });
    }
    return items;
  }, [ifClauses, integrations, node?.kind]);

  const options = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (isCondition) {
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
  }, [integrations, search, isCondition, isSource]);

  const showPicker = !hasSelection || picking;
  const kindLabel = node?.kind.toUpperCase() ?? "Node";

  const overview =
    hasSelection && node
      ? isCondition && node.integration && node.trigger
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
    onChange({
      integration: integrationId,
      trigger: trigger.id,
      action: null,
      config: same ? node!.config : defaultConfig(trigger.fields),
      slot: trigger.kind === "data" ? "source" : "condition",
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
        ? "This node supplies data you can insert into Then / Else / Catch actions."
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
                  isCondition
                    ? isSource
                      ? "Search integrations or sources"
                      : "Search integrations or conditions"
                    : "Search integrations or actions"
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div style={{ maxHeight: "min(46vh, 380px)", overflowY: "auto" }}>
                {options.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={isCondition ? "No matching conditions" : "No matching actions"}
                  />
                ) : (
                  <Row gutter={[12, 12]}>
                    {options.map((option) => {
                      if ("trigger" in option) {
                        const { key, integration, trigger } = option;
                        return (
                          <Col key={key} span={24}>
                            <OptionCard
                              integration={integration}
                              title={trigger.label}
                              description={trigger.description}
                              selected={node.integration === integration.id && node.trigger === trigger.id}
                              onClick={() => selectTrigger(integration.id, trigger)}
                            />
                          </Col>
                        );
                      }
                      const { key, integration, action } = option;
                      return (
                        <Col key={key} span={24}>
                          <OptionCard
                            integration={integration}
                            title={action.label}
                            description={action.description}
                            selected={node.integration === integration.id && node.action === action.id}
                            onClick={() => selectAction(integration.id, action)}
                          />
                        </Col>
                      );
                    })}
                  </Row>
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
                          (isCondition ? selectedTrigger?.label : selectedAction?.label) ||
                          "Selected"}
                      </Typography.Text>
                    </div>
                  </div>
                </Space>
                <Button icon={<EditOutlined />} onClick={() => { setSearch(""); setPicking(true); }}>
                  Change
                </Button>
              </div>

              {isCondition && selectedTrigger && selectedTrigger.fields.length > 0 && (
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

              {((isCondition && selectedTrigger && selectedTrigger.fields.length === 0) ||
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
