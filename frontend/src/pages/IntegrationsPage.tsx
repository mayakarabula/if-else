import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  ColorPicker,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
  theme,
} from "antd";
import { SearchOutlined, SettingOutlined } from "@ant-design/icons";
import { api, type ChatStatus, type Integration } from "../api/client";
import { EmojiPickerField } from "../components/EmojiPickerField";
import {
  FieldInput,
  formLayout,
  IntegrationIcon,
  resolveIntegrationIcon,
  verticalFormProps,
} from "../components/ui";

const integrationFields: Record<
  string,
  {
    key: string;
    label: string;
    type: "text" | "textarea" | "select";
    placeholder?: string;
    required?: boolean;
    options?: { value: string; label: string }[];
  }[]
> = {
  agentchat: [
    {
      key: "provider",
      label: "Provider",
      type: "select",
      required: false,
      options: [
        { value: "auto", label: "Auto (Cursor if CURSOR_API_KEY set, else OpenAI)" },
        { value: "openai", label: "OpenAI-compatible" },
        { value: "cursor", label: "Cursor Agent" },
      ],
    },
    {
      key: "openaiApiKey",
      label: "OpenAI API key",
      type: "text",
      placeholder: "sk-… (or CHAT_API_KEY / OPENAI_API_KEY)",
      required: false,
    },
    {
      key: "openaiBaseUrl",
      label: "OpenAI base URL",
      type: "text",
      placeholder: "https://api.openai.com/v1",
      required: false,
    },
    {
      key: "openaiModel",
      label: "OpenAI model",
      type: "text",
      placeholder: "gpt-4o-mini",
      required: false,
    },
    {
      key: "cursorApiKey",
      label: "Cursor API key override",
      type: "text",
      placeholder: "Optional — defaults to CURSOR_API_KEY",
      required: false,
    },
    {
      key: "cursorModel",
      label: "Cursor model id",
      type: "text",
      placeholder: "optional (Cursor default)",
      required: false,
    },
    {
      key: "cursorRepoUrl",
      label: "Cursor repo URL",
      type: "text",
      placeholder: "optional; falls back to Cursor integration default",
      required: false,
    },
    {
      key: "cursorStartingRef",
      label: "Cursor starting ref",
      type: "text",
      placeholder: "main",
      required: false,
    },
  ],
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
  script: [
    {
      key: "defaultCwd",
      label: "Default working directory",
      type: "text",
      placeholder: "optional",
      required: false,
    },
    {
      key: "shell",
      label: "Shell",
      type: "text",
      placeholder: "/bin/sh",
      required: false,
    },
    {
      key: "timeoutMs",
      label: "Default timeout (ms)",
      type: "text",
      placeholder: "60000",
      required: false,
    },
  ],
};

const AGENT_CHAT_ITEM: Integration = {
  id: "agentchat",
  name: "Agent chat",
  icon: "agent",
  color: "#0F766E",
  triggers: [],
  actions: [],
};

const integrationCopy: Record<string, string> = {
  agentchat:
    "Power the floating in-app agent. Cursor uses CURSOR_API_KEY by default; OpenAI-compatible keys are optional. Configure provider and overrides here.",
  time: "Poll on an interval (Time → Every) or fire once per day at a chosen time and timezone.",
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
  script:
    "Run inline shell scripts or script files on the worker host. Optional default cwd, shell, and timeout.",
};

function fieldsForIntegration(integration: Integration) {
  if (integration.id === "agentchat") return integrationFields.agentchat ?? [];
  if (integration.custom && integration.configFields?.length) {
    return integration.configFields.map((field) => ({
      key: field.key,
      label: field.label,
      type: (field.type === "number" || field.type === "textarea" || field.type === "select"
        ? field.type
        : "text") as "text" | "textarea" | "select",
      placeholder: field.placeholder,
      required: field.required,
      options: field.options,
    }));
  }
  return integrationFields[integration.id] ?? [];
}

