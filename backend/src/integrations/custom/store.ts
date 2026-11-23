import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { CONFIG_DIR } from "../../store/rules.js";
import type { CustomIntegrationSpec } from "./types.js";

export const CUSTOM_INTEGRATIONS_PATH = path.join(CONFIG_DIR, "custom-integrations.yaml");

const RESERVED_IDS = new Set([
  "time",
  "weather",
  "wifi",
  "homeassistant",
  "zigbee",
  "telegram",
  "gmail",
  "googledocs",
  "googlesheets",
  "notion",
  "cursor",
  "script",
  "agentchat",
]);

export function isReservedIntegrationId(id: string): boolean {
  return RESERVED_IDS.has(id.trim().toLowerCase());
}

export function assertValidCustomId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,47}$/.test(normalized)) {
    throw new Error(
      "Integration id must be 2–48 chars: start with a letter, then letters/digits/_/-",
    );
  }
  if (isReservedIntegrationId(normalized)) {
    throw new Error(`Integration id "${normalized}" is reserved for a built-in integration`);
  }
  return normalized;
}

export async function loadCustomIntegrationSpecs(): Promise<CustomIntegrationSpec[]> {
  try {
    const raw = await readFile(CUSTOM_INTEGRATIONS_PATH, "utf8");
    const parsed = yaml.load(raw);
    if (!parsed) return [];
    if (Array.isArray(parsed)) return parsed as CustomIntegrationSpec[];
    if (typeof parsed === "object") {
      return Object.entries(parsed as Record<string, Omit<CustomIntegrationSpec, "id">>).map(
        ([id, value]) => ({ ...value, id }),
      );
    }
    return [];
  } catch {
    return [];
  }
}

export async function saveCustomIntegrationSpecs(specs: CustomIntegrationSpec[]): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const asMap: Record<string, Omit<CustomIntegrationSpec, "id">> = {};
  for (const spec of specs) {
    const { id, ...rest } = spec;
    asMap[id] = rest;
  }
  await writeFile(CUSTOM_INTEGRATIONS_PATH, yaml.dump(asMap), "utf8");
}

export async function getCustomIntegrationSpec(id: string): Promise<CustomIntegrationSpec | null> {
  const specs = await loadCustomIntegrationSpecs();
  return specs.find((item) => item.id === id) ?? null;
}

export async function upsertCustomIntegrationSpec(
  input: CustomIntegrationSpec,
): Promise<CustomIntegrationSpec> {
  const id = assertValidCustomId(input.id);
  if (!input.name?.trim()) throw new Error("Integration name is required");

  const actions = (input.actions ?? []).filter((action) => {
    if (!action?.id || !action?.label) return false;
    if (!action.request || !String(action.request.url ?? "").trim()) {
      throw new Error(`Action "${action.id || action.label}" needs request.url`);
    }
    return true;
  });
  const triggers = (input.triggers ?? []).filter((trigger) => {
    if (!trigger?.id || !trigger?.label) return false;
    if (!trigger.request || !String(trigger.request.url ?? "").trim()) {
      throw new Error(`Trigger "${trigger.id || trigger.label}" needs request.url`);
    }
    return true;
  });

  if (!(actions.length || triggers.length)) {
    throw new Error("Custom integration needs at least one action or trigger with request.url");
  }

  const now = new Date().toISOString();
  const specs = await loadCustomIntegrationSpecs();
  const existing = specs.find((item) => item.id === id);
  const next: CustomIntegrationSpec = {
    ...input,
    id,
    name: input.name.trim(),
    icon: (input.icon ?? "send").trim() || "send",
    color: (input.color ?? "#64748B").trim() || "#64748B",
    description: input.description?.trim() || undefined,
    configFields: input.configFields ?? [],
    actions,
    triggers,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const without = specs.filter((item) => item.id !== id);
  without.push(next);
  without.sort((a, b) => a.name.localeCompare(b.name));
  await saveCustomIntegrationSpecs(without);
  return next;
}

export async function deleteCustomIntegrationSpec(id: string): Promise<boolean> {
  const normalized = id.trim().toLowerCase();
  const specs = await loadCustomIntegrationSpecs();
  const next = specs.filter((item) => item.id !== normalized);
  if (next.length === specs.length) return false;
  await saveCustomIntegrationSpecs(next);
  return true;
}
