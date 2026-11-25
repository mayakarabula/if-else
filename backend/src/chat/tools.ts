import type { CustomIntegrationSpec } from "../integrations/custom/types.js";
import {
  parseRuleDocument,
  redactIntegrationConfig,
  ruleSummary,
  serviceCreateCustomIntegration,
  serviceCreateRule,
  serviceDeleteCustomIntegration,
  serviceDeleteRule,
  serviceGetCustomIntegration,
  serviceGetIntegrationConfig,
  serviceGetRule,
  serviceListIntegrations,
  serviceListRules,
  serviceListRuns,
  servicePatchIntegrationConfig,
  serviceSetEnabled,
  serviceUpdateCustomIntegration,
  serviceUpdateRule,
} from "../tools/rulesService.js";
import type { Rule } from "../store/rules.js";
import { publishChatMutations } from "./events.js";
import type { ChatMutation } from "./types.js";

export interface ToolCallResult {
  ok: boolean;
  result: unknown;
  mutations: ChatMutation[];
  ruleId?: string;
  integrationId?: string;
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

const customFieldSchema: JsonSchema = {
  type: "object",
  properties: {
    key: { type: "string" },
    label: { type: "string" },
    type: { type: "string", enum: ["text", "number", "textarea", "select"] },
    required: { type: "boolean" },
    placeholder: { type: "string" },
  },
  required: ["key", "label"],
  additionalProperties: true,
};

const customHttpRequestSchema: JsonSchema = {
  type: "object",
  properties: {
    method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
    url: { type: "string" },
    headers: { type: "object", additionalProperties: { type: "string" } },
    body: { type: "string" },
    successStatuses: { type: "array", items: { type: "number" } },
  },
  required: ["url"],
  additionalProperties: false,
};

const customActionSchema: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    description: { type: "string" },
    fields: { type: "array", items: customFieldSchema },
    request: customHttpRequestSchema,
  },
  required: ["id", "label", "request"],
  additionalProperties: false,
};

const customTriggerSchema: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    description: { type: "string" },
    kind: { type: "string", enum: ["condition", "data"] },
    fields: { type: "array", items: customFieldSchema },
    fireWhenPath: { type: "string" },
    request: customHttpRequestSchema,
  },
  required: ["id", "label", "request"],
  additionalProperties: false,
};

const customIntegrationDefProperties: JsonSchema = {
  name: { type: "string" },
  icon: {
    type: "string",
    description: "Optional icon key: send, mail, cloud, home, script, …",
  },
  color: { type: "string", description: "Hex color e.g. #5865F2" },
  description: { type: "string" },
  configFields: {
    type: "array",
    description: "Secrets/settings shown under Integrations (e.g. webhookUrl)",
    items: customFieldSchema,
  },
  actions: {
    type: "array",
    description: "HTTP actions for ACTION/ELSE/CATCH (request url/headers/body are the integration code)",
    items: customActionSchema,
  },
  triggers: {
    type: "array",
    description: "Optional HTTP conditions/sources",
    items: customTriggerSchema,
  },
};

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
      description: "Get one rule by id including full if/action/else/catch (legacy then accepted).",
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
        "Create a rule. Pass structured if/action fields and/or a yaml string with the full document. Use list_integrations first for valid ids.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          enabled: { type: "boolean" },
          runTrigger: { type: "string", enum: ["timer", "event", "webhook"] },
          event: {
            description: "Event source when runTrigger is event: { source: webhook|homeassistant, eventType?, entityId? }",
          },
          filters: {
            description:
              "Optional path filters (AND): [{ path, op: eq|neq|contains|starts_with|ends_with|gt|gte|lt|lte|exists|not_exists, value? }]",
          },
          if: { description: "If clause or { all|any: [] }" },
          action: { description: "Action clause or { all: [] }" },
          then: { description: "Legacy alias for action" },
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
          runTrigger: { type: "string", enum: ["timer", "event", "webhook"] },
          event: {},
          filters: {},
          if: {},
          action: {},
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
      name: "create_integration",
      description:
        "Create a custom HTTP integration (new catalog entry usable in rules). Prefer this when the user wants a new service that is not built-in. Templates may use {{config.field}}, action field keys, and trigger paths like {{weather.temp}}.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Stable id, e.g. discord or slack_webhook (letters/digits/_/-)",
          },
          ...customIntegrationDefProperties,
        },
        required: ["id", "name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_integration",
      description:
        "Modify an existing custom HTTP integration's definition/code (request URLs, headers, bodies, actions, triggers, configFields, name/icon/color). Not for built-ins. Call get_custom_integration first; omitted arrays keep previous values, provided arrays replace that section entirely.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Existing custom integration id" },
          ...customIntegrationDefProperties,
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_custom_integration",
      description:
        "Get the full custom integration definition (HTTP request templates and fields) by id. Use before update_integration.",
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
      name: "delete_integration",
      description:
        "Remove a custom HTTP integration from the catalog and drop its saved secrets. Built-ins cannot be deleted. Prefer confirming with the user first.",
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