function configStatus(
  integration: Integration,
  config: Record<string, Record<string, unknown>>,
): "ready" | "needs_setup" | "no_setup" {
  const fields = fieldsForIntegration(integration);
  if (!fields || fields.length === 0) return "no_setup";
  const values = config[integration.id] ?? {};
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
  chatStatus,
}: {
  integration: Integration;
  config: Record<string, Record<string, unknown>>;
  onConfigure: () => void;
  chatStatus?: ChatStatus | null;
}) {
  const conditions = (integration.triggers ?? []).filter((item) => (item.kind ?? "condition") !== "data");
  const sources = (integration.triggers ?? []).filter((item) => item.kind === "data");
  const actions = integration.actions ?? [];
  const status =
    integration.id === "agentchat"
      ? chatStatus == null
        ? "pending"
        : chatStatus.configured
          ? "ready"
          : "needs_setup"
      : configStatus(integration, config);
  const description =
    integrationCopy[integration.id] ??
    integration.description ??
    capabilitySummary(integration);
  const agentChatHint =
    integration.id === "agentchat" && status === "needs_setup"
      ? "Set CURSOR_API_KEY in backend/.env (default), or add an OpenAI key here."
      : integration.id === "agentchat" && status === "ready" && chatStatus?.cursorEnvConfigured
        ? "Using CURSOR_API_KEY"
        : integration.id === "agentchat" && status === "ready" && chatStatus?.providerLabel
          ? `Using ${chatStatus.providerLabel}`
          : null;

  return (
    <List.Item
      style={{
        padding: "16px 4px",
        alignItems: "flex-start",
      }}
      actions={[
        <Button key="configure" type="link" icon={<SettingOutlined />} onClick={onConfigure}>
          Configure
        </Button>,
      ]}
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
            {integration.custom && <Tag>Custom</Tag>}
            {agentChatHint && (
              <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                {agentChatHint}
              </Typography.Text>
            )}
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
                  Action · {item.label}
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
  const [metaDraft, setMetaDraft] = useState<{ name: string; icon: string; color: string }>({
    name: "",
    icon: "✈️",
    color: "#64748B",
  });
  const [query, setQuery] = useState("");
  const [chatStatus, setChatStatus] = useState<ChatStatus | null>(null);

  function refresh() {
    setLoading(true);
    Promise.all([api.getIntegrations(), api.getIntegrationConfig(), api.getChatStatus()])
      .then(([integrationsData, configData, nextChatStatus]) => {
        setIntegrations(integrationsData);
        setConfig(configData);
        setChatStatus(nextChatStatus);
      })
      .catch((err) => {
        message.error(err instanceof Error ? err.message : "Failed to load integrations");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, [message]);

  useEffect(() => {
    function onDataChanged(event: Event) {
      const detail = (event as CustomEvent<{ mutations?: string[] }>).detail;
      if (detail?.mutations?.includes("integrations")) {
        refresh();
      }
    }
    window.addEventListener("if-else:data-changed", onDataChanged);
    return () => window.removeEventListener("if-else:data-changed", onDataChanged);
  }, [message]);

  const allIntegrations = useMemo(() => {
    const items = [AGENT_CHAT_ITEM, ...integrations];
    return items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [integrations]);

  const displayIntegrations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allIntegrations;

    return allIntegrations.filter((integration) => {
      const haystack = [
        integration.id,
        integration.name,
        integrationCopy[integration.id] ?? "",
        ...(integration.triggers ?? []).flatMap((item) => [item.id, item.label, item.description]),
        ...(integration.actions ?? []).flatMap((item) => [item.id, item.label, item.description]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [allIntegrations, query]);

  const editing = useMemo(
    () => allIntegrations.find((item) => item.id === editingId) ?? null,
    [editingId, allIntegrations],
  );
  const editingFields = useMemo(() => {
    if (!editing) return [];
    const fields = fieldsForIntegration(editing);
    if (editing.id !== "agentchat") return fields;

    const provider = String(config.agentchat?.provider ?? "auto");
    return fields.filter((field) => {
      if (field.key === "provider") return true;
      const isOpenAi = field.key.startsWith("openai");
      const isCursor = field.key.startsWith("cursor");
      if (provider === "openai") return isOpenAi;
      if (provider === "cursor") return isCursor;
      return true;
    });
  }, [editing, config.agentchat?.provider]);

  function openConfigure(integration: Integration) {
    const overlay = config[integration.id] ?? {};
    const rawIcon = String(integration.custom ? integration.icon : overlay.icon ?? integration.icon);
    setMetaDraft({
      name: String(
        integration.custom
          ? integration.name
          : overlay.displayName ?? integration.name,
      ),
      icon: resolveIntegrationIcon(rawIcon, "✈️"),
      color: String(integration.custom ? integration.color : overlay.color ?? integration.color),
    });
    setEditingId(integration.id);
  }

  async function handleSave() {
    if (!editing) return;
    const name = metaDraft.name.trim();
    if (!name) {
      message.error("Name is required");
      return;
    }

    setSaving(true);
    try {
      let nextConfig = config;
      if (editing.custom) {
        await api.updateCustomIntegrationMeta(editing.id, {
          name,
          icon: metaDraft.icon.trim() || "✈️",
          color: metaDraft.color.trim() || "#64748B",
        });
      } else if (editing.id !== "agentchat") {
        nextConfig = {
          ...config,
          [editing.id]: {
            ...config[editing.id],
            displayName: name,
            icon: metaDraft.icon.trim() || resolveIntegrationIcon(editing.icon, "✈️"),
            color: metaDraft.color.trim() || editing.color,
          },
        };
        setConfig(nextConfig);
      }

      await api.saveIntegrationConfig(nextConfig);
      message.success("Integration settings saved.");
      setEditingId(null);
      refresh();
      window.dispatchEvent(
        new CustomEvent("if-else:data-changed", { detail: { mutations: ["integrations"] } }),
      );
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
        Everything you can use in If / Action rules. Secrets are stored in config/integrations.yaml.
      </Typography.Paragraph>

      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="Search integrations…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ maxWidth: 420, marginBottom: 16 }}
      />

      {displayIntegrations.length === 0 ? (
        <Empty
          description={
            query.trim()
              ? `No integrations match “${query.trim()}”.`
              : "No integrations registered."
          }
        />
      ) : (
        <List
          itemLayout="horizontal"
          dataSource={displayIntegrations}
          style={{
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
              chatStatus={chatStatus}
              onConfigure={() => openConfigure(integration)}
            />
          )}
        />
      )}

      <Modal
        title={editing ? `Configure · ${metaDraft.name || editing.name}` : "Configure"}
        open={Boolean(editing)}
        onCancel={() => setEditingId(null)}
        onOk={() => void handleSave()}
        okText="Save"
        confirmLoading={saving}
        destroyOnHidden
        centered
        width={640}
      >
        {editing && (
          <>
            <Typography.Paragraph type="secondary">
              {editing.custom
                ? editing.description ?? "Custom HTTP integration — update display and connection settings."
                : integrationCopy[editing.id] ?? "Update connection settings for this integration."}
            </Typography.Paragraph>
            {editing.id === "agentchat" && chatStatus?.cursorEnvConfigured && (
              <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
                <code>CURSOR_API_KEY</code> is set in the backend environment.
              </Typography.Paragraph>
            )}
            <Form {...verticalFormProps} style={{ maxWidth: formLayout.controlWidth + 24 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {editing.id !== "agentchat" && (
                  <>
                    <Form.Item label="Name" style={{ marginBottom: 8 }}>
                      <Input
                        value={metaDraft.name}
                        onChange={(e) => setMetaDraft((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="Display name"
                        style={{ maxWidth: formLayout.controlWidth }}
                      />
                    </Form.Item>
                    <Form.Item label="Icon" style={{ marginBottom: 8 }}>
                      <EmojiPickerField
                        value={metaDraft.icon}
                        onChange={(emoji) => setMetaDraft((prev) => ({ ...prev, icon: emoji }))}
                      />
                    </Form.Item>
                    <Form.Item label="Color" style={{ marginBottom: 8 }}>
                      <ColorPicker
                        value={metaDraft.color || "#64748B"}
                        showText
                        disabledAlpha
                        onChange={(color) =>
                          setMetaDraft((prev) => ({ ...prev, color: color.toHexString() }))
                        }
                      />
                    </Form.Item>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                      <IntegrationIcon
                        integration={{
                          ...editing,
                          name: metaDraft.name || editing.name,
                          icon: metaDraft.icon || editing.icon,
                          color: metaDraft.color || editing.color,
                        }}
                        size="sm"
                      />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        Preview
                      </Typography.Text>
                    </div>
                  </>
                )}
                {editingFields.map((field) => (
                  <FieldInput
                    key={field.key}
                    field={field}
                    value={
                      editing.id === "agentchat" && field.key === "provider"
                        ? config.agentchat?.provider ?? "auto"
                        : config[editing.id]?.[field.key]
                    }
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
