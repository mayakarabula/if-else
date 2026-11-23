#!/usr/bin/env node
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {
  parseRuleDocument,
  ruleSummary,
  serviceCreateRule,
  serviceDeleteRule,
  serviceGetRule,
  serviceListIntegrations,
  serviceListRules,
  serviceListRuns,
  serviceSetEnabled,
  serviceUpdateRule,
} from "./tools/rulesService.js";

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printYaml(value: unknown) {
  process.stdout.write(`${yaml.dump(value)}\n`);
}

function usage(exitCode = 1): never {
  process.stderr.write(`if-else CLI — manage rules on disk (DATA_ROOT)

Usage:
  if-else list [--json]
  if-else get <id> [--json]
  if-else create (--file <path> | --stdin | --body '<yaml-or-json>')
  if-else update <id> (--file <path> | --stdin | --body '<yaml-or-json>')
  if-else delete <id>
  if-else enable <id>
  if-else disable <id>
  if-else integrations [--json]
  if-else runs [--limit N] [--json]

Flags:
  --json    Print machine-readable JSON on stdout
  --body    Inline YAML/JSON rule document (create/update)
  --file    Read rule document from a file
  --stdin   Read rule document from stdin

Environment:
  DATA_ROOT   Repo/data root containing rules/ and config/ (default: repo root)

Examples:
  npm run cli -- list
  npm run cli -- create --file ./examples/cold-alert.yaml
  npm run cli -- create --body '{"name":"Ping","if":{"integration":"time","trigger":"every","config":{"interval":"15m"}},"then":{"integration":"telegram","action":"send_message","config":{"text":"hi"}}}'
`);
  process.exit(exitCode);
}

function hasFlag(argv: string[], flag: string) {
  return argv.includes(flag);
}

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

async function readInputDocument(argv: string[]): Promise<string> {
  const file = readOption(argv, "--file");
  if (file) {
    return readFile(path.resolve(file), "utf8");
  }
  if (hasFlag(argv, "--stdin")) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
  const body = readOption(argv, "--body");
  if (body) return body;
  throw new Error("Provide --file, --stdin, or --body");
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === "-h" || command === "--help") usage(0);

  try {
    switch (command) {
      case "list": {
        const rules = await serviceListRules();
        const rows = rules.map(ruleSummary);
        if (hasFlag(argv, "--json")) printJson(rows);
        else if (rows.length === 0) process.stdout.write("(no rules)\n");
        else {
          for (const row of rows) {
            process.stdout.write(
              `${row.id}\t${row.enabled ? "on" : "off"}\t${row.runTrigger}\t${row.name}\n`,
            );
          }
        }
        break;
      }
      case "get": {
        const id = argv[1];
        if (!id) usage();
        const rule = await serviceGetRule(id);
        if (hasFlag(argv, "--json")) printJson(rule);
        else printYaml(rule);
        break;
      }
      case "create": {
        const raw = await readInputDocument(argv);
        const saved = await serviceCreateRule(parseRuleDocument(raw));
        process.stderr.write(`Created ${saved.id}\n`);
        if (hasFlag(argv, "--json")) printJson(saved);
        else printYaml(saved);
        break;
      }
      case "update": {
        const id = argv[1];
        if (!id) usage();
        const raw = await readInputDocument(argv.slice(1));
        const saved = await serviceUpdateRule(id, parseRuleDocument(raw));
        process.stderr.write(`Updated ${saved.id}\n`);
        if (hasFlag(argv, "--json")) printJson(saved);
        else printYaml(saved);
        break;
      }
      case "delete": {
        const id = argv[1];
        if (!id) usage();
        await serviceDeleteRule(id);
        process.stdout.write(`Deleted ${id}\n`);
        break;
      }
      case "enable": {
        const id = argv[1];
        if (!id) usage();
        const saved = await serviceSetEnabled(id, true);
        process.stdout.write(`Enabled ${saved.id}\n`);
        break;
      }
      case "disable": {
        const id = argv[1];
        if (!id) usage();
        const saved = await serviceSetEnabled(id, false);
        process.stdout.write(`Disabled ${saved.id}\n`);
        break;
      }
      case "integrations": {
        const integrations = await serviceListIntegrations();
        if (hasFlag(argv, "--json")) printJson(integrations);
        else {
          for (const item of integrations) {
            const triggers = item.triggers?.map((t) => t.id).join(", ") || "—";
            const actions = item.actions?.map((a) => a.id).join(", ") || "—";
            process.stdout.write(`${item.id}\t${item.name}\n  triggers: ${triggers}\n  actions: ${actions}\n`);
          }
        }
        break;
      }
      case "runs": {
        const limit = Number(readOption(argv, "--limit") ?? 20);
        const runs = await serviceListRuns(limit);
        if (hasFlag(argv, "--json")) printJson(runs);
        else {
          for (const run of runs) {
            process.stdout.write(
              `${run.timestamp}\t${run.status}\t${run.ruleId}\t${run.message}\n`,
            );
          }
        }
        break;
      }
      default:
        usage();
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

main();
