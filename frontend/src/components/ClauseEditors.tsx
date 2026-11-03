import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Card, Col, Empty, Form, Input, InputNumber, Modal, Row, Space, Tag, Typography, theme } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, SettingOutlined } from "@ant-design/icons";
import type { FieldSchema, Integration, TriggerMeta, ActionMeta } from "../api/client";
import { FieldInput, formLayout, IntegrationIcon } from "./ui";
import { PlaceField } from "./PlaceField";
import { formatClauseOverview } from "../lib/rules";
import { buildArgumentItems, type ArgumentItem } from "./AvailableVariables";

export interface ClauseFormState {
  key: string;
  integration: string | null;
  trigger: string | null;
  config: Record<string, unknown>;
  /** Empty slots and selected clauses: conditions gate the rule; sources supply data. */
  slot: "condition" | "source";
}

export interface ActionClauseFormState {
  key: string;
  integration: string | null;
  action: string | null;
  config: Record<string, unknown>;
}

export function createIfClause(slot: "condition" | "source" = "condition"): ClauseFormState {
  return {
    key: crypto.randomUUID(),
    integration: null,
    trigger: null,
    config: {},
    slot,
  };
}

export function createThenClause(): ActionClauseFormState {
  return {
    key: crypto.randomUUID(),
    integration: null,
    action: null,
    config: {},
  };
}

function defaultConfig(fields: FieldSchema[] = []) {
  return Object.fromEntries(
    fields.map((field) => [field.key, field.default ?? (field.type === "number" ? 0 : "")]),
  );
}

const clauseCardStyle = {
  minHeight: 220,
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
};

function clauseCardStyles(options?: { clickable?: boolean; empty?: boolean }) {
  return {
    body: {
      flex: 1,
      display: "flex",
      flexDirection: "column" as const,
      justifyContent: "center",
      cursor: options?.clickable ? "pointer" : undefined,
      minHeight: options?.empty ? 140 : 88,
    },
    actions: {
      marginTop: "auto",
    },
  };
}

