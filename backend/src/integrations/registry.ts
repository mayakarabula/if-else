import type { IntegrationDefinition } from "./types.js";
import { dailyAt } from "./time/triggers.js";
import { fetchData, temperatureAbove, temperatureBelow } from "./weather/triggers.js";
import { sendMessage, sendWeatherReport } from "./telegram/actions.js";
import { deviceOnNetwork, scanNetwork } from "./wifi/triggers.js";

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
    id: "telegram",
    name: "Telegram",
    icon: "send",
    color: "#0088CC",
    actions: [sendMessage, sendWeatherReport],
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
    triggers: triggers?.map(({ id, label, description, fields, kind, outputs }) => ({
      id,
      label,
      description,
      fields,
      kind: kind ?? "condition",
      outputs: outputs ?? [],
    })),
    actions: actions?.map(({ id, label, description, fields }) => ({
      id,
      label,
      description,
      fields,
    })),
  }));
}
