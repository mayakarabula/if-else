import { randomUUID } from "node:crypto";
import yaml from "js-yaml";
import {
  deleteCustomIntegrationSpec,
  getCustomIntegrationSpec,
  upsertCustomIntegrationSpec,
} from "../integrations/custom/store.js";
import type { CustomIntegrationSpec } from "../integrations/custom/types.js";
import { listIntegrationsForApi, reloadCustomIntegrations } from "../integrations/registry.js";
import {
  deleteRule,
  isEventRunTrigger,
  listRules,
  loadIntegrationConfig,
  loadRule,
  loadRuns,
  ruleActionBlock,
  saveIntegrationConfig,
  saveRule,
  type Rule,
  type RuleEvent,
  type RuleRunTrigger,
} from "../store/rules.js";

function newId() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

function normalizeEvent(
  input: Partial<Rule>,
  existing: Rule | undefined,
  runTrigger: RuleRunTrigger | undefined,
): RuleEvent | undefined {
  if (runTrigger !== "event") return undefined;
  const raw = input.event ?? existing?.event;
  const source = raw?.source === "homeassistant" ? "homeassistant" : "webhook";
  if (source === "homeassistant") {
    return {
      source,
      eventType: String(raw?.eventType ?? "state_changed").trim() || "state_changed",
      ...(raw?.entityId?.trim() ? { entityId: raw.entityId.trim() } : {}),
    };
  }
  return { source: "webhook" };
}

function normalizeRunFields(
  input: Partial<Rule>,
  existing?: Rule,
): Pick<Rule, "enabled" | "runTrigger" | "webhookToken" | "event"> {
  const runTrigger: RuleRunTrigger = isEventRunTrigger(input.runTrigger)
    ? "event"
    : input.runTrigger === "timer"
      ? "timer"
      : isEventRunTrigger(existing?.runTrigger)
        ? "event"
        : "timer";

  const enabled = input.enabled ?? existing?.enabled ?? true;
  let webhookToken = input.webhookToken ?? existing?.webhookToken;
  const event = normalizeEvent(input, existing, enabled ? runTrigger : undefined);

  if (enabled && runTrigger === "event" && (event?.source ?? "webhook") === "webhook") {
    webhookToken = webhookToken?.trim() || randomUUID().replace(/-/g, "");
  }

  return {
    enabled,
    runTrigger: enabled ? runTrigger : isEventRunTrigger(existing?.runTrigger) ? "event" : "timer",
    ...(webhookToken ? { webhookToken } : {}),
    ...(event ? { event } : {}),
  };
}

export function parseRuleDocument(raw: string): Partial<Rule> {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Rule document is empty");

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as Partial<Rule>;
  }

  const loaded = yaml.load(trimmed);
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
    throw new Error("Rule document must be a YAML/JSON object");
  }
  return loaded as Partial<Rule>;
}

export async function serviceListRules() {
  return listRules();
}

export async function serviceGetRule(id: string) {
  const rule = await loadRule(id);
  if (!rule) throw new Error(`Rule not found: ${id}`);
  return rule;
}

export async function serviceCreateRule(input: Partial<Rule>) {
  if (!input.if) throw new Error("Rule requires an `if` block");
  const action = ruleActionBlock(input);
  if (!action) throw new Error("Rule requires an `action` (or legacy `then`) block");

  const id = input.id?.trim() || newId();
  if (await loadRule(id)) {
    throw new Error(`Rule already exists: ${id}`);
  }

  const runFields = normalizeRunFields(input);
  const rule: Rule = {
    id,
    name: input.name?.trim() || "Untitled rule",
    ...runFields,
    if: input.if,
    action,
    ...(Array.isArray(input.filters) ? { filters: input.filters } : {}),
    ...(input.else ? { else: input.else } : {}),
    ...(input.catch ? { catch: input.catch } : {}),
  };

  return saveRule(rule);
}

export async function serviceUpdateRule(id: string, patch: Partial<Rule>) {
  const existing = await loadRule(id);
  if (!existing) throw new Error(`Rule not found: ${id}`);

  const runFields = normalizeRunFields({ ...existing, ...patch }, existing);
  const action = ruleActionBlock({ ...existing, ...patch }) ?? ruleActionBlock(existing);
  return saveRule({
    ...existing,
    ...patch,
    ...runFields,
    id: existing.id,
    action,
    then: undefined,
    filters: Object.prototype.hasOwnProperty.call(patch, "filters") ? patch.filters : existing.filters,
    else: Object.prototype.hasOwnProperty.call(patch, "else") ? patch.else : existing.else,
    catch: Object.prototype.hasOwnProperty.call(patch, "catch") ? patch.catch : existing.catch,
  });
}

