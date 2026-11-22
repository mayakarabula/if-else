import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Empty,
  Form,
  List,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
  theme,
} from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { api, type Integration } from "../api/client";
import { FieldInput, formLayout, IntegrationIcon } from "../components/ui";

const integrationFields: Record<
  string,
  {
    key: string;
    label: string;
    type: "text" | "textarea";
    placeholder?: string;
    required?: boolean;
  }[]
> = {
  telegram: [
    { key: "botToken", label: "Bot token", type: "text", placeholder: "123456:ABC...", required: true },
    { key: "chatId", label: "Chat ID", type: "text", placeholder: "123456789", required: true },
  ],
  gmail: [
    {
      key: "email",
      label: "Gmail address",
      type: "text",
      placeholder: "you@gmail.com",
      required: true,
    },
    {
      key: "appPassword",
      label: "App password",
      type: "text",
      placeholder: "xxxx xxxx xxxx xxxx",
      required: true,
    },
    {
      key: "defaultTo",
      label: "Default To (optional)",
      type: "text",
      placeholder: "alerts@example.com",
      required: false,
    },
  ],
  homeassistant: [
    {
      key: "baseUrl",
      label: "URL",
      type: "text",
      placeholder: "http://homeassistant.local:8123",
      required: true,
    },
    {
      key: "accessToken",
      label: "Long-lived token",
      type: "textarea",
      placeholder: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
      required: true,
    },
  ],
  zigbee: [
    {
      key: "mqttUrl",
      label: "MQTT URL",
      type: "text",
      placeholder: "mqtt://192.168.1.10:1883",
      required: true,
    },
    {
      key: "mqttUsername",
      label: "MQTT username",
      type: "text",
      placeholder: "optional",
      required: false,
    },
    {
      key: "mqttPassword",
      label: "MQTT password",
      type: "text",
      placeholder: "optional",
      required: false,
    },
    {
      key: "baseTopic",
      label: "Base topic",
      type: "text",
      placeholder: "zigbee2mqtt",
      required: false,
    },
  ],
  googledocs: [
    {
      key: "refreshToken",
      label: "Refresh token",
      type: "textarea",
      placeholder: "OAuth refresh token with Docs scope",
      required: true,
    },
    {
      key: "clientId",
      label: "Client ID (optional)",
      type: "text",
      placeholder: "Defaults to GOOGLE_CLIENT_ID",
      required: false,
    },
    {
      key: "clientSecret",
      label: "Client secret (optional)",
      type: "text",
      placeholder: "Defaults to GOOGLE_CLIENT_SECRET",
      required: false,
    },
    {
      key: "defaultDocumentId",
      label: "Default document ID",
      type: "text",
      placeholder: "optional",
      required: false,
    },
  ],
  googlesheets: [
    {
      key: "refreshToken",
      label: "Refresh token",
      type: "textarea",
      placeholder: "OAuth refresh token with Sheets scope",
      required: true,
    },
    {
      key: "clientId",
      label: "Client ID (optional)",
      type: "text",
      placeholder: "Defaults to GOOGLE_CLIENT_ID",
      required: false,
    },
    {
      key: "clientSecret",
      label: "Client secret (optional)",
      type: "text",
      placeholder: "Defaults to GOOGLE_CLIENT_SECRET",
      required: false,
    },
    {
      key: "defaultSpreadsheetId",
      label: "Default spreadsheet ID",
      type: "text",
      placeholder: "optional",
      required: false,
    },
  ],
  notion: [
    {
      key: "apiToken",
      label: "Integration token",
      type: "text",
      placeholder: "secret_…",
      required: true,
    },
    {
      key: "defaultPageId",
      label: "Default page ID",
      type: "text",
      placeholder: "optional",
      required: false,
    },
    {
      key: "defaultDatabaseId",
      label: "Default database ID",
      type: "text",
      placeholder: "optional",
      required: false,
    },
  ],
  cursor: [
    {
      key: "apiKey",
      label: "API key",
      type: "text",
      placeholder: "Defaults to CURSOR_API_KEY",
      required: false,
    },
    {
      key: "defaultRepoUrl",
      label: "Default repo URL",
      type: "text",
      placeholder: "https://github.com/org/repo",
      required: false,
    },
  ],
};

