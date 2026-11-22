import type { IntegrationDefinition } from "./types.js";
import { dailyAt } from "./time/triggers.js";
import { fetchData, temperatureAbove, temperatureBelow } from "./weather/triggers.js";
import { sendMessage } from "./telegram/actions.js";
import { sendEmail as gmailSendEmail } from "./gmail/actions.js";
import { deviceOnNetwork, scanNetwork } from "./wifi/triggers.js";
import {
  callHaService,
  toggle as haToggle,
  turnOff as haTurnOff,
  turnOn as haTurnOn,
} from "./homeassistant/actions.js";
import { entityStateIs, fetchEntityState } from "./homeassistant/triggers.js";
import { publishSet, setBrightness, setState } from "./zigbee/actions.js";
import { attributeEquals, deviceStateIs, fetchDeviceState } from "./zigbee/triggers.js";

export const integrations: IntegrationDefinition[] = [
  {
    id: "time",
    name: "Time",
    icon: "clock",
    color: "#F97316",
    triggers: [dailyAt],
  },
  {
    id: "weather",
    name: "Weather",
    icon: "cloud",
    color: "#3B82F6",
    triggers: [temperatureBelow, temperatureAbove, fetchData],
  },
  {
    id: "wifi",
    name: "Wi‑Fi",
    icon: "wifi",
    color: "#0D9488",
    triggers: [deviceOnNetwork, scanNetwork],
  },
  {
    id: "homeassistant",
    name: "Home Assistant",
    icon: "home",
    color: "#18BCF2",
    triggers: [entityStateIs, fetchEntityState],
    actions: [haTurnOn, haTurnOff, haToggle, callHaService],
  },
  {
    id: "zigbee",
    name: "Zigbee",
    icon: "zigbee",
    color: "#EB8C00",
    triggers: [deviceStateIs, attributeEquals, fetchDeviceState],
    actions: [setState, setBrightness, publishSet],
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: "send",
    color: "#0088CC",
    actions: [sendMessage],
  },
  {
    id: "gmail",
    name: "Gmail",
    icon: "mail",
    color: "#EA4335",
    actions: [gmailSendEmail],
  },
];

export function getIntegration(id: string): IntegrationDefinition | undefined {
  return integrations.find((i) => i.id === id);
}

export function getTrigger(integrationId: string, triggerId: string) {
  const integration = getIntegration(integrationId);
  return integration?.triggers?.find((t) => t.id === triggerId);
}

export function getAction(integrationId: string, actionId: string) {
  const integration = getIntegration(integrationId);
  return integration?.actions?.find((a) => a.id === actionId);
}

export function listIntegrationsForApi() {
  return integrations.map(({ id, name, icon, color, triggers, actions }) => ({
    id,
    name,
    icon,
    color,
    triggers: triggers?.map(({ id, label, description, fields, kind, outputs, actionPlan, errorCallback }) => ({
      id,
      label,
      description,
      fields,
      kind: kind ?? "condition",
      outputs: outputs ?? [],
      actionPlan,
      errorCallback,
    })),
    actions: actions?.map(({ id, label, description, fields, actionPlan, errorCallback }) => ({
      id,
      label,
      description,
      fields,
      actionPlan,
      errorCallback,
    })),
  }));
}
