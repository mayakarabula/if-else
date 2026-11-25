import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinIntegrations } from "../integrations/registry.js";
import { getCustomIntegrationSpec } from "../integrations/custom/store.js";

const INTEGRATIONS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../integrations",
);

const MAX_BYTES = 500_000;
const SHARED_FILES = new Set(["registry.ts", "types.ts", "errors.ts"]);
const SHARED_DIRS = new Set(["google"]);

export function integrationsSourceRoot(): string {
  return INTEGRATIONS_ROOT;
}

export function listBuiltinIntegrationIds(): string[] {
  return builtinIntegrations.map((item) => item.id);
}

function normalizeRelPath(input: string): string {
  const normalized = String(input ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!normalized) throw new Error("path is required");
  if (normalized.includes("\0")) throw new Error("Invalid path");
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "")) {
    throw new Error("path must be relative under integrations/ with no .. segments");
  }
  if (!normalized.endsWith(".ts")) {
    throw new Error("Only .ts files under backend/src/integrations may be edited");
  }
  return normalized;
}

function assertAllowedRelPath(relPath: string): void {
  const [head, ...rest] = relPath.split("/");
  if (SHARED_FILES.has(head) && rest.length === 0) return;
  if (SHARED_DIRS.has(head) && rest.length > 0) return;
  if (head === "custom") {
    throw new Error(
      "Custom HTTP integrations are edited with get_custom_integration / update_integration, not source files",
    );
  }
  const builtinIds = new Set(listBuiltinIntegrationIds());
  if (!builtinIds.has(head)) {
    throw new Error(
      `Unknown or non-editable integration folder "${head}". Built-ins: ${[...builtinIds].join(", ")}`,
    );
  }
}

function resolveSafePath(relPath: string): { relPath: string; absPath: string } {
  const normalized = normalizeRelPath(relPath);
  assertAllowedRelPath(normalized);
  const absPath = path.resolve(INTEGRATIONS_ROOT, normalized);
  const rootWithSep = INTEGRATIONS_ROOT.endsWith(path.sep)
    ? INTEGRATIONS_ROOT
    : INTEGRATIONS_ROOT + path.sep;
  if (absPath !== INTEGRATIONS_ROOT && !absPath.startsWith(rootWithSep)) {
    throw new Error("Path escapes integrations root");
  }
  return { relPath: normalized, absPath };
}

async function assertWritableRoot(): Promise<void> {
  try {
    await access(INTEGRATIONS_ROOT);
  } catch {
    throw new Error(`Integrations source root is missing: ${INTEGRATIONS_ROOT}`);
  }
}

async function walkTsFiles(dir: string, prefix: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "custom") continue;
      out.push(...(await walkTsFiles(abs, rel)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) out.push(rel.replace(/\\/g, "/"));
  }
  return out;
}

export async function serviceListIntegrationSources(integrationId?: string) {
  await assertWritableRoot();
  const id = integrationId?.trim();

  if (id) {
    const custom = await getCustomIntegrationSpec(id);
    if (custom) {
      throw new Error(
        `"${id}" is a custom HTTP integration — use get_custom_integration / update_integration instead of source tools`,
      );
    }
    if (!listBuiltinIntegrationIds().includes(id)) {
      throw new Error(
        `Unknown built-in integration "${id}". Built-ins: ${listBuiltinIntegrationIds().join(", ")}`,
      );
    }
  }

  const all = await walkTsFiles(INTEGRATIONS_ROOT, "");
  const filtered = id
    ? all.filter(
        (rel) =>
          rel === "registry.ts" ||
          rel === "types.ts" ||
          rel === "errors.ts" ||
          rel.startsWith(`${id}/`) ||
          (["googledocs", "googlesheets"].includes(id) && rel.startsWith("google/")),
      )
    : all;

  const files = [];
  for (const rel of filtered.sort()) {
    const abs = path.join(INTEGRATIONS_ROOT, rel);
    const info = await stat(abs);
    files.push({ path: rel, bytes: info.size });
  }

  return {
    root: INTEGRATIONS_ROOT,
    builtinIds: listBuiltinIntegrationIds(),
    files,
    note: "Built-in TypeScript is loaded at process start. After update_integration_source, restart api + worker (tsx watch reloads automatically in local npm run dev).",
  };
}

export async function serviceGetIntegrationSource(relPath: string) {
  await assertWritableRoot();
  const { relPath: normalized, absPath } = resolveSafePath(relPath);
  let content: string;
  try {
    content = await readFile(absPath, "utf8");
  } catch {
    throw new Error(`File not found: ${normalized}`);
  }
  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) {
    throw new Error(`File exceeds ${MAX_BYTES} byte limit`);
  }
  return { path: normalized, content, bytes: Buffer.byteLength(content, "utf8") };
}

export async function serviceUpdateIntegrationSource(input: {
  path: string;
  content: string;
  create?: boolean;
}) {
  await assertWritableRoot();
  const { relPath: normalized, absPath } = resolveSafePath(input.path);
  if (typeof input.content !== "string") {
    throw new Error("content must be a string");
  }
  if (Buffer.byteLength(input.content, "utf8") > MAX_BYTES) {
    throw new Error(`content exceeds ${MAX_BYTES} byte limit`);
  }

  let existed = true;
  try {
    await access(absPath);
  } catch {
    existed = false;
  }
  if (!existed && !input.create) {
    throw new Error(`File not found: ${normalized} (pass create: true to add a new file)`);
  }

  await mkdir(path.dirname(absPath), { recursive: true });
  try {
    await writeFile(absPath, input.content, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not write ${normalized}: ${message}. Source may be read-only in this deploy (bind-mount backend/src in Docker to persist edits).`,
    );
  }

  return {
    path: normalized,
    bytes: Buffer.byteLength(input.content, "utf8"),
    created: !existed,
    reloadRequired: true,
    note: "Restart the api and worker processes to load built-in TypeScript changes (local `npm run dev` / `dev:worker` with tsx watch reload on their own).",
  };
}