function customSpecFromArgs(args: Record<string, unknown>): CustomIntegrationSpec {
  return {
    id: String(args.id ?? ""),
    name: String(args.name ?? ""),
    ...(typeof args.icon === "string" ? { icon: args.icon } : {}),
    ...(typeof args.color === "string" ? { color: args.color } : {}),
    ...(typeof args.description === "string" ? { description: args.description } : {}),
    ...(Array.isArray(args.configFields)
      ? { configFields: args.configFields as CustomIntegrationSpec["configFields"] }
      : {}),
    ...(Array.isArray(args.actions)
      ? { actions: args.actions as CustomIntegrationSpec["actions"] }
      : {}),
    ...(Array.isArray(args.triggers)
      ? { triggers: args.triggers as CustomIntegrationSpec["triggers"] }
      : {}),
  };
}

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
  if (args.event !== undefined) body.event = args.event as Rule["event"];
  if (args.filters !== undefined) body.filters = args.filters as Rule["filters"];
  if (args.if !== undefined) body.if = args.if as Rule["if"];
  if (args.action !== undefined) body.action = args.action as Rule["action"];
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
        publishChatMutations(["rules"], { ruleId: saved.id });
        return { ok: true, result: saved, mutations: ["rules"], ruleId: saved.id };
      }
      case "update_rule": {
        const id = String(args.id ?? "");
        const saved = await serviceUpdateRule(id, bodyFromArgs(args));
        publishChatMutations(["rules"], { ruleId: saved.id });
        return { ok: true, result: saved, mutations: ["rules"], ruleId: saved.id };
      }
      case "delete_rule": {
        const id = String(args.id ?? "");
        const result = await serviceDeleteRule(id);
        publishChatMutations(["rules"], { ruleId: id });
        return { ok: true, result, mutations: ["rules"], ruleId: id };
      }
      case "set_rule_enabled": {
        const saved = await serviceSetEnabled(String(args.id ?? ""), Boolean(args.enabled));
        publishChatMutations(["rules"], { ruleId: saved.id });
        return { ok: true, result: saved, mutations: ["rules"], ruleId: saved.id };
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
        publishChatMutations(["integrations"], { integrationId });
        return {
          ok: true,
          result: redactIntegrationConfig({ [integrationId]: saved })[integrationId],
          mutations: ["integrations"],
          integrationId,
        };
      }
      case "create_integration": {
        const saved = await serviceCreateCustomIntegration(customSpecFromArgs(args));
        publishChatMutations(["integrations"], { integrationId: saved.id });
        return { ok: true, result: saved, mutations: ["integrations"], integrationId: saved.id };
      }
      case "update_integration": {
        const saved = await serviceUpdateCustomIntegration(customSpecFromArgs(args));
        publishChatMutations(["integrations"], { integrationId: saved.id });
        return { ok: true, result: saved, mutations: ["integrations"], integrationId: saved.id };
      }
      case "get_custom_integration": {
        return {
          ok: true,
          result: await serviceGetCustomIntegration(String(args.id ?? "")),
          mutations: [],
        };
      }
      case "delete_integration": {
        const id = String(args.id ?? "");
        const result = await serviceDeleteCustomIntegration(id);
        publishChatMutations(["integrations"], { integrationId: id });
        return { ok: true, result, mutations: ["integrations"], integrationId: id };
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
