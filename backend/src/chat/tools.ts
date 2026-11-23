import {
  parseRuleDocument,
  redactIntegrationConfig,
  ruleSummary,
  serviceCreateRule,
  serviceDeleteRule,
  serviceGetIntegrationConfig,
  serviceGetRule,
  serviceListIntegrations,
  serviceListRules,
  serviceListRuns,
  servicePatchIntegrationConfig,
  serviceSetEnabled,
  serviceUpdateRule,
} from "../tools/rulesService.js";
import type { Rule } from "../store/rules.js";
import type { ChatMutation } from "./types.js";

export interface ToolCallResult {
  ok: boolean;
  result: unknown;
  mutations: ChatMutation[];
}

type JsonSchema = Record<string, unknown>;

export interface ChatToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

export const chatTools: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_rules",
      description: "List automation rules (id, name, enabled, run trigger).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_rule",
      description: "Get one rule by id including full if/then/else/catch.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_rule",
      description:
        "Create a rule. Pass structured if/then fields and/or a yaml string with the full document. Use list_integrations first for valid ids.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          enabled: { type: "boolean" },
          runTrigger: { type: "string", enum: ["timer", "webhook"] },
          if: { description: "If clause or { all|any: [] }" },
          then: { description: "Then clause or { all: [] }" },
          else: {},
          catch: {},
          yaml: { type: "string", description: "Full YAML/JSON rule document" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_rule",
      description: "Update an existing rule by id (partial fields or yaml).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          enabled: { type: "boolean" },
          runTrigger: { type: "string", enum: ["timer", "webhook"] },
          if: {},
          then: {},
          else: {},
          catch: {},
          yaml: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_rule",
      description: "Delete a rule by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_rule_enabled",
      description: "Enable or disable (pause) a rule.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["id", "enabled"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_integrations",
      description:
        "List integrations with triggers/actions and field schemas. Call before creating or editing rules.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_integration_config",
      description:
        "Get saved integration credentials/settings. Secret values are redacted as [configured].",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "update_integration_config",
      description:
        "Merge configuration fields for one integration (e.g. telegram botToken/chatId, script defaultCwd). Does not remove unrelated keys.",
      parameters: {
        type: "object",
        properties: {
          integrationId: { type: "string" },
          fields: {
            type: "object",
            description: "Key/value fields to merge into that integration's config",
            additionalProperties: true,
          },
        },
        required: ["integrationId", "fields"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_runs",
      description: "List recent rule run logs.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
];

function bodyFromArgs(args: Record<string, unknown>): Partial<Rule> {
  if (typeof args.yaml === "string" && args.yaml.trim()) {
    return parseRuleDocument(args.yaml);
  }
  const body: Partial<Rule> = {};
  if (typeof args.name === "string") body.name = args.name;
  if (typeof args.enabled === "boolean") body.enabled = args.enabled;
  if (args.runTrigger === "timer" || args.runTrigger === "webhook") {
    body.runTrigger = args.runTrigger;
  }
  if (args.if !== undefined) body.if = args.if as Rule["if"];
  if (args.then !== undefined) body.then = args.then as Rule["then"];
  if (args.else !== undefined) body.else = args.else as Rule["else"];
  if (args.catch !== undefined) body.catch = args.catch as Rule["catch"];
  return body;
}

export async function executeChatTool(
  name: string,
  argsJson: string,
): Promise<ToolCallResult> {
  let args: Record<string, unknown> = {};
  try {
    args = argsJson.trim() ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, result: { error: "Invalid tool arguments JSON" }, mutations: [] };
  }

  try {
    switch (name) {
      case "list_rules": {
        const rules = await serviceListRules();
        return { ok: true, result: rules.map(ruleSummary), mutations: [] };
      }
      case "get_rule": {
        const rule = await serviceGetRule(String(args.id ?? ""));
        return { ok: true, result: rule, mutations: [] };
      }
      case "create_rule": {
        const body = bodyFromArgs(args);
        if (typeof args.id === "string" && args.id.trim()) body.id = args.id.trim();
        const saved = await serviceCreateRule(body);
        return { ok: true, result: saved, mutations: ["rules"] };
      }
      case "update_rule": {
        const id = String(args.id ?? "");
        const saved = await serviceUpdateRule(id, bodyFromArgs(args));
        return { ok: true, result: saved, mutations: ["rules"] };
      }
      case "delete_rule": {
        const result = await serviceDeleteRule(String(args.id ?? ""));
        return { ok: true, result, mutations: ["rules"] };
      }
      case "set_rule_enabled": {
        const saved = await serviceSetEnabled(String(args.id ?? ""), Boolean(args.enabled));
        return { ok: true, result: saved, mutations: ["rules"] };
      }
      case "list_integrations": {
        return { ok: true, result: await serviceListIntegrations(), mutations: [] };
      }
      case "get_integration_config": {
        const config = await serviceGetIntegrationConfig();
        return { ok: true, result: redactIntegrationConfig(config), mutations: [] };
      }
      case "update_integration_config": {
        const integrationId = String(args.integrationId ?? "");
        const fields =
          args.fields && typeof args.fields === "object" && !Array.isArray(args.fields)
            ? (args.fields as Record<string, unknown>)
            : {};
        const saved = await servicePatchIntegrationConfig(integrationId, fields);
        return {
          ok: true,
          result: redactIntegrationConfig({ [integrationId]: saved })[integrationId],
          mutations: ["integrations"],
        };
      }
      case "list_runs": {
        const limit = typeof args.limit === "number" ? args.limit : 20;
        return { ok: true, result: await serviceListRuns(limit), mutations: [] };
      }
      default:
        return { ok: false, result: { error: `Unknown tool: ${name}` }, mutations: [] };
    }
  } catch (err) {
    return {
      ok: false,
      result: { error: err instanceof Error ? err.message : String(err) },
      mutations: [],
    };
  }
}
