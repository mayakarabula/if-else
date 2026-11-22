import { failStep } from "../errors.js";
import type { ActionDefinition } from "../types.js";
import { publishDeviceSet, requireZigbeeConfig } from "./client.js";

const COMMON_ERROR_CALLBACK = [
  { path: "message", label: "Error message" },
  { path: "code", label: "Error code" },
  { path: "integration", label: "Integration id" },
  { path: "step", label: "Step id" },
  { path: "stepLabel", label: "Step label" },
  { path: "kind", label: "Step kind", description: "trigger or action" },
  { path: "plan", label: "Action plan", description: "Planned steps joined with →" },
];

const ZIGBEE_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "device", label: "Device friendly name" },
  { path: "mqttUrl", label: "MQTT broker URL" },
  { path: "baseTopic", label: "Base topic" },
];

function interpolate(template: string, data: Record<string, unknown>): string {
  const context = { ...data, trigger: data };
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const keys = path.trim().split(".");
    let value: unknown = context;
    for (const key of keys) {
      if (value && typeof value === "object" && key in (value as object)) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return "";
      }
    }
    return String(value ?? "");
  });
}

const deviceField = {
  key: "device",
  label: "Device name",
  type: "text" as const,
  required: true,
  placeholder: "Living room bulb",
};

export const setState: ActionDefinition = {
  id: "set_state",
  label: "Set state",
  description: "Turn a Zigbee2MQTT device ON, OFF, or TOGGLE.",
  actionPlan: [
    "Connect to the MQTT broker",
    "Publish { state } to zigbee2mqtt/<device>/set",
  ],
  errorCallback: ZIGBEE_ERROR_CALLBACK,
  fields: [
    deviceField,
    {
      key: "state",
      label: "State",
      type: "select",
      required: true,
      default: "ON",
      options: [
        { value: "ON", label: "ON" },
        { value: "OFF", label: "OFF" },
        { value: "TOGGLE", label: "TOGGLE" },
      ],
    },
  ],
  async execute(config, context) {
    const zb = requireZigbeeConfig(context.integrationConfig, setState, "action");
    const device = interpolate(String(config.device ?? ""), context.triggerData).trim();
    const state = String(config.state ?? "ON").toUpperCase();
    await publishDeviceSet(zb, device, { state }, setState);
  },
};

export const setBrightness: ActionDefinition = {
  id: "set_brightness",
  label: "Set brightness",
  description: "Set brightness (0–254) on a Zigbee2MQTT light.",
  actionPlan: [
    "Connect to the MQTT broker",
    "Publish { brightness } to zigbee2mqtt/<device>/set",
  ],
  errorCallback: ZIGBEE_ERROR_CALLBACK,
  fields: [
    deviceField,
    {
      key: "brightness",
      label: "Brightness",
      type: "number",
      required: true,
      placeholder: "128",
      default: 128,
    },
  ],
  async execute(config, context) {
    const zb = requireZigbeeConfig(context.integrationConfig, setBrightness, "action");
    const device = interpolate(String(config.device ?? ""), context.triggerData).trim();
    const brightness = Number(config.brightness);
    if (!Number.isFinite(brightness) || brightness < 0 || brightness > 254) {
      failStep({
        message: "Brightness must be a number between 0 and 254",
        code: "zigbee.invalid_brightness",
        integration: "zigbee",
        step: setBrightness.id,
        stepLabel: setBrightness.label,
        kind: "action",
        plan: setBrightness.actionPlan,
        extras: { device, mqttUrl: zb.mqttUrl, baseTopic: zb.baseTopic },
      });
    }
    await publishDeviceSet(zb, device, { brightness: Math.round(brightness) }, setBrightness);
  },
};

export const publishSet: ActionDefinition = {
  id: "publish_set",
  label: "Publish set payload",
  description: "Publish a raw JSON payload to zigbee2mqtt/<device>/set.",
  actionPlan: [
    "Connect to the MQTT broker",
    "Interpolate templates in the JSON payload",
    "Publish to zigbee2mqtt/<device>/set",
  ],
  errorCallback: ZIGBEE_ERROR_CALLBACK,
  fields: [
    deviceField,
    {
      key: "payloadJson",
      label: "Payload (JSON)",
      type: "textarea",
      required: true,
      placeholder: '{"state":"ON","brightness":180}',
    },
  ],
  async execute(config, context) {
    const zb = requireZigbeeConfig(context.integrationConfig, publishSet, "action");
    const device = interpolate(String(config.device ?? ""), context.triggerData).trim();
    const raw = interpolate(String(config.payloadJson ?? "").trim(), context.triggerData);
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Payload must be a JSON object");
      }
      payload = parsed as Record<string, unknown>;
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Invalid JSON payload",
        code: "zigbee.invalid_json",
        integration: "zigbee",
        step: publishSet.id,
        stepLabel: publishSet.label,
        kind: "action",
        plan: publishSet.actionPlan,
        extras: { device, mqttUrl: zb.mqttUrl, baseTopic: zb.baseTopic },
      });
    }
    await publishDeviceSet(zb, device, payload, publishSet);
  },
};
