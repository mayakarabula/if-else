import { google } from "googleapis";
import { failStep } from "../errors.js";
import type { ActionDefinition, TriggerDefinition } from "../types.js";

type StepDef = ActionDefinition | TriggerDefinition;

export function interpolate(template: string, data: Record<string, unknown>): string {
  const context = { ...data, trigger: data };
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) => {
    const keys = path.trim().split(".");
    let value: unknown = context;
    for (const key of keys) {
      if (value && typeof value === "object" && key in (value as object)) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return "";
      }
    }
    return String(value ?? "");
  });
}

export const COMMON_ERROR_CALLBACK = [
  { path: "message", label: "Error message" },
  { path: "code", label: "Error code" },
  { path: "integration", label: "Integration id" },
  { path: "step", label: "Step id" },
  { path: "stepLabel", label: "Step label" },
  { path: "kind", label: "Step kind", description: "trigger or action" },
  { path: "plan", label: "Action plan", description: "Planned steps joined with →" },
];

export function createGoogleAuth(
  integrationConfig: Record<string, unknown>,
  integrationId: string,
  step: StepDef,
  kind: "trigger" | "action",
) {
  const clientId =
    String(integrationConfig.clientId ?? process.env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret =
    String(integrationConfig.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
  const refreshToken = String(integrationConfig.refreshToken ?? "").trim();

  if (!clientId || !clientSecret) {
    failStep({
      message:
        "Google OAuth client ID/secret missing — set them in Integrations or GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET",
      code: `${integrationId}.missing_oauth_client`,
      integration: integrationId,
      step: step.id,
      stepLabel: step.label,
      kind,
      plan: step.actionPlan,
    });
  }

  if (!refreshToken) {
    failStep({
      message: "Google refresh token is not configured — add it in Integrations",
      code: `${integrationId}.missing_refresh_token`,
      integration: integrationId,
      step: step.id,
      stepLabel: step.label,
      kind,
      plan: step.actionPlan,
    });
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}