function OptionPickCard({
  integration,
  title,
  description,
  badge,
  selected,
  onClick,
}: {
  integration: Integration;
  title: string;
  description?: string;
  badge?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  const { token } = theme.useToken();

  return (
    <Card
      hoverable
      size="small"
      onClick={onClick}
      style={{
        height: "100%",
        borderColor: selected ? token.colorPrimary : undefined,
        background: selected ? token.colorPrimaryBg : undefined,
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
          {badge && (
            <Tag color="purple" style={{ marginTop: 8 }}>
              {badge}
            </Tag>
          )}
        </div>
      </Space>
    </Card>
  );
}

export function ConfigFields({
  fields,
  values,
  onChange,
  arguments: argumentItems,
}: {
  fields: FieldSchema[];
  values: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  arguments?: ArgumentItem[];
}) {
  const rows: ReactNode[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const next = fields[index + 1];

    if (field.key === "hour" && next?.key === "minute") {
      rows.push(
        <Form.Item key="time" label="Time" required={field.required || next.required} style={{ marginBottom: 0 }}>
          <Space size={8} align="center">
            <InputNumber
              min={0}
              max={23}
              value={typeof values.hour === "number" ? values.hour : Number(values.hour ?? 0)}
              onChange={(value) => onChange({ hour: value ?? 0 })}
              style={{ width: formLayout.numberWidth }}
            />
            <Typography.Text type="secondary">:</Typography.Text>
            <InputNumber
              min={0}
              max={59}
              value={typeof values.minute === "number" ? values.minute : Number(values.minute ?? 0)}
              onChange={(value) => onChange({ minute: value ?? 0 })}
              style={{ width: formLayout.numberWidth }}
            />
          </Space>
        </Form.Item>,
      );
      index += 1;
      continue;
    }

    if (field.type === "place") {
      rows.push(
        <PlaceField
          key={field.key}
          label={field.label}
          required={field.required}
          placeholder={field.placeholder}
          values={values}
          onChange={onChange}
        />,
      );
      continue;
    }

    rows.push(
      <FieldInput
        key={field.key}
        field={field}
        value={values[field.key]}
        onChange={(value) => onChange({ [field.key]: value })}
        arguments={field.type === "textarea" ? argumentItems : undefined}
      />,
    );
  }

  return (
    <Form
      layout="horizontal"
      labelAlign="left"
      colon={false}
      requiredMark={false}
      labelCol={{ flex: `0 0 ${formLayout.labelWidth}px` }}
      wrapperCol={{ flex: "1 1 auto" }}
      style={{ maxWidth: formLayout.labelWidth + formLayout.controlWidth + 48 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{rows}</div>
    </Form>
  );
}

export function IfClauseEditor({
  clause,
  integrations,
  onChange,
  onRemove,
  canRemove,
  lockIntegration = false,
  autoOpenPicker = false,
  title = "If condition",
  slot = "condition",
}: {
  clause: ClauseFormState;
  integrations: Integration[];
  onChange: (clause: ClauseFormState) => void;
  onRemove: () => void;
  canRemove: boolean;
  lockIntegration?: boolean;
  autoOpenPicker?: boolean;
  title?: string;
  slot?: "condition" | "source";
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedIntegration = integrations.find((integration) => integration.id === clause.integration);
  const selectedTrigger = selectedIntegration?.triggers?.find((trigger) => trigger.id === clause.trigger);
  const hasSelection = Boolean(selectedIntegration && selectedTrigger);
  const canChange = !lockIntegration;
  const hasConfig = Boolean(selectedTrigger?.fields.length);
  const isSource = slot === "source";
  const pickLabel = isSource ? "Choose a source" : "Choose a condition";
  const pickEmpty = isSource ? "No matching sources" : "No matching conditions";
  const searchPlaceholder = isSource
    ? "Search integrations or sources"
    : "Search integrations or conditions";
  const overview =
    hasSelection && clause.integration && clause.trigger
      ? formatClauseOverview(
          integrations,
          {
            integration: clause.integration,
            trigger: clause.trigger,
            config: clause.config,
          },
          "if",
        )
      : "";

  useEffect(() => {
    if (!autoOpenPicker) return;
    setSearch("");
    setPickerOpen(true);
  }, [autoOpenPicker]);

  const options = useMemo(() => {
    const query = search.trim().toLowerCase();
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
  }, [integrations, search, isSource]);

  function openPicker() {
    setSearch("");
    setPickerOpen(true);
  }

  function selectTrigger(integrationId: string, trigger: TriggerMeta) {
    const same = clause.integration === integrationId && clause.trigger === trigger.id;
    onChange({
      ...clause,
      integration: integrationId,
      trigger: trigger.id,
      slot,
      config: same ? clause.config : defaultConfig(trigger.fields),
    });
    setPickerOpen(false);
    if (!same && trigger.fields.length > 0) {
      setConfigOpen(true);
    }
  }

  const cardActions: ReactNode[] | undefined = hasSelection
    ? [
        hasConfig ? (
          <Button
            key="configure"
            type="text"
            icon={<SettingOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              setConfigOpen(true);
            }}
          >
            Configure
          </Button>
        ) : null,
        canChange ? (
          <Button
            key="change"
            type="text"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              openPicker();
            }}
          >
            Change
          </Button>
        ) : null,
        canRemove ? (
          <Button
            key="remove"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            Remove
          </Button>
        ) : null,
      ].filter(Boolean)
    : undefined;

  return (
    <>
      <div style={{ flex: 1, display: "flex", minHeight: 220 }}>
        <Card
          className="clause-card"
          title={title}
          hoverable={canChange && hasSelection}
          onClick={canChange && hasSelection ? openPicker : undefined}
          actions={cardActions}
          style={{ ...clauseCardStyle, flex: 1, width: "100%" }}
          styles={clauseCardStyles({
            clickable: canChange && hasSelection,
            empty: !hasSelection,
          })}
        >
          {hasSelection && selectedIntegration && selectedTrigger ? (
            <Space size={12} align="center">
              <IntegrationIcon integration={selectedIntegration} size="sm" />
              <div style={{ minWidth: 0 }}>
                <Typography.Text strong>{selectedIntegration.name}</Typography.Text>
                <div>
                  <Typography.Text type="secondary">
                    {overview || selectedTrigger.label}
                  </Typography.Text>
                </div>
              </div>
            </Space>
          ) : (
            <Button type="dashed" block icon={<PlusOutlined />} onClick={openPicker}>
              {pickLabel}
            </Button>
          )}
        </Card>
      </div>

      <Modal
        title={pickLabel}
        open={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        footer={null}
        destroyOnHidden
        centered
        width={640}
      >
        <Input.Search
          allowClear
          autoFocus
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 16 }}
        />
        <div style={{ maxHeight: "min(50vh, 420px)", overflowY: "auto" }}>
          {options.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={pickEmpty} />
          ) : (
            <Row gutter={[12, 12]}>
              {options.map(({ key, integration, trigger }) => (
                <Col key={key} span={24}>
                  <OptionPickCard
                    integration={integration}
                    title={trigger.label}
                    description={trigger.description}
                    selected={clause.integration === integration.id && clause.trigger === trigger.id}
                    onClick={() => selectTrigger(integration.id, trigger)}
                  />
                </Col>
              ))}
            </Row>
          )}
        </div>
      </Modal>

      <Modal
        title={`Configure · ${selectedTrigger?.label ?? (isSource ? "source" : "condition")}`}
        open={configOpen}
        onCancel={() => setConfigOpen(false)}
        onOk={() => setConfigOpen(false)}
        okText="Done"
        destroyOnHidden
        centered
        width={640}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {selectedTrigger && selectedTrigger.fields.length > 0 ? (
            <ConfigFields
              fields={selectedTrigger.fields}
              values={clause.config}
              onChange={(patch) => onChange({ ...clause, config: { ...clause.config, ...patch } })}
            />
          ) : (
            <Typography.Text type="secondary">
              No configuration needed for this {isSource ? "source" : "condition"}.
            </Typography.Text>
          )}
        </Space>
      </Modal>
    </>
  );
}

export function ThenClauseEditor({
  clause,
  integrations,
  ifClauses = [],
  onChange,
  onRemove,
  canRemove,
  lockIntegration = false,
  title = "Then action",
}: {
  clause: ActionClauseFormState;
  integrations: Integration[];
  ifClauses?: ClauseFormState[];
  onChange: (clause: ActionClauseFormState) => void;
  onRemove: () => void;
  canRemove: boolean;
  lockIntegration?: boolean;
  title?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedIntegration = integrations.find((integration) => integration.id === clause.integration);
  const selectedAction = selectedIntegration?.actions?.find((action) => action.id === clause.action);
  const hasSelection = Boolean(selectedIntegration && selectedAction);
  const canChange = !lockIntegration;
  const hasConfig = Boolean(selectedAction?.fields.length);
  const argumentItems = useMemo(
    () => buildArgumentItems(ifClauses, integrations),
    [ifClauses, integrations],
  );
  const overview =
    hasSelection && clause.integration && clause.action
      ? formatClauseOverview(
          integrations,
          {
            integration: clause.integration,
            action: clause.action,
            config: clause.config,
          },
          "then",
        )
      : "";

  const options = useMemo(() => {
    const query = search.trim().toLowerCase();
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
  }, [integrations, search]);

  function openPicker() {
    setSearch("");
    setPickerOpen(true);
  }

  function selectAction(integrationId: string, action: ActionMeta) {
    const same = clause.integration === integrationId && clause.action === action.id;
    onChange({
      ...clause,
      integration: integrationId,
      action: action.id,
      config: same ? clause.config : defaultConfig(action.fields),
    });
    setPickerOpen(false);
    if (!same && action.fields.length > 0) {
      setConfigOpen(true);
    }
  }

  const cardActions: ReactNode[] | undefined = hasSelection
    ? [
        hasConfig ? (
          <Button
            key="configure"
            type="text"
            icon={<SettingOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              setConfigOpen(true);
            }}
          >
            Configure
          </Button>
        ) : null,
        canChange ? (
          <Button
            key="change"
            type="text"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              openPicker();
            }}
          >
            Change
          </Button>
        ) : null,
        canRemove ? (
          <Button
            key="remove"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            Remove
          </Button>
        ) : null,
      ].filter(Boolean)
    : undefined;

  return (
    <>
      <div style={{ flex: 1, display: "flex", minHeight: 220 }}>
        <Card
          className="clause-card"
          title={title}
          hoverable={canChange && hasSelection}
          onClick={canChange && hasSelection ? openPicker : undefined}
          actions={cardActions}
          style={{ ...clauseCardStyle, flex: 1, width: "100%" }}
          styles={clauseCardStyles({
            clickable: canChange && hasSelection,
            empty: !hasSelection,
          })}
        >
          {hasSelection && selectedIntegration && selectedAction ? (
            <Space size={12} align="center">
              <IntegrationIcon integration={selectedIntegration} size="sm" />
              <div style={{ minWidth: 0 }}>
                <Typography.Text strong>{selectedIntegration.name}</Typography.Text>
                <div>
                  <Typography.Text type="secondary">
                    {overview || selectedAction.label}
                  </Typography.Text>
                </div>
              </div>
            </Space>
          ) : (
            <Button type="dashed" block icon={<PlusOutlined />} onClick={openPicker}>
              Choose an action
            </Button>
          )}
        </Card>
      </div>

      <Modal
        title="Choose an action"
        open={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        footer={null}
        destroyOnHidden
        centered
        width={640}
      >
        <Input.Search
          allowClear
          autoFocus
          placeholder="Search integrations or actions"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 16 }}
        />
        <div style={{ maxHeight: "min(50vh, 420px)", overflowY: "auto" }}>
          {options.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No matching actions" />
          ) : (
            <Row gutter={[12, 12]}>
              {options.map(({ key, integration, action }) => (
                <Col key={key} xs={24} sm={12}>
                  <OptionPickCard
                    integration={integration}
                    title={action.label}
                    description={action.description}
                    selected={clause.integration === integration.id && clause.action === action.id}
                    onClick={() => selectAction(integration.id, action)}
                  />
                </Col>
              ))}
            </Row>
          )}
        </div>
      </Modal>

      <Modal
        title={`Configure · ${selectedAction?.label ?? "action"}`}
        open={configOpen}
        onCancel={() => setConfigOpen(false)}
        onOk={() => setConfigOpen(false)}
        okText="Done"
        destroyOnHidden
        centered
        width={720}
      >
        {selectedAction && selectedAction.fields.length > 0 ? (
          <ConfigFields
            fields={selectedAction.fields}
            values={clause.config}
            onChange={(patch) => onChange({ ...clause, config: { ...clause.config, ...patch } })}
            arguments={argumentItems}
          />
        ) : (
          <Typography.Text type="secondary">No configuration needed for this action.</Typography.Text>
        )}
      </Modal>
    </>
  );
}

export function AndDivider() {
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingBlock: 4 }}>
      <Tag>AND</Tag>
    </div>
  );
}
