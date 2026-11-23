import { failStep } from "../errors.js";
import type {
  ActionDefinition,
  FieldSchema,
  IntegrationDefinition,
  TriggerDefinition,
} from "../types.js";
import { interpolate } from "../script/run.js";
import type { CustomActionSpec, CustomHttpRequest, CustomIntegrationSpec, CustomTriggerSpec } from "./types.js";

const HTTP_ERROR_CALLBACK = [
  { path: "message", label: "Error message" },
  { path: "code", label: "Error code" },
  { path: "integration", label: "Integration id" },
  { path: "step", label: "Step id" },
  { path: "stepLabel", label: "Step label" },
  { path: "kind", label: "Step kind" },
  { path: "plan", label: "Action plan" },
  { path: "status", label: "HTTP status" },
  { path: "response", label: "Response body" },
  { path: "url", label: "Request URL" },
];

function readPath(data: unknown, pathExpr: string): unknown {
  const keys = pathExpr.trim().split(".").filter(Boolean);
  let value: unknown = data;
  for (const key of keys) {
    if (value && typeof value === "object" && key in (value as object)) {
      value = (value as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return value;
}

function buildTemplateData(
  actionConfig: Record<string, unknown>,
  integrationConfig: Record<string, unknown>,
  triggerData: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...triggerData,
    ...actionConfig,
    config: integrationConfig,
    trigger: triggerData,
  };
}

async function executeHttpRequest(
  request: CustomHttpRequest,
  templateData: Record<string, unknown>,
  step: { id: string; label: string; plan: string[] },
  integrationId: string,
  kind: "action" | "trigger",
): Promise<{ status: number; text: string; json: unknown }> {
  const url = interpolate(request.url, templateData).trim();
  if (!url) {
    failStep({
      message: "HTTP request URL is empty after templates",
      code: "custom.empty_url",
      integration: integrationId,
      step: step.id,
      stepLabel: step.label,
      plan: step.plan,
      kind,
      extras: {},
    });
  }

  const method = (request.method ?? "POST").toUpperCase();
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    headers[key] = interpolate(String(value), templateData);
  }
  const body =
    request.body != null && method !== "GET" && method !== "HEAD"
      ? interpolate(request.body, templateData)
      : undefined;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      ...(body != null ? { body } : {}),
    });
  } catch (err) {
    failStep({
      message: err instanceof Error ? err.message : String(err),
      code: "custom.network",
      integration: integrationId,
      step: step.id,
      stepLabel: step.label,
      plan: step.plan,
      kind,
      extras: { url, status: "", response: "" },
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  const success =
    request.successStatuses?.length
      ? request.successStatuses.includes(res.status)
      : res.status >= 200 && res.status < 400;

  if (!success) {
    failStep({
      message: `HTTP ${res.status} from ${url}`,
      code: "custom.http_error",
      integration: integrationId,
      step: step.id,
      stepLabel: step.label,
      plan: step.plan,
      kind,
      extras: { url, status: String(res.status), response: text.slice(0, 2000) },
    });
  }

  return { status: res.status, text, json };
}

function compileAction(integrationId: string, spec: CustomActionSpec): ActionDefinition {
  const fields: FieldSchema[] = spec.fields ?? [];
  const stepMeta = {
    id: spec.id,
    label: spec.label,
    plan: [
      `Build ${spec.request.method ?? "POST"} request to ${spec.request.url}`,
      "Send HTTP request",
      "Fail unless response status is successful",
    ],
  };

  return {
    id: spec.id,
    label: spec.label,
    description: spec.description ?? `Custom HTTP action (${spec.request.method ?? "POST"})`,
    actionPlan: stepMeta.plan,
    errorCallback: HTTP_ERROR_CALLBACK,
    fields,
    async execute(config, context) {
      const templateData = buildTemplateData(
        config,
        context.integrationConfig,
        context.triggerData,
      );
      await executeHttpRequest(spec.request, templateData, stepMeta, integrationId, "action");
    },
  };
}

function compileTrigger(integrationId: string, spec: CustomTriggerSpec): TriggerDefinition {
  const kind = spec.kind ?? "condition";
  const fields: FieldSchema[] = spec.fields ?? [];
  const stepMeta = {
    id: spec.id,
    label: spec.label,
    plan: [
      `Request ${spec.request.method ?? "GET"} ${spec.request.url}`,
      kind === "data" ? "Expose JSON response as template data" : "Evaluate fire condition",
    ],
  };

  return {
    id: spec.id,
    label: spec.label,
    description: spec.description ?? `Custom HTTP ${kind}`,
    kind,
    actionPlan: stepMeta.plan,
    errorCallback: HTTP_ERROR_CALLBACK,
    fields,
    outputs:
      kind === "data"
        ? [{ path: "response", label: "Response", description: "Parsed JSON body" }]
        : undefined,
    async evaluate(config, context) {
      const templateData = buildTemplateData(config, context.integrationConfig, {});
      const result = await executeHttpRequest(
        spec.request,
        templateData,
        stepMeta,
        integrationId,
        "trigger",
      );

      if (kind === "data") {
        return {
          fired: true,
          data: {
            [integrationId]: {
              response: result.json,
              status: result.status,
              ...(result.json && typeof result.json === "object"
                ? (result.json as Record<string, unknown>)
                : {}),
            },
          },
        };
      }

      const path = spec.fireWhenPath?.trim();
      const fired = path
        ? Boolean(readPath(result.json, path))
        : result.status >= 200 && result.status < 300;

      return {
        fired,
        data: {
          [integrationId]: {
            response: result.json,
            status: result.status,
          },
        },
      };
    },
  };
}

export function compileCustomIntegration(spec: CustomIntegrationSpec): IntegrationDefinition {
  return {
    id: spec.id,
    name: spec.name,
    icon: spec.icon ?? "send",
    color: spec.color ?? "#64748B",
    triggers: (spec.triggers ?? []).map((item) => compileTrigger(spec.id, item)),
    actions: (spec.actions ?? []).map((item) => compileAction(spec.id, item)),
  };
}

export type CustomIntegrationApi = ReturnType<typeof toCustomIntegrationApi>;

export function toCustomIntegrationApi(spec: CustomIntegrationSpec) {
  const compiled = compileCustomIntegration(spec);
  return {
    id: compiled.id,
    name: compiled.name,
    icon: compiled.icon,
    color: compiled.color,
    custom: true as const,
    description: spec.description ?? "Custom HTTP integration",
    configFields: spec.configFields ?? [],
    triggers: compiled.triggers?.map(
      ({ id, label, description, fields, kind, outputs, actionPlan, errorCallback }) => ({
        id,
        label,
        description,
        fields,
        kind: kind ?? "condition",
        outputs: outputs ?? [],
        actionPlan,
        errorCallback,
      }),
    ),
    actions: compiled.actions?.map(({ id, label, description, fields, actionPlan, errorCallback }) => ({
      id,
      label,
      description,
      fields,
      actionPlan,
      errorCallback,
    })),
  };
}
