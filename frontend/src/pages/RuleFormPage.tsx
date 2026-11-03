import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Steps,
  Switch,
  Typography,
  theme,
} from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { api, getIntegration, type FieldSchema, type Integration } from "../api/client";
import {
  ConfigFields,
  createIfClause,
  createThenClause,
  IfClauseEditor,
  ThenClauseEditor,
  type ActionClauseFormState,
  type ClauseFormState,
} from "../components/ClauseEditors";
import { FieldInput, formLayout, IntegrationIcon } from "../components/ui";
import { buildArgumentItems, type ArgumentItem } from "../components/AvailableVariables";
import {
  clauseLabel,
  formatClauseConfigSummary,
  normalizeIf,
  normalizeThen,
  serializeIf,
  serializeThen,
} from "../lib/rules";

type Step = "if" | "then" | "review";

function OverviewClauseCard({
  title,
  integration,
  subtitle,
  details,
  configTitle,
  fields,
  values,
  onChangeConfig,
  arguments: argumentItems,
}: {
  title: string;
  integration?: Integration;
  subtitle: string;
  details: string[];
  configTitle: string;
  fields: FieldSchema[];
  values: Record<string, unknown>;
  onChangeConfig: (config: Record<string, unknown>) => void;
  arguments?: ArgumentItem[];
}) {
  const [configOpen, setConfigOpen] = useState(false);
  const hasConfig = fields.length > 0;

  return (
    <>
      <Card
        className="clause-card"
        size="small"
        title={title}
        style={{
          width: 280,
          height: "100%",
          minHeight: 180,
          display: "flex",
          flexDirection: "column",
        }}
        styles={{
          body: { flex: 1, minHeight: 96 },
          actions: { marginTop: "auto" },
        }}
        actions={
          hasConfig
            ? [
                <Button
                  key="configure"
                  type="text"
                  icon={<SettingOutlined />}
                  onClick={() => setConfigOpen(true)}
                >
                  Configure
                </Button>,
              ]
            : undefined
        }
      >
        <Space size={12} align="start">
          <IntegrationIcon integration={integration} size="sm" />
          <div style={{ minWidth: 0 }}>
            <Typography.Text strong>{integration?.name ?? "Unknown"}</Typography.Text>
            <div>
              <Typography.Text type="secondary">{subtitle}</Typography.Text>
            </div>
            {details.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {details.map((line) => (
                  <li key={line}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {line}
                    </Typography.Text>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Space>
      </Card>

      <Modal
        title={`Configure · ${configTitle}`}
        open={configOpen}
        onCancel={() => setConfigOpen(false)}
        onOk={() => setConfigOpen(false)}
        okText="Done"
        destroyOnHidden
        centered
        width={argumentItems ? 720 : 640}
      >
        {fields.length > 0 ? (
          <ConfigFields
            fields={fields}
            values={values}
            onChange={(patch) => onChangeConfig({ ...values, ...patch })}
            arguments={argumentItems}
          />
        ) : (
          <Typography.Text type="secondary">No configuration needed for this step.</Typography.Text>
        )}
      </Modal>
    </>
  );
}

function toIfClauseForm(
  clause: {
    integration: string;
    trigger: string;
    config: Record<string, unknown>;
  },
  integrations: Integration[],
): ClauseFormState {
  const integration = integrations.find((item) => item.id === clause.integration);
  const trigger = integration?.triggers?.find((item) => item.id === clause.trigger);
  const slot: "condition" | "source" = trigger?.kind === "data" ? "source" : "condition";

  return {
    key: crypto.randomUUID(),
    integration: clause.integration,
    trigger: clause.trigger,
    config: clause.config,
    slot,
  };
}

function toThenClauseForm(clause: {
  integration: string;
  action: string;
  config: Record<string, unknown>;
}): ActionClauseFormState {
  return {
    key: crypto.randomUUID(),
    integration: clause.integration,
    action: clause.action,
    config: clause.config,
  };
}

function isIfClauseSelected(clause: ClauseFormState) {
  return Boolean(clause.integration && clause.trigger);
}

function isThenClauseSelected(clause: ActionClauseFormState) {
  return Boolean(clause.integration && clause.action);
}

/** Keep selected clauses, plus one trailing empty card per slot. */
function withTrailingEmptyIf(clauses: ClauseFormState[]): ClauseFormState[] {
  const selected = clauses.filter(isIfClauseSelected);
  const conditions = selected.filter((clause) => clause.slot === "condition");
  const sources = selected.filter((clause) => clause.slot === "source");
  const conditionEmpty =
    clauses.find((clause) => !isIfClauseSelected(clause) && clause.slot === "condition") ??
    createIfClause("condition");
  const sourceEmpty =
    clauses.find((clause) => !isIfClauseSelected(clause) && clause.slot === "source") ??
    createIfClause("source");
  return [...conditions, conditionEmpty, ...sources, sourceEmpty];
}

/** Keep selected actions, plus one trailing empty “Choose an action” card. */
function withTrailingEmptyThen(clauses: ActionClauseFormState[]): ActionClauseFormState[] {
  const selected = clauses.filter(isThenClauseSelected);
  const empty = clauses.find((clause) => !isThenClauseSelected(clause)) ?? createThenClause();
  return [...selected, empty];
}

export function RuleFormPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = Boolean(id);

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(isEditing);
  const [step, setStep] = useState<Step>("if");
  const [name, setName] = useState("New automation");
  const [enabled, setEnabled] = useState(true);
  const [ifClauses, setIfClauses] = useState<ClauseFormState[]>([
    createIfClause("condition"),
    createIfClause("source"),
  ]);
  const [pollInterval, setPollInterval] = useState("15m");
  const [thenClauses, setThenClauses] = useState<ActionClauseFormState[]>([createThenClause()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) return;
    api.getIntegrations().then(setIntegrations);
  }, [id]);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setError(null);

    Promise.all([api.getRule(id), api.getIntegrations()])
      .then(([rule, integrationsData]) => {
        const ifBlock = normalizeIf(rule.if);
        const thenBlock = normalizeThen(rule.then);

        setIntegrations(integrationsData);
        setName(rule.name);
        setEnabled(rule.enabled);
        setIfClauses(
          withTrailingEmptyIf(ifBlock.all.map((clause) => toIfClauseForm(clause, integrationsData))),
        );
        setPollInterval(ifBlock.pollInterval ?? "15m");
        setThenClauses(withTrailingEmptyThen(thenBlock.all.map(toThenClauseForm)));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load rule");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const selectedIfClauses = ifClauses.filter(isIfClauseSelected);
  const selectedConditions = selectedIfClauses.filter((clause) => clause.slot === "condition");
  const selectedSources = selectedIfClauses.filter((clause) => clause.slot === "source");
  const conditionClauses = ifClauses.filter((clause) => clause.slot === "condition");
  const sourceClauses = ifClauses.filter((clause) => clause.slot === "source");
  const selectedThenClauses = thenClauses.filter(isThenClauseSelected);
  const hasTimeClause = selectedConditions.some((clause) => clause.integration === "time");
  const ifReady = selectedConditions.length > 0;
  const thenReady = selectedThenClauses.length > 0;
  const argumentItems = buildArgumentItems(ifClauses, integrations);

  const stepItems = [
    { key: "if", title: "Choose If" },
    { key: "then", title: "Choose Then" },
    { key: "review", title: "Review" },
  ];
  const stepIndex = stepItems.findIndex((item) => item.key === step);

  function updateIfClause(index: number, clause: ClauseFormState) {
    setIfClauses((current) =>
      withTrailingEmptyIf(current.map((item, i) => (i === index ? clause : item))),
    );
  }

  function updateThenClause(index: number, clause: ActionClauseFormState) {
    setThenClauses((current) =>
      withTrailingEmptyThen(current.map((item, i) => (i === index ? clause : item))),
    );
  }

  async function handleSave() {
    if (!ifReady || !thenReady) return;

    setSaving(true);
    setError(null);

    const payload = {
      name,
      enabled,
      if: serializeIf(
        selectedIfClauses.map((clause) => ({
          integration: clause.integration!,
          trigger: clause.trigger!,
          config: clause.config,
        })),
        pollInterval,
      ),
      then: serializeThen(
        selectedThenClauses.map((clause) => ({
          integration: clause.integration!,
          action: clause.action!,
          config: clause.config,
        })),
      ),
    };

    try {
      if (isEditing && id) {
        await api.updateRule(id, payload);
      } else {
        await api.createRule(payload);
      }
      message.success(isEditing ? "Rule updated" : "Rule created");
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Spin size="large" tip="Loading rule..." />
      </div>
    );
  }

  if (isEditing && error && !ifReady) {
    return (
      <Space direction="vertical">
        <Alert type="error" message={error} showIcon />
        <Button onClick={() => navigate("/")}>Back to rules</Button>
      </Space>
    );
  }

  return (
    <div>
      <Typography.Title level={2} style={{ marginBottom: 8 }}>
        {isEditing ? "Edit rule" : "Create rule"}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Pick conditions that must pass, then optional data sources and the actions to run.
      </Typography.Paragraph>

      <Steps
        current={stepIndex}
        items={stepItems}
        onChange={(index) => setStep(stepItems[index].key as Step)}
        style={{ marginTop: 24, marginBottom: 24, maxWidth: 720 }}
      />

      {step === "if" && (
        <Space direction="vertical" size={24} style={{ width: "100%" }}>
          <div>
            <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
              If all of these happen...
            </Typography.Title>
            <Typography.Text type="secondary">
              Everything here must pass for the rule to continue. Add data sources on the next step.
            </Typography.Text>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "stretch" }}>
            {conditionClauses.map((clause, index) => {
              const selected = isIfClauseSelected(clause);
              return (
                <div key={clause.key} style={{ width: 320, display: "flex" }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                    <IfClauseEditor
                      clause={clause}
                      integrations={integrations}
                      slot="condition"
                      onChange={(next) => {
                        setIfClauses((current) =>
                          withTrailingEmptyIf(
                            current.map((item) => (item.key === clause.key ? next : item)),
                          ),
                        );
                      }}
                      onRemove={() =>
                        setIfClauses((current) =>
                          withTrailingEmptyIf(current.filter((item) => item.key !== clause.key)),
                        )
                      }
                      canRemove={selected}
                      lockIntegration={isEditing && selected}
                      title={index === 0 ? "If condition" : "AND condition"}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {!hasTimeClause && (
            <Form
              layout="horizontal"
              labelAlign="left"
              colon={false}
              requiredMark={false}
              labelCol={{ flex: `0 0 ${formLayout.labelWidth}px` }}
              wrapperCol={{ flex: "1 1 auto" }}
              style={{ maxWidth: formLayout.labelWidth + formLayout.controlWidth + 24 }}
            >
              <FieldInput
                field={{ key: "pollInterval", label: "Check every", type: "text", placeholder: "15m" }}
                value={pollInterval}
                onChange={(value) => setPollInterval(String(value))}
                compact
              />
            </Form>
          )}

          <Button type="primary" disabled={!ifReady} onClick={() => setStep("then")}>
            Continue
          </Button>
        </Space>
      )}

      {step === "then" && (
        <Space direction="vertical" size={32} style={{ width: "100%" }}>
          <div>
            <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
              Then…
            </Typography.Title>
            <Typography.Text type="secondary">
              Pull in optional data, then choose the actions to run. Insert arguments while configuring messages.
            </Typography.Text>
          </div>

          <div>
            <Typography.Text strong style={{ fontSize: 15 }}>
              Sources
            </Typography.Text>
            <div>
              <Typography.Text type="secondary">
                Optional data (like weather) you can insert into action fields.
              </Typography.Text>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                alignItems: "stretch",
                marginTop: 12,
              }}
            >
              {sourceClauses.map((clause, index) => {
                const selected = isIfClauseSelected(clause);
                return (
                  <div key={clause.key} style={{ width: 320, display: "flex" }}>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                      <IfClauseEditor
                        clause={clause}
                        integrations={integrations}
                        slot="source"
                        onChange={(next) => {
                          setIfClauses((current) =>
                            withTrailingEmptyIf(
                              current.map((item) => (item.key === clause.key ? next : item)),
                            ),
                          );
                        }}
                        onRemove={() =>
                          setIfClauses((current) =>
                            withTrailingEmptyIf(current.filter((item) => item.key !== clause.key)),
                          )
                        }
                        canRemove={selected}
                        lockIntegration={isEditing && selected}
                        title={index === 0 ? "Data source" : "AND source"}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <Typography.Text strong style={{ fontSize: 15 }}>
              Actions
            </Typography.Text>
            <div>
              <Typography.Text type="secondary">
                Everything here runs when the If conditions pass.
              </Typography.Text>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                alignItems: "stretch",
                marginTop: 12,
              }}
            >
              {thenClauses.map((clause, index) => {
                const selected = isThenClauseSelected(clause);
                return (
                  <div key={clause.key} style={{ width: 320, display: "flex" }}>
                    <div style={{ flex: 1, minHeight: 220 }}>
                      <ThenClauseEditor
                        clause={clause}
                        integrations={integrations}
                        ifClauses={ifClauses}
                        onChange={(next) => {
                          setThenClauses((current) =>
                            withTrailingEmptyThen(
                              current.map((item) => (item.key === clause.key ? next : item)),
                            ),
                          );
                        }}
                        onRemove={() =>
                          setThenClauses((current) =>
                            withTrailingEmptyThen(current.filter((item) => item.key !== clause.key)),
                          )
                        }
                        canRemove={selected}
                        lockIntegration={isEditing && selected}
                        title={index === 0 ? "Then action" : "AND action"}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Space>
            <Button onClick={() => setStep("if")}>Back</Button>
            <Button type="primary" disabled={!thenReady} onClick={() => setStep("review")}>
              Continue
            </Button>
          </Space>
        </Space>
      )}

      {step === "review" && (
        <Space direction="vertical" size={32} style={{ width: "100%" }}>
          <div>
            <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
              Review and save
            </Typography.Title>
            <Typography.Text type="secondary">
              Give the rule a clear name, set whether it should run, then confirm the flow below.
            </Typography.Text>
          </div>

          <div
            style={{
              display: "grid",
              gap: 20,
              maxWidth: formLayout.labelWidth + formLayout.controlWidth + 64,
              padding: 20,
              borderRadius: token.borderRadiusLG,
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Form
              layout="horizontal"
              labelAlign="left"
              colon={false}
              requiredMark={false}
              labelCol={{ flex: `0 0 ${formLayout.labelWidth}px` }}
              wrapperCol={{ flex: "1 1 auto" }}
            >
              <Form.Item
                label="Rule name"
                required
                validateStatus={name.trim() ? undefined : "error"}
                help={name.trim() ? undefined : "A name is required before saving."}
                style={{ marginBottom: 0 }}
              >
                <Input
                  value={name}
                  placeholder="e.g. Cold morning Telegram alert"
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  style={{ maxWidth: formLayout.controlWidth, width: "100%" }}
                />
              </Form.Item>
            </Form>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 20,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Typography.Text strong>Run automatically</Typography.Text>
                <div>
                  <Typography.Text type="secondary">
                    {enabled
                      ? "On — evaluates when your If conditions match."
                      : "Off — saved paused until you turn it on."}
                  </Typography.Text>
                </div>
              </div>
              <Switch
                checked={enabled}
                onChange={setEnabled}
                checkedChildren="On"
                unCheckedChildren="Off"
              />
            </div>
          </div>

          <div
            style={{
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              paddingTop: 28,
            }}
          >
            <Typography.Text strong style={{ fontSize: 15 }}>
              Overview
            </Typography.Text>
            <div>
              <Typography.Text type="secondary">
                {selectedConditions.length} condition{selectedConditions.length === 1 ? "" : "s"}
                {selectedSources.length > 0
                  ? ` · ${selectedSources.length} source${selectedSources.length === 1 ? "" : "s"}`
                  : ""}
                {" → "}
                {selectedThenClauses.length} action
                {selectedThenClauses.length === 1 ? "" : "s"}
                {!hasTimeClause ? ` · checks every ${pollInterval}` : ""}
              </Typography.Text>
            </div>
          </div>

          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12, letterSpacing: 0.04 }}>
              CONDITIONS
            </Typography.Text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, alignItems: "stretch" }}>
              {selectedConditions.map((clause, index) => {
                const integration = getIntegration(integrations, clause.integration!);
                const trigger = integration?.triggers?.find((item) => item.id === clause.trigger);
                const details = formatClauseConfigSummary(
                  integrations,
                  {
                    integration: clause.integration!,
                    trigger: clause.trigger!,
                    config: clause.config,
                  },
                  "if",
                );
                const subtitle = clauseLabel(
                  integrations,
                  {
                    integration: clause.integration!,
                    trigger: clause.trigger!,
                    config: clause.config,
                  },
                  "if",
                );

                return (
                  <OverviewClauseCard
                    key={clause.key}
                    title={index === 0 ? "If condition" : "AND condition"}
                    integration={integration}
                    subtitle={subtitle}
                    details={details}
                    configTitle={trigger?.label ?? "condition"}
                    fields={trigger?.fields ?? []}
                    values={clause.config}
                    onChangeConfig={(config) => {
                      const clauseIndex = ifClauses.findIndex((item) => item.key === clause.key);
                      if (clauseIndex >= 0) updateIfClause(clauseIndex, { ...clause, config });
                    }}
                  />
                );
              })}
            </div>
          </div>

          {selectedSources.length > 0 && (
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12, letterSpacing: 0.04 }}>
                SOURCES
              </Typography.Text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, alignItems: "stretch" }}>
                {selectedSources.map((clause, index) => {
                  const integration = getIntegration(integrations, clause.integration!);
                  const trigger = integration?.triggers?.find((item) => item.id === clause.trigger);
                  const details = formatClauseConfigSummary(
                    integrations,
                    {
                      integration: clause.integration!,
                      trigger: clause.trigger!,
                      config: clause.config,
                    },
                    "if",
                  );
                  const subtitle = clauseLabel(
                    integrations,
                    {
                      integration: clause.integration!,
                      trigger: clause.trigger!,
                      config: clause.config,
                    },
                    "if",
                  );

                  return (
                    <OverviewClauseCard
                      key={clause.key}
                      title={index === 0 ? "Data source" : "AND source"}
                      integration={integration}
                      subtitle={subtitle}
                      details={details}
                      configTitle={trigger?.label ?? "source"}
                      fields={trigger?.fields ?? []}
                      values={clause.config}
                      onChangeConfig={(config) => {
                        const clauseIndex = ifClauses.findIndex((item) => item.key === clause.key);
                        if (clauseIndex >= 0) updateIfClause(clauseIndex, { ...clause, config });
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12, letterSpacing: 0.04 }}>
              ACTIONS
            </Typography.Text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, alignItems: "stretch" }}>
              {selectedThenClauses.map((clause, index) => {
                const integrationId = clause.integration!;
                const actionId = clause.action!;
                const integration = getIntegration(integrations, integrationId);
                const action = integration?.actions?.find((item) => item.id === actionId);
                const details = formatClauseConfigSummary(
                  integrations,
                  {
                    integration: integrationId,
                    action: actionId,
                    config: clause.config,
                  },
                  "then",
                );
                const subtitle = clauseLabel(
                  integrations,
                  {
                    integration: integrationId,
                    action: actionId,
                    config: clause.config,
                  },
                  "then",
                );

                return (
                  <OverviewClauseCard
                    key={clause.key}
                    title={index === 0 ? "Then action" : "AND action"}
                    integration={integration}
                    subtitle={subtitle}
                    details={details}
                    configTitle={action?.label ?? "action"}
                    fields={action?.fields ?? []}
                    values={clause.config}
                    arguments={argumentItems}
                    onChangeConfig={(config) => {
                      const clauseIndex = thenClauses.findIndex((item) => item.key === clause.key);
                      if (clauseIndex >= 0) updateThenClause(clauseIndex, { ...clause, config });
                    }}
                  />
                );
              })}
            </div>
          </div>

          {error && <Alert type="error" message={error} showIcon />}

          <Space>
            <Button onClick={() => setStep("then")}>Back</Button>
            <Button type="primary" loading={saving} disabled={!name.trim()} onClick={handleSave}>
              {isEditing ? "Save changes" : "Save rule"}
            </Button>
          </Space>
        </Space>
      )}
    </div>
  );
}
