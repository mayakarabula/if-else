import { failStep } from "../errors.js";
import type { ActionDefinition } from "../types.js";
import { callService, requireHaConfig } from "./client.js";

const COMMON_ERROR_CALLBACK = [
  { path: "message", label: "Error message" },
  { path: "code", label: "Error code" },
  { path: "integration", label: "Integration id" },
  { path: "step", label: "Step id" },
  { path: "stepLabel", label: "Step label" },
  { path: "kind", label: "Step kind", description: "trigger or action" },
  { path: "plan", label: "Action plan", description: "Planned steps joined with →" },
];

const HA_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "entityId", label: "Entity ID" },
  { path: "baseUrl", label: "Home Assistant URL" },
  { path: "domain", label: "Service domain" },
  { path: "service", label: "Service name" },
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

function parseEntityDomain(entityId: string): string {
  const idx = entityId.indexOf(".");
  return idx > 0 ? entityId.slice(0, idx) : "homeassistant";
}

const entityField = {
  key: "entityId",
  label: "Entity ID",
  type: "text" as const,
  required: true,
  placeholder: "light.living_room",
};

export const turnOn: ActionDefinition = {
  id: "turn_on",
  label: "Turn on",
  description: "Turn on a Home Assistant entity (light, switch, etc.).",
  actionPlan: [
    "Load Home Assistant URL and access token",
    "Resolve the entity domain from the entity ID",
    "Call <domain>.turn_on via the REST API",
  ],
  errorCallback: HA_ERROR_CALLBACK,
  fields: [entityField],
  async execute(config, context) {
    const ha = requireHaConfig(context.integrationConfig, turnOn, "action");
    const entityId = interpolate(String(config.entityId ?? ""), context.triggerData).trim();
    const domain = parseEntityDomain(entityId);
    await callService(ha, domain, "turn_on", { entity_id: entityId }, turnOn);
  },
};

export const turnOff: ActionDefinition = {
  id: "turn_off",
  label: "Turn off",
  description: "Turn off a Home Assistant entity (light, switch, etc.).",
  actionPlan: [
    "Load Home Assistant URL and access token",
    "Resolve the entity domain from the entity ID",
    "Call <domain>.turn_off via the REST API",
  ],
  errorCallback: HA_ERROR_CALLBACK,
  fields: [entityField],
  async execute(config, context) {
    const ha = requireHaConfig(context.integrationConfig, turnOff, "action");
    const entityId = interpolate(String(config.entityId ?? ""), context.triggerData).trim();
    const domain = parseEntityDomain(entityId);
    await callService(ha, domain, "turn_off", { entity_id: entityId }, turnOff);
  },
};

export const toggle: ActionDefinition = {
  id: "toggle",
  label: "Toggle",
  description: "Toggle a Home Assistant entity.",
  actionPlan: [
    "Load Home Assistant URL and access token",
    "Resolve the entity domain from the entity ID",
    "Call <domain>.toggle via the REST API",
  ],
  errorCallback: HA_ERROR_CALLBACK,
  fields: [entityField],
  async execute(config, context) {
    const ha = requireHaConfig(context.integrationConfig, toggle, "action");
    const entityId = interpolate(String(config.entityId ?? ""), context.triggerData).trim();
    const domain = parseEntityDomain(entityId);
    await callService(ha, domain, "toggle", { entity_id: entityId }, toggle);
  },
};

export const callHaService: ActionDefinition = {
  id: "call_service",
  label: "Call a service",
  description: "Call any Home Assistant service with optional JSON data.",
  actionPlan: [
    "Load Home Assistant URL and access token",
    "Interpolate templates in entity ID and service data",
    "POST /api/services/<domain>/<service>",
  ],
  errorCallback: HA_ERROR_CALLBACK,
  fields: [
    {
      key: "domain",
      label: "Domain",
      type: "text",
      required: true,
      placeholder: "light",
    },
    {
      key: "service",
      label: "Service",
      type: "text",
      required: true,
      placeholder: "turn_on",
    },
    {
      key: "entityId",
      label: "Entity ID (optional)",
      type: "text",
      required: false,
      placeholder: "light.living_room",
    },
    {
      key: "dataJson",
      label: "Extra data (JSON)",
      type: "textarea",
      required: false,
      placeholder: '{"brightness_pct": 80}',
    },
  ],
  async execute(config, context) {
    const ha = requireHaConfig(context.integrationConfig, callHaService, "action");
    const domain = interpolate(String(config.domain ?? ""), context.triggerData).trim();
    const service = interpolate(String(config.service ?? ""), context.triggerData).trim();
    const entityId = interpolate(String(config.entityId ?? ""), context.triggerData).trim();
    const raw = interpolate(String(config.dataJson ?? "").trim(), context.triggerData);

    let data: Record<string, unknown> = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          data = parsed as Record<string, unknown>;
        } else {
          throw new Error("Service data must be a JSON object");
        }
      } catch (err) {
        failStep({
          message: err instanceof Error ? err.message : "Invalid service JSON",
          code: "homeassistant.invalid_json",
          integration: "homeassistant",
          step: callHaService.id,
          stepLabel: callHaService.label,
          kind: "action",
          plan: callHaService.actionPlan,
          extras: { entityId, baseUrl: ha.baseUrl, domain, service },
        });
      }
    }
    if (entityId) data.entity_id = entityId;

    await callService(ha, domain, service, data, callHaService);
  },
};
