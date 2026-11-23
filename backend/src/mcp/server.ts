#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
} from "../tools/rulesService.js";
import type { Rule } from "../store/rules.js";

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

const ruleBodySchema = {
  name: z.string().optional().describe("Display name for the rule"),
  enabled: z.boolean().optional().describe("Whether the rule is active"),
  runTrigger: z
    .enum(["timer", "event", "webhook"])
    .optional()
    .describe("How an enabled rule is kicked off (webhook is a legacy alias for event)"),
  webhookToken: z.string().optional().describe("Optional webhook path token"),
  event: z
    .unknown()
    .optional()
    .describe("Event source: { source: webhook|homeassistant, eventType?, entityId? }"),
  filters: z
    .unknown()
    .optional()
    .describe("Optional path filters (AND): [{ path, op, value? }]"),
  if: z
    .unknown()
    .optional()
    .describe("If block: clause object, or { all|any: clauses[], pollInterval? }"),
  action: z
    .unknown()
    .optional()
    .describe("Action block: action clause or { all: clauses[] }"),
  then: z
    .unknown()
    .optional()
    .describe("Legacy alias for action"),
  else: z.unknown().optional().describe("Optional else actions"),
  catch: z.unknown().optional().describe("Optional catch actions"),
  yaml: z
    .string()
    .optional()
    .describe("Full rule document as YAML or JSON string (overrides other fields when set)"),
};

function bodyFromArgs(args: Record<string, unknown>): Partial<Rule> {
  if (typeof args.yaml === "string" && args.yaml.trim()) {
    return parseRuleDocument(args.yaml);
  }

  const body: Partial<Rule> = {};
  if (typeof args.name === "string") body.name = args.name;
  if (typeof args.enabled === "boolean") body.enabled = args.enabled;
  if (args.runTrigger === "timer" || args.runTrigger === "event" || args.runTrigger === "webhook") {
    body.runTrigger = args.runTrigger === "webhook" ? "event" : args.runTrigger;
  }
  if (typeof args.webhookToken === "string") body.webhookToken = args.webhookToken;
  if (args.event !== undefined) body.event = args.event as Rule["event"];
  if (args.filters !== undefined) body.filters = args.filters as Rule["filters"];
  if (args.if !== undefined) body.if = args.if as Rule["if"];
  if (args.action !== undefined) body.action = args.action as Rule["action"];
  if (args.then !== undefined) body.then = args.then as Rule["then"];
  if (args.else !== undefined) body.else = args.else as Rule["else"];
  if (args.catch !== undefined) body.catch = args.catch as Rule["catch"];
  return body;
}

async function main() {
  const server = new McpServer({
    name: "if-else",
    version: "0.1.0",
  });

  server.registerTool(
    "list_rules",
    {
      description: "List if-else automation rules (id, name, enabled, run trigger).",
    },
    async () => {
      try {
        const rules = await serviceListRules();
        return textResult(rules.map(ruleSummary));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_rule",
    {
      description: "Get one rule by id, including full if/then/else/catch YAML structure.",
      inputSchema: {
        id: z.string().describe("Rule id"),
      },
    },
    async ({ id }) => {
      try {
        return textResult(await serviceGetRule(id));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "create_rule",
    {
      description:
        "Create a rule. Prefer `yaml` with a full document, or pass structured if/then fields. Call list_integrations first to pick valid integration/trigger/action ids.",
      inputSchema: {
        id: z.string().optional().describe("Optional short id; generated if omitted"),
        ...ruleBodySchema,
      },
    },
    async (args) => {
      try {
        const body = bodyFromArgs(args);
        if (typeof args.id === "string" && args.id.trim()) body.id = args.id.trim();
        const saved = await serviceCreateRule(body);
        return textResult(saved);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "update_rule",
    {
      description: "Update an existing rule by id. Pass yaml or partial fields to merge.",
      inputSchema: {
        id: z.string().describe("Rule id"),
        ...ruleBodySchema,
      },
    },
    async (args) => {
      try {
        const body = bodyFromArgs(args);
        const saved = await serviceUpdateRule(args.id, body);
        return textResult(saved);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "delete_rule",
    {
      description: "Delete a rule by id.",
      inputSchema: {
        id: z.string().describe("Rule id"),
      },
    },
    async ({ id }) => {
      try {
        return textResult(await serviceDeleteRule(id));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "set_rule_enabled",
    {
      description: "Enable or disable a rule.",
      inputSchema: {
        id: z.string().describe("Rule id"),
        enabled: z.boolean().describe("true to enable, false to pause"),
      },
    },
    async ({ id, enabled }) => {
      try {
        return textResult(await serviceSetEnabled(id, enabled));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_integrations",
    {
      description:
        "List available integrations with trigger/action ids, field schemas, and outputs — use before creating rules.",
    },
    async () => {
      try {
        return textResult(await serviceListIntegrations());
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_runs",
    {
      description: "List recent rule run logs.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("Max runs to return (default 20)"),
      },
    },
    async ({ limit }) => {
      try {
        return textResult(await serviceListRuns(limit ?? 20));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
