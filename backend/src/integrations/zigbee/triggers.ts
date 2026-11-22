import type { TriggerDefinition } from "../types.js";
import { getDeviceState, requireZigbeeConfig } from "./client.js";

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

const deviceField = {
  key: "device",
  label: "Device name",
  type: "text" as const,
  required: true,
  placeholder: "Living room bulb",
};

function flattenPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value == null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

export const fetchDeviceState: TriggerDefinition = {
  id: "fetch_device_state",
  label: "Fetch device state",
  description: "Loads Zigbee2MQTT device state into templates. Does not block the rule on its own.",
  kind: "data",
  actionPlan: [
    "Connect to the MQTT broker configured in Integrations",
    "Subscribe to zigbee2mqtt/<device> and request a fresh state",
    "Expose state attributes for templates",
  ],
  errorCallback: ZIGBEE_ERROR_CALLBACK,
  fields: [deviceField],
  outputs: [
    { path: "device", label: "Device name" },
    { path: "state", label: "State (ON/OFF when present)" },
    { path: "brightness", label: "Brightness" },
    { path: "battery", label: "Battery %" },
    { path: "linkquality", label: "Link quality" },
    { path: "payload", label: "Full payload (JSON)" },
  ],
  async evaluate(config, context) {
    const zb = requireZigbeeConfig(context.integrationConfig, fetchDeviceState, "trigger");
    const device = String(config.device ?? "");
    const payload = await getDeviceState(zb, device, fetchDeviceState, "trigger");
    return {
      fired: true,
      data: {
        device,
        state: payload.state ?? "",
        brightness: payload.brightness ?? "",
        battery: payload.battery ?? "",
        linkquality: payload.linkquality ?? "",
        payload: JSON.stringify(payload),
        ...flattenPayload(payload),
      },
    };
  },
};

export const deviceStateIs: TriggerDefinition = {
  id: "device_state_is",
  label: "Device state is",
  description: "Fires when a Zigbee2MQTT device state (e.g. ON/OFF) matches.",
  actionPlan: [
    "Connect to the MQTT broker",
    "Read the retained / requested device state",
    "Compare the state attribute and apply mode",
  ],
  errorCallback: [
    ...ZIGBEE_ERROR_CALLBACK,
    { path: "expected", label: "Expected state" },
    { path: "state", label: "Current state" },
  ],
  fields: [
    deviceField,
    {
      key: "expected",
      label: "Expected state",
      type: "select",
      required: true,
      default: "ON",
      options: [
        { value: "ON", label: "ON" },
        { value: "OFF", label: "OFF" },
      ],
    },
    {
      key: "mode",
      label: "When",
      type: "select",
      required: true,
      default: "matches",
      options: [
        { value: "matches", label: "While the state matches" },
        { value: "becomes", label: "When the state becomes this value" },
        { value: "leaves", label: "When the state leaves this value" },
      ],
    },
  ],
  outputs: [
    { path: "device", label: "Device name" },
    { path: "state", label: "Current state" },
    { path: "expected", label: "Expected state" },
    { path: "matched", label: "Matched" },
  ],
  async evaluate(config, context) {
    const zb = requireZigbeeConfig(context.integrationConfig, deviceStateIs, "trigger");
    const device = String(config.device ?? "");
    const expected = String(config.expected ?? "ON").toUpperCase();
    const mode = String(config.mode ?? "matches");
    const payload = await getDeviceState(zb, device, deviceStateIs, "trigger");
    const state = String(payload.state ?? "").toUpperCase();
    const matched = state === expected;
    const previous = context.lastState?.matched;
    const data = { device, state, expected, matched, mode };

    if (context.manual) {
      return {
        fired: mode === "leaves" ? !matched : matched,
        data,
        state: { matched },
      };
    }

    if ((mode === "becomes" || mode === "leaves") && previous === undefined) {
      return { fired: false, data, state: { matched } };
    }

    let fired = false;
    if (mode === "matches") fired = matched;
    else if (mode === "becomes") fired = matched && previous === false;
    else if (mode === "leaves") fired = !matched && previous === true;

    return { fired, data, state: { matched } };
  },
};

export const attributeEquals: TriggerDefinition = {
  id: "attribute_equals",
  label: "Attribute equals",
  description: "Fires when a Zigbee2MQTT payload attribute equals a value (e.g. occupancy, contact).",
  actionPlan: [
    "Connect to the MQTT broker",
    "Read the device state payload",
    "Compare the chosen attribute to the expected value",
  ],
  errorCallback: [
    ...ZIGBEE_ERROR_CALLBACK,
    { path: "attribute", label: "Attribute" },
    { path: "expected", label: "Expected value" },
    { path: "value", label: "Current value" },
  ],
  fields: [
    deviceField,
    {
      key: "attribute",
      label: "Attribute",
      type: "text",
      required: true,
      placeholder: "occupancy",
    },
    {
      key: "expected",
      label: "Expected value",
      type: "text",
      required: true,
      placeholder: "true",
    },
    {
      key: "mode",
      label: "When",
      type: "select",
      required: true,
      default: "matches",
      options: [
        { value: "matches", label: "While the value matches" },
        { value: "becomes", label: "When the value becomes this" },
        { value: "leaves", label: "When the value leaves this" },
      ],
    },
  ],
  outputs: [
    { path: "device", label: "Device name" },
    { path: "attribute", label: "Attribute" },
    { path: "value", label: "Current value" },
    { path: "expected", label: "Expected value" },
    { path: "matched", label: "Matched" },
  ],
  async evaluate(config, context) {
    const zb = requireZigbeeConfig(context.integrationConfig, attributeEquals, "trigger");
    const device = String(config.device ?? "");
    const attribute = String(config.attribute ?? "").trim();
    const expected = String(config.expected ?? "").trim();
    const mode = String(config.mode ?? "matches");
    const payload = await getDeviceState(zb, device, attributeEquals, "trigger");
    const value = String(payload[attribute] ?? "");
    const matched = value.toLowerCase() === expected.toLowerCase();
    const previous = context.lastState?.matched;
    const data = { device, attribute, value, expected, matched, mode };

    if (context.manual) {
      return {
        fired: mode === "leaves" ? !matched : matched,
        data,
        state: { matched },
      };
    }

    if ((mode === "becomes" || mode === "leaves") && previous === undefined) {
      return { fired: false, data, state: { matched } };
    }

    let fired = false;
    if (mode === "matches") fired = matched;
    else if (mode === "becomes") fired = matched && previous === false;
    else if (mode === "leaves") fired = !matched && previous === true;

    return { fired, data, state: { matched } };
  },
};