const integrationCopy: Record<string, string> = {
  time: "Schedule rules to run once per day at a chosen time and timezone.",
  weather:
    "Open-Meteo weather conditions and data — no API key. Pick a place when you build a rule.",
  wifi: "Discover devices on this machine’s LAN (ARP + ping). Match a device IP or scan nearby hosts.",
  telegram: "Send messages via a Telegram bot. Configure token and chat ID here.",
  gmail:
    "Send emails through Gmail SMTP. Use a Google App Password (2-Step Verification required).",
  homeassistant:
    "Control and read Home Assistant entities over the REST API. Create a long-lived access token in your HA profile.",
  zigbee:
    "Talk to Zigbee2MQTT over MQTT — read device state and publish set commands by friendly name.",
  googledocs:
    "Read and write Google Docs via OAuth refresh token (Docs scope). Client ID/secret can come from env.",
  googlesheets:
    "Read and write Google Sheets via OAuth refresh token (Sheets scope). Client ID/secret can come from env.",
  notion:
    "Create pages and append paragraphs with a Notion internal integration token. Share pages/databases with the integration.",
  cursor:
    "Launch Cursor Cloud Agents with an API key (Agent SDK / Cloud Agents API). Optional default repository URL.",
};

function configStatus(
  integrationId: string,
  config: Record<string, Record<string, unknown>>,
): "ready" | "needs_setup" | "no_setup" {
  const fields = integrationFields[integrationId];
  if (!fields || fields.length === 0) return "no_setup";
  const values = config[integrationId] ?? {};
  const required = fields.filter((field) => field.required !== false);
  const complete = required.every((field) => String(values[field.key] ?? "").trim().length > 0);
  return complete ? "ready" : "needs_setup";
}

function capabilitySummary(integration: Integration): string {
  const conditions = (integration.triggers ?? []).filter((item) => (item.kind ?? "condition") !== "data");
  const sources = (integration.triggers ?? []).filter((item) => item.kind === "data");
  const actions = integration.actions ?? [];
  return (
    [
      conditions.length ? `${conditions.length} condition${conditions.length === 1 ? "" : "s"}` : null,
      sources.length ? `${sources.length} source${sources.length === 1 ? "" : "s"}` : null,
      actions.length ? `${actions.length} action${actions.length === 1 ? "" : "s"}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Available in rules"
  );
}

function IntegrationListItem({
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
  const description = integrationCopy[integration.id] ?? capabilitySummary(integration);

  return (
    <List.Item
      style={{
        padding: "16px 4px",
        alignItems: "flex-start",
      }}
      actions={
        fields.length > 0
          ? [
              <Button key="configure" type="link" icon={<SettingOutlined />} onClick={onConfigure}>
                Configure
              </Button>,
            ]
          : undefined
      }
    >
      <List.Item.Meta
        avatar={<IntegrationIcon integration={integration} size="sm" />}
        title={
          <Space size={10} wrap align="center">
            <Typography.Text strong style={{ fontSize: 16 }}>
              {integration.name}
            </Typography.Text>
            {status === "ready" && <Tag color="success">Configured</Tag>}
            {status === "needs_setup" && <Tag color="warning">Needs setup</Tag>}
            {status === "no_setup" && (
              <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                {capabilitySummary(integration)}
              </Typography.Text>
            )}
          </Space>
        }
        description={
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0, maxWidth: 720 }}>
              {description}
            </Typography.Paragraph>

            <Space size={[6, 6]} wrap>
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
          </div>
        }
      />
    </List.Item>
  );
}

export function IntegrationsPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
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
        <List
          itemLayout="horizontal"
          dataSource={integrations}
          style={{
            marginTop: 8,
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            paddingInline: 16,
          }}
          renderItem={(integration) => (
            <IntegrationListItem
              key={integration.id}
              integration={integration}
              config={config}
              onConfigure={() => setEditingId(integration.id)}
            />
          )}
        />
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