export async function serviceDeleteRule(id: string) {
  const existing = await loadRule(id);
  if (!existing) throw new Error(`Rule not found: ${id}`);
  await deleteRule(id);
  return { deleted: id };
}

export async function serviceSetEnabled(id: string, enabled: boolean) {
  const existing = await loadRule(id);
  if (!existing) throw new Error(`Rule not found: ${id}`);
  return saveRule({ ...existing, enabled });
}

export async function serviceListIntegrations() {
  await reloadCustomIntegrations();
  return listIntegrationsForApi();
}

export async function serviceCreateCustomIntegration(input: CustomIntegrationSpec) {
  const existing = await getCustomIntegrationSpec(input.id);
  if (existing) {
    throw new Error(`Custom integration "${input.id}" already exists — use update instead`);
  }
  const saved = await upsertCustomIntegrationSpec(input);
  await reloadCustomIntegrations();
  return saved;
}

export async function serviceUpdateCustomIntegration(input: CustomIntegrationSpec) {
  const existing = await getCustomIntegrationSpec(input.id);
  if (!existing) {
    throw new Error(`Custom integration not found: ${input.id}`);
  }
  const saved = await upsertCustomIntegrationSpec({
    ...existing,
    ...input,
    id: existing.id,
    name: input.name?.trim() ? input.name : existing.name,
    actions: input.actions ?? existing.actions,
    triggers: input.triggers ?? existing.triggers,
    configFields: input.configFields ?? existing.configFields,
    createdAt: existing.createdAt,
  });
  await reloadCustomIntegrations();
  return saved;
}

/** Update display metadata for a custom integration without rewriting actions/triggers. */
export async function serviceUpdateCustomIntegrationMeta(
  id: string,
  patch: { name?: string; icon?: string; color?: string; description?: string },
) {
  const existing = await getCustomIntegrationSpec(id);
  if (!existing) {
    throw new Error(`Custom integration not found: ${id}`);
  }
  return serviceUpdateCustomIntegration({
    ...existing,
    ...(typeof patch.name === "string" ? { name: patch.name } : {}),
    ...(typeof patch.icon === "string" ? { icon: patch.icon } : {}),
    ...(typeof patch.color === "string" ? { color: patch.color } : {}),
    ...(typeof patch.description === "string" ? { description: patch.description } : {}),
  });
}

export async function serviceDeleteCustomIntegration(id: string) {
  const deleted = await deleteCustomIntegrationSpec(id);
  if (!deleted) throw new Error(`Custom integration not found: ${id}`);
  await reloadCustomIntegrations();
  // Drop saved secrets/settings for this integration id.
  const config = await loadIntegrationConfig();
  if (config[id]) {
    const { [id]: _removed, ...rest } = config;
    await saveIntegrationConfig(rest);
  }
  return { deleted: id };
}

export async function serviceGetCustomIntegration(id: string) {
  const spec = await getCustomIntegrationSpec(id);
  if (!spec) throw new Error(`Custom integration not found: ${id}`);
  return spec;
}

export async function serviceGetIntegrationConfig() {
  return loadIntegrationConfig();
}

/** Merge fields into one integration's config (does not wipe other integrations). */
export async function servicePatchIntegrationConfig(
  integrationId: string,
  patch: Record<string, unknown>,
) {
  const id = integrationId.trim();
  if (!id) throw new Error("integrationId is required");
  const config = await loadIntegrationConfig();
  const next = {
    ...config,
    [id]: {
      ...(config[id] ?? {}),
      ...patch,
    },
  };
  await saveIntegrationConfig(next);
  return next[id];
}

/** Replace the full integrations config map. */
export async function serviceSaveIntegrationConfig(
  config: Record<string, Record<string, unknown>>,
) {
  await saveIntegrationConfig(config);
  return config;
}

export async function serviceListRuns(limit = 20) {
  const runs = await loadRuns();
  return runs.slice(0, Math.max(1, Math.min(limit, 100)));
}

/** Mask secret-looking values before sending config to an LLM. */
export function redactIntegrationConfig(
  config: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const secretKey = /(token|secret|password|apiKey|refresh)/i;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [integrationId, values] of Object.entries(config)) {
    out[integrationId] = {};
    for (const [key, value] of Object.entries(values ?? {})) {
      if (secretKey.test(key) && String(value ?? "").trim()) {
        out[integrationId][key] = "[configured]";
      } else {
        out[integrationId][key] = value;
      }
    }
  }
  return out;
}

export function ruleSummary(rule: Rule) {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    runTrigger: rule.enabled ? rule.runTrigger ?? "timer" : "off",
    updatedAt: rule.updatedAt,
  };
}
