import type { Integration } from "../api/client";
import { Form, Input, InputNumber, Select, Switch, Typography } from "antd";
import { TemplateTextArea, type ArgumentItem } from "./AvailableVariables";

export const INTEGRATION_ICONS: Record<string, string> = {
  cloud: "☁️",
  send: "✈️",
  clock: "🕘",
  wifi: "📶",
  mail: "✉️",
  home: "🏠",
  zigbee: "📡",
  docs: "📄",
  sheets: "📊",
  notion: "📓",
  cursor: "⌘",
  script: "$_",
  agent: "🤖",
  webhook: "🔗",
  api: "🔌",
  discord: "💬",
  slack: "💬",
};

export const INTEGRATION_ICON_OPTIONS = Object.entries(INTEGRATION_ICONS).map(([value, glyph]) => ({
  value,
  label: `${glyph}  ${value}`,
}));

/** Resolve a stored icon key or raw emoji to a display glyph. */
export function resolveIntegrationIcon(icon: string | undefined, fallback = "?"): string {
  if (!icon) return fallback;
  const mapped = INTEGRATION_ICONS[icon];
  if (mapped) return mapped;
  // Legacy keys are alphanumeric; anything else (emoji / symbols) renders as-is.
  if (!/^[a-z0-9_-]+$/i.test(icon)) return icon;
  return fallback;
}

/** Shared form sizing — labels sit above fields (vertical layout). */
export const formLayout = {
  controlWidth: 360,
  numberWidth: 112,
} as const;

/** Default Ant Design Form props used across configure modals. */
export const verticalFormProps = {
  layout: "vertical" as const,
  colon: false,
  requiredMark: false,
};

export function IntegrationIcon({
  integration,
  size = "md",
}: {
  integration?: Integration;
  size?: "sm" | "md" | "lg";
}) {
  const px = size === "sm" ? 40 : size === "lg" ? 64 : 48;
  const fontSize = size === "sm" ? 18 : size === "lg" ? 28 : 22;
  const glyph = integration
    ? resolveIntegrationIcon(integration.icon, integration.name[0] ?? "?")
    : "?";

  return (
    <div
      style={{
        width: px,
        height: px,
        borderRadius: 12,
        backgroundColor: integration?.color ?? "#64748B",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize,
        flexShrink: 0,
      }}
    >
      {glyph}
    </div>
  );
}

export function FlowArrow() {
  return (
    <Typography.Text type="secondary" style={{ paddingInline: 8, fontSize: 12, textTransform: "uppercase" }}>
      action
    </Typography.Text>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return <Switch checked={checked} onChange={onChange} aria-label={label} />;
}

export function FieldInput({
  field,
  value,
  onChange,
  compact,
  arguments: argumentItems,
}: {
  field: {
    key: string;
    label: string;
    type: string;
    placeholder?: string;
    required?: boolean;
    options?: { value: string; label: string }[];
  };
  value: unknown;
  onChange: (value: unknown) => void;
  /** Use a shorter control; nice for hour/minute. */
  compact?: boolean;
  /** When set on textarea fields, show insert chips under the control. */
  arguments?: ArgumentItem[];
}) {
  const controlStyle = {
    width: compact || field.type === "number" ? formLayout.numberWidth : "100%",
    maxWidth: formLayout.controlWidth,
  };

  if (field.type === "textarea") {
    return (
      <Form.Item label={field.label} required={field.required} style={{ marginBottom: 0 }}>
        {argumentItems ? (
          <TemplateTextArea
            value={String(value ?? "")}
            placeholder={field.placeholder}
            onChange={onChange}
            arguments={argumentItems}
          />
        ) : (
          <Input.TextArea
            rows={4}
            value={String(value ?? "")}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            style={{ maxWidth: formLayout.controlWidth + 80, width: "100%" }}
          />
        )}
      </Form.Item>
    );
  }

  if (field.type === "select" && field.options) {
    return (
      <Form.Item label={field.label} required={field.required} style={{ marginBottom: 0 }}>
        <Select
          showSearch
          optionFilterProp="label"
          value={value === undefined || value === null || value === "" ? undefined : String(value)}
          placeholder={field.placeholder ?? "Select…"}
          options={field.options.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(next) => onChange(next)}
          style={controlStyle}
        />
      </Form.Item>
    );
  }

  if (field.type === "number") {
    return (
      <Form.Item label={field.label} required={field.required} style={{ marginBottom: 0 }}>
        <InputNumber
          value={typeof value === "number" ? value : value === "" || value == null ? undefined : Number(value)}
          placeholder={field.placeholder}
          onChange={(next) => onChange(next ?? 0)}
          style={controlStyle}
        />
      </Form.Item>
    );
  }

  return (
    <Form.Item label={field.label} required={field.required} style={{ marginBottom: 0 }}>
      <Input
        value={value === undefined || value === null ? "" : String(value)}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={controlStyle}
      />
    </Form.Item>
  );
}
