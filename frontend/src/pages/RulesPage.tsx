import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, App, Button, Card, Col, Empty, Row, Space, Spin, Typography } from "antd";
import { PlusOutlined, PlayCircleOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { api, getIntegration, type Integration, type Rule } from "../api/client";
import { FlowArrow, IntegrationIcon, Toggle } from "../components/ui";
import { normalizeIf, normalizeThen } from "../lib/rules";

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
  const ifClauses = normalizeIf(rule.if).clauses;
  const thenClauses = normalizeThen(rule.then).all;
  const elseClauses = normalizeThen(rule.else).all;

  return (
    <Card
      title={rule.name}
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
        {ifClauses.map((clause, index) => (
          <IntegrationIcon
            key={`if-${clause.integration}-${index}`}
            integration={getIntegration(integrations, clause.integration)}
            size="sm"
          />
        ))}
        <FlowArrow />
        {thenClauses.map((clause, index) => (
          <IntegrationIcon
            key={`then-${clause.integration}-${index}`}
            integration={getIntegration(integrations, clause.integration)}
            size="sm"
          />
        ))}
        {elseClauses.length > 0 && (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 700 }}>
              ELSE
            </Typography.Text>
            {elseClauses.map((clause, index) => (
              <IntegrationIcon
                key={`else-${clause.integration}-${index}`}
                integration={getIntegration(integrations, clause.integration)}
                size="sm"
              />
            ))}
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
