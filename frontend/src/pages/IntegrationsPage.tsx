import { useEffect, useMemo, useState } from "react";
import { App, Button, Card, Col, Empty, Form, Modal, Row, Space, Spin, Tag, Typography } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { api, type Integration } from "../api/client";
import { FieldInput, formLayout, IntegrationIcon } from "../components/ui";

const integrationFields: Record<
  string,
  { key: string; label: string; type: "text" | "textarea"; placeholder?: string }[]
> = {
  telegram: [
    { key: "botToken", label: "Bot token", type: "text", placeholder: "123456:ABC..." },
    { key: "chatId", label: "Chat ID", type: "text", placeholder: "123456789" },
  ],
};

const integrationCopy: Record<string, string> = {
  time: "Schedule rules to run once per day at a chosen time and timezone.",
  weather:
    "Open-Meteo weather conditions and data — no API key. Pick a place when you build a rule.",
  wifi: "Discover devices on this machine’s LAN (ARP + ping). Match a device IP or scan nearby hosts.",
  telegram: "Send messages and weather reports via a Telegram bot. Configure token and chat ID here.",
};

function configStatus(
  integrationId: string,
  config: Record<string, Record<string, unknown>>,
): "ready" | "needs_setup" | "no_setup" {
  const fields = integrationFields[integrationId];
  if (!fields || fields.length === 0) return "no_setup";
  const values = config[integrationId] ?? {};
  const complete = fields.every((field) => String(values[field.key] ?? "").trim().length > 0);
  return complete ? "ready" : "needs_setup";
}

function IntegrationOverviewCard({
  integration,
  config,
  onConfigure,
}: {
  integration: Integration;
  config: Record<string, Record<string, unknown>>;
  onConfigure: () => void;
}) {
  const conditions = (integration.triggers ?? []).filter((item) => (item.kind ?? "condition") !== "data");
  const sources = (integration.triggers ?? []).filter((item) => item.kind === "data");
  const actions = integration.actions ?? [];
  const fields = integrationFields[integration.id] ?? [];
  const status = configStatus(integration.id, config);
  const description =
    integrationCopy[integration.id] ??
    ([
      conditions.length ? `${conditions.length} condition${conditions.length === 1 ? "" : "s"}` : null,
      sources.length ? `${sources.length} source${sources.length === 1 ? "" : "s"}` : null,
      actions.length ? `${actions.length} action${actions.length === 1 ? "" : "s"}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Available in rules.");

  return (
    <Card
      className="clause-card"
      title={
        <Space size={12} align="center">
          <IntegrationIcon integration={integration} size="sm" />
          <span>{integration.name}</span>
        </Space>
      }
      styles={{
        body: { minHeight: 120 },
        actions: { marginTop: "auto" },
      }}
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
      actions={
        fields.length > 0
          ? [
              <Button key="configure" type="text" icon={<SettingOutlined />} onClick={onConfigure}>
                Configure
              </Button>,
            ]
          : undefined
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {description}
      </Typography.Paragraph>

      <Space size={[8, 8]} wrap>
        {conditions.map((item) => (
          <Tag key={`c-${item.id}`}>If · {item.label}</Tag>
        ))}
        {sources.map((item) => (
          <Tag key={`s-${item.id}`} color="blue">
            Source · {item.label}
          </Tag>
        ))}
        {actions.map((item) => (
          <Tag key={`a-${item.id}`} color="green">
            Then · {item.label}
          </Tag>
        ))}
      </Space>

      {[...conditions, ...sources, ...actions].some((item) => item.actionPlan?.length) && (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11, letterSpacing: 0.04 }}>
            ACTION PLANS
          </Typography.Text>
          {[...conditions, ...sources, ...actions]
            .filter((item) => item.actionPlan?.length)
            .map((item) => (
              <div key={`plan-${item.id}`} style={{ marginTop: 6 }}>
                <Typography.Text strong style={{ fontSize: 12 }}>
                  {item.label}
                </Typography.Text>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                  {item.actionPlan!.join(" → ")}
                </Typography.Paragraph>
              </div>
            ))}
        </div>
      )}

      {[...conditions, ...sources, ...actions].some((item) => item.errorCallback?.length) && (
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 10, fontSize: 12 }}>
          CATCH can use error callback fields like{" "}
          {[...conditions, ...sources, ...actions]
            .flatMap((item) => item.errorCallback ?? [])
            .filter((field, index, all) => all.findIndex((f) => f.path === field.path) === index)
            .slice(0, 4)
            .map((field) => `{{error.${field.path}}}`)
            .join(", ")}
          .
        </Typography.Text>
      )}

      {fields.length > 0 && (
        <Typography.Text
          type={status === "ready" ? "success" : "warning"}
          style={{ display: "block", marginTop: 12, fontSize: 12 }}
        >
          {status === "ready" ? "Configured" : "Needs setup"}
        </Typography.Text>
      )}
    </Card>
  );
}

export function IntegrationsPage() {
  const { message } = App.useApp();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [config, setConfig] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getIntegrations(), api.getIntegrationConfig()])
      .then(([integrationsData, configData]) => {
        setIntegrations(integrationsData);
        setConfig(configData);
      })
      .catch((err) => {
        message.error(err instanceof Error ? err.message : "Failed to load integrations");
      })
      .finally(() => setLoading(false));
  }, [message]);

  const editing = useMemo(
    () => integrations.find((item) => item.id === editingId) ?? null,
    [editingId, integrations],
  );
  const editingFields = editing ? integrationFields[editing.id] ?? [] : [];

  async function handleSave() {
    setSaving(true);
    try {
      await api.saveIntegrationConfig(config);
      message.success("Integration settings saved.");
      setEditingId(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Spin size="large" tip="Loading integrations..." />
      </div>
    );
  }

  return (
    <div>
      <Typography.Title level={2} style={{ marginBottom: 8 }}>
        Integrations
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
        Everything you can use in If / Then rules. Secrets are stored in config/integrations.yaml.
      </Typography.Paragraph>

      {integrations.length === 0 ? (
        <Empty description="No integrations registered." />
      ) : (
        <Row gutter={[16, 16]} style={{ marginTop: 8 }}>
          {integrations.map((integration) => (
            <Col key={integration.id} xs={24} sm={12} lg={8}>
              <IntegrationOverviewCard
                integration={integration}
                config={config}
                onConfigure={() => setEditingId(integration.id)}
              />
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title={editing ? `Configure · ${editing.name}` : "Configure"}
        open={Boolean(editing)}
        onCancel={() => setEditingId(null)}
        onOk={handleSave}
        okText="Save"
        confirmLoading={saving}
        destroyOnHidden
        centered
        width={640}
      >
        {editing && (
          <>
            <Typography.Paragraph type="secondary">
              {integrationCopy[editing.id] ?? "Update connection settings for this integration."}
            </Typography.Paragraph>
            <Form
              layout="horizontal"
              labelAlign="left"
              colon={false}
              requiredMark={false}
              labelCol={{ flex: `0 0 ${formLayout.labelWidth}px` }}
              wrapperCol={{ flex: "1 1 auto" }}
              style={{ maxWidth: formLayout.labelWidth + formLayout.controlWidth + 24 }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {editingFields.map((field) => (
                  <FieldInput
                    key={field.key}
                    field={field}
                    value={config[editing.id]?.[field.key]}
                    onChange={(value) =>
                      setConfig((prev) => ({
                        ...prev,
                        [editing.id]: { ...prev[editing.id], [field.key]: value },
                      }))
                    }
                  />
                ))}
              </div>
            </Form>
          </>
        )}
      </Modal>
    </div>
  );
}
