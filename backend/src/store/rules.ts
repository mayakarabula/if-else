import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Repo/data root containing `rules/` and `config/`. Override with DATA_ROOT in Docker. */
export const ROOT_DIR = process.env.DATA_ROOT
  ? path.resolve(process.env.DATA_ROOT)
  : path.resolve(__dirname, "../../..");
export const RULES_DIR = path.join(ROOT_DIR, "rules");
export const CONFIG_DIR = path.join(ROOT_DIR, "config");
export const INTEGRATIONS_CONFIG_PATH = path.join(CONFIG_DIR, "integrations.yaml");
export const RUNS_PATH = path.join(CONFIG_DIR, "runs.json");

export interface RuleIfClause {
  integration: string;
  trigger: string;
  config: Record<string, unknown>;
}

export interface RuleIfBlock {
  all: RuleIfClause[];
  pollInterval?: string;
}

export type RuleIf = RuleIfClause | RuleIfBlock;

export interface RuleThenClause {
  integration: string;
  action: string;
  config: Record<string, unknown>;
}

export interface RuleThenBlock {
  all: RuleThenClause[];
}

export type RuleThen = RuleThenClause | RuleThenBlock;

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  if: RuleIf;
  then: RuleThen;
  createdAt?: string;
  updatedAt?: string;
}

export interface RunLog {
  id: string;
  ruleId: string;
  ruleName: string;
  status: "success" | "error" | "skipped";
  message: string;
  triggerData?: Record<string, unknown>;
  timestamp: string;
}

export async function ensureDirs() {
  await mkdir(RULES_DIR, { recursive: true });
  await mkdir(CONFIG_DIR, { recursive: true });
}

export async function loadIntegrationConfig(): Promise<Record<string, Record<string, unknown>>> {
  try {
    const raw = await readFile(INTEGRATIONS_CONFIG_PATH, "utf8");
    return (yaml.load(raw) as Record<string, Record<string, unknown>>) ?? {};
  } catch {
    return {};
  }
}

export async function saveIntegrationConfig(config: Record<string, Record<string, unknown>>) {
  await writeFile(INTEGRATIONS_CONFIG_PATH, yaml.dump(config), "utf8");
}

export async function listRules(): Promise<Rule[]> {
  await ensureDirs();
  const files = await readdir(RULES_DIR);
  const rules: Rule[] = [];

  for (const file of files) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    const rule = await loadRule(path.basename(file, path.extname(file)));
    if (rule) rules.push(rule);
  }

  return rules.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function loadRule(id: string): Promise<Rule | null> {
  await ensureDirs();
  const yamlPath = path.join(RULES_DIR, `${id}.yaml`);
  const ymlPath = path.join(RULES_DIR, `${id}.yml`);

  let raw: string;
  try {
    raw = await readFile(yamlPath, "utf8");
  } catch {
    try {
      raw = await readFile(ymlPath, "utf8");
    } catch {
      return null;
    }
  }

  return yaml.load(raw) as Rule;
}

export async function saveRule(rule: Rule) {
  await ensureDirs();
  const now = new Date().toISOString();
  const existing = await loadRule(rule.id);
  const toSave: Rule = {
    ...rule,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeFile(path.join(RULES_DIR, `${rule.id}.yaml`), yaml.dump(toSave), "utf8");
  return toSave;
}

export async function deleteRule(id: string) {
  const yamlPath = path.join(RULES_DIR, `${id}.yaml`);
  const ymlPath = path.join(RULES_DIR, `${id}.yml`);
  try {
    await unlink(yamlPath);
  } catch {
    await unlink(ymlPath);
  }
}

export async function loadRuns(): Promise<RunLog[]> {
  try {
    const raw = await readFile(RUNS_PATH, "utf8");
    return JSON.parse(raw) as RunLog[];
  } catch {
    return [];
  }
}

export async function appendRun(run: RunLog) {
  const runs = await loadRuns();
  runs.unshift(run);
  await writeFile(RUNS_PATH, JSON.stringify(runs.slice(0, 100), null, 2), "utf8");
}

export function parsePollInterval(interval?: string): number {
  if (!interval) return 15 * 60 * 1000;
  const match = interval.match(/^(\d+)(m|h|s)$/);
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === "s") return value * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  return value * 60 * 1000;
}
