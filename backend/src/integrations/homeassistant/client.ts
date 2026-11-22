import { failStep } from "../errors.js";
import type { ActionDefinition, TriggerDefinition } from "../types.js";

export interface HomeAssistantConfig {
  baseUrl: string;
  token: string;
}

type StepDef = ActionDefinition | TriggerDefinition;

export function requireHaConfig(
  integrationConfig: Record<string, unknown>,
  step: StepDef,
  kind: "trigger" | "action",
): HomeAssistantConfig {
  const baseUrl = String(integrationConfig.baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  const token = String(integrationConfig.accessToken ?? "").trim();
  if (!baseUrl || !token) {
    failStep({
      message: "Home Assistant URL and long-lived access token are required — set them in Integrations",
      code: "homeassistant.missing_config",
      integration: "homeassistant",
      step: step.id,
      stepLabel: step.label,
      kind,
      plan: step.actionPlan,
      extras: { entityId: "", baseUrl },
    });
  }
  return { baseUrl, token };
}

export async function haFetch(
  config: HomeAssistantConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export interface HaEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export async function getEntityState(
  config: HomeAssistantConfig,
  entityId: string,
  step: StepDef,
  kind: "trigger" | "action",
): Promise<HaEntityState> {
  const id = entityId.trim();
  if (!id) {
    failStep({
      message: "Entity ID is required (e.g. light.living_room)",
      code: "homeassistant.missing_entity",
      integration: "homeassistant",
      step: step.id,
      stepLabel: step.label,
      kind,
      plan: step.actionPlan,
      extras: { entityId: "", baseUrl: config.baseUrl },
    });
  }

  let res: Response;
  try {
    res = await haFetch(config, `/api/states/${encodeURIComponent(id)}`);
  } catch (err) {
    failStep({
      message: err instanceof Error ? err.message : "Home Assistant request failed",
      code: "homeassistant.request_failed",
      integration: "homeassistant",
      step: step.id,
      stepLabel: step.label,
      kind,
      plan: step.actionPlan,
      extras: { entityId: id, baseUrl: config.baseUrl },
    });
  }

  if (!res.ok) {
    const body = await res.text();
    failStep({
      message: `Home Assistant error ${res.status}: ${body}`,
      code: "homeassistant.api_error",
      integration: "homeassistant",
      step: step.id,
      stepLabel: step.label,
      kind,
      plan: step.actionPlan,
      extras: { entityId: id, baseUrl: config.baseUrl, status: res.status },
    });
  }

  return (await res.json()) as HaEntityState;
}

export async function callService(
  config: HomeAssistantConfig,
  domain: string,
  service: string,
  data: Record<string, unknown>,
  step: ActionDefinition,
): Promise<void> {
  const d = domain.trim();
  const s = service.trim();
  if (!d || !s) {
    failStep({
      message: "Service domain and name are required (e.g. light / turn_on)",
      code: "homeassistant.missing_service",
      integration: "homeassistant",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: {
        entityId: String(data.entity_id ?? ""),
        baseUrl: config.baseUrl,
        domain: d,
        service: s,
      },
    });
  }

  let res: Response;
  try {
    res = await haFetch(config, `/api/services/${encodeURIComponent(d)}/${encodeURIComponent(s)}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  } catch (err) {
    failStep({
      message: err instanceof Error ? err.message : "Home Assistant service call failed",
      code: "homeassistant.request_failed",
      integration: "homeassistant",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: {
        entityId: String(data.entity_id ?? ""),
        baseUrl: config.baseUrl,
        domain: d,
        service: s,
      },
    });
  }

  if (!res.ok) {
    const body = await res.text();
    failStep({
      message: `Home Assistant service error ${res.status}: ${body}`,
      code: "homeassistant.api_error",
      integration: "homeassistant",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: {
        entityId: String(data.entity_id ?? ""),
        baseUrl: config.baseUrl,
        domain: d,
        service: s,
        status: res.status,
      },
    });
  }
}
