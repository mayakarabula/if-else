import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, App, Button, Card, Col, Empty, Row, Space, Spin, Tag, Typography } from "antd";
import { PlusOutlined, PlayCircleOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { api, getIntegration, type Integration, type Rule } from "../api/client";
import { FlowArrow, IntegrationIcon, Toggle } from "../components/ui";
import {
  normalizeIf,
  normalizeSourceAttachTo,
  normalizeThen,
  type RuleIfClause,
  type SourceAttachTo,
} from "../lib/rules";

function isDataSourceClause(clause: RuleIfClause, integrations: Integration[]): boolean {
  const attach = normalizeSourceAttachTo(clause.attachTo);
  if (attach !== "if") return true;
  const integration = integrations.find((item) => item.id === clause.integration);
  const trigger = integration?.triggers?.find((item) => item.id === clause.trigger);
  return trigger?.kind === "data";
}

function sourcesFor(
  clauses: RuleIfClause[],
  integrations: Integration[],
  target: SourceAttachTo,
): RuleIfClause[] {
  return clauses.filter((clause) => {
    if (!isDataSourceClause(clause, integrations)) return false;
    return normalizeSourceAttachTo(clause.attachTo) === target;
  });
}

function ClauseIcons({
  prefix,
  clauses,
  integrations,
}: {
  prefix: string;
  clauses: RuleIfClause[] | { integration: string }[];
  integrations: Integration[];
}) {
  return (
    <>
      {clauses.map((clause, index) => (
        <IntegrationIcon
          key={`${prefix}-${clause.integration}-${index}`}
          integration={getIntegration(integrations, clause.integration)}
          size="sm"
        />
      ))}
    </>
  );
}

function RuleCard({
  rule,
  integrations,
  onToggle,
  onRun,
  onDelete,
}: {
  rule: Rule;
  integrations: Integration[];
  onToggle: (id: string) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const ifNormalized = normalizeIf(rule.if);
  const allIfClauses = ifNormalized.clauses;
  const conditionClauses = allIfClauses.filter((clause) => !isDataSourceClause(clause, integrations));
  const thenClauses = normalizeThen(rule.action ?? rule.then).all;
  const elseClauses = normalizeThen(rule.else).all;
  const catchClauses = normalizeThen(rule.catch).all;
  const actionSources = sourcesFor(allIfClauses, integrations, "action");
  const elseSources = sourcesFor(allIfClauses, integrations, "else");
  const catchSources = sourcesFor(allIfClauses, integrations, "catch");
  const ifSources = sourcesFor(allIfClauses, integrations, "if");

  const everyClause = ifNormalized.clauses.find(
    (clause) => clause.integration === "time" && clause.trigger === "every",
  );
  const dailyAt = ifNormalized.clauses.some(
    (clause) => clause.integration === "time" && clause.trigger === "daily_at",
  );
  const pollLabel = everyClause
    ? String(everyClause.config.interval ?? "15m")
    : dailyAt
      ? "daily"
      : ifNormalized.pollInterval;
  const triggerLabel = !rule.enabled
    ? "Paused"
    : rule.runTrigger === "webhook" || rule.runTrigger === "event"
      ? "Event"
      : pollLabel
        ? `Timer · ${pollLabel}`
        : "Timer";

  return (
    <Card
      title={
        <Space size={8} wrap>
          <span>{rule.name}</span>
          <Tag>{triggerLabel}</Tag>
        </Space>
      }
      extra={<Toggle checked={rule.enabled} onChange={() => onToggle(rule.id)} label={`Toggle ${rule.name}`} />}
      actions={[
        <Link key="edit" to={`/rules/${rule.id}/edit`}>
          <Button type="text" icon={<EditOutlined />}>
            Edit
          </Button>
        </Link>,
        <Button key="run" type="text" icon={<PlayCircleOutlined />} onClick={() => onRun(rule.id)}>
          Run
        </Button>,
        <Button key="delete" type="text" danger icon={<DeleteOutlined />} onClick={() => onDelete(rule.id)}>
          Delete
        </Button>,
      ]}
    >
      <Space size={8} wrap align="center">
        <ClauseIcons prefix="if" clauses={conditionClauses} integrations={integrations} />
        <ClauseIcons prefix="if-source" clauses={ifSources} integrations={integrations} />
        {(thenClauses.length > 0 || actionSources.length > 0) && (
          <>
            <FlowArrow />
            <ClauseIcons prefix="action-source" clauses={actionSources} integrations={integrations} />
            <ClauseIcons prefix="action" clauses={thenClauses} integrations={integrations} />
          </>
        )}
        {(elseClauses.length > 0 || elseSources.length > 0) && (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 700 }}>
              ELSE
            </Typography.Text>
            <ClauseIcons prefix="else-source" clauses={elseSources} integrations={integrations} />
            <ClauseIcons prefix="else" clauses={elseClauses} integrations={integrations} />
          </>
        )}
        {(catchClauses.length > 0 || catchSources.length > 0) && (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 700 }}>
              CATCH
            </Typography.Text>
            <ClauseIcons prefix="catch-source" clauses={catchSources} integrations={integrations} />
            <ClauseIcons prefix="catch" clauses={catchClauses} integrations={integrations} />
          </>
        )}
      </Space>
    </Card>
  );
}

export function RulesPage() {
  const { modal } = App.useApp();
  const [rules, setRules] = useState<Rule[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [rulesData, integrationsData] = await Promise.all([api.getRules(), api.getIntegrations()]);
      setRules(rulesData);
      setIntegrations(integrationsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rules");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    function onDataChanged(event: Event) {
      const detail = (event as CustomEvent<{ mutations?: string[] }>).detail;
      if (detail?.mutations?.includes("rules")) {
        void refresh();
      }
    }
    window.addEventListener("if-else:data-changed", onDataChanged);
    return () => window.removeEventListener("if-else:data-changed", onDataChanged);
  }, []);

  async function handleToggle(id: string) {
    await api.toggleRule(id);
    await refresh();
  }

  async function handleRun(id: string) {
    await api.runRule(id);
    await refresh();
  }

  function handleDelete(id: string) {
    modal.confirm({
      title: "Delete this rule?",
      content: "This cannot be undone.",
      okText: "Delete",
      okType: "danger",
      onOk: async () => {
        await api.deleteRule(id);
        await refresh();
      },
    });
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Spin size="large" tip="Loading rules..." />
      </div>
    );
  }

  if (error) {
    return <Alert type="error" message={error} showIcon />;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 24 }}>
        <div>
          <Typography.Title level={2} style={{ marginBottom: 8 }}>
            My Rules
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0, maxWidth: 640 }}>
            Turn integrations into simple if-this-then-that automations. Each rule is stored as YAML on disk.
          </Typography.Paragraph>
        </div>
        <Link to="/create">
          <Button type="primary" size="large" icon={<PlusOutlined />}>
            New rule
          </Button>
        </Link>
      </div>

      {rules.length === 0 ? (
        <Empty
          description={
            <span>
              No rules yet.
              <br />
              Create your first automation in a few clicks.
            </span>
          }
        >
          <Link to="/create">
            <Button type="primary" icon={<PlusOutlined />}>
              Create rule
            </Button>
          </Link>
        </Empty>
      ) : (
        <Row gutter={[16, 16]}>
          {rules.map((rule) => (
            <Col key={rule.id} xs={24} sm={12} lg={8}>
              <RuleCard
                rule={rule}
                integrations={integrations}
                onToggle={handleToggle}
                onRun={handleRun}
                onDelete={handleDelete}
              />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
