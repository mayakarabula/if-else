import { failStep } from "../errors.js";
import type { ActionDefinition } from "../types.js";

function interpolate(template: string, data: Record<string, unknown>): string {
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

const COMMON_ERROR_CALLBACK = [
  { path: "message", label: "Error message" },
  { path: "code", label: "Error code" },
  { path: "integration", label: "Integration id" },
  { path: "step", label: "Step id" },
  { path: "stepLabel", label: "Step label" },
  { path: "kind", label: "Step kind", description: "trigger or action" },
  { path: "plan", label: "Action plan", description: "Planned steps joined with →" },
];

const CURSOR_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "repoUrl", label: "Repository URL" },
  { path: "agentId", label: "Agent ID" },
  { path: "runId", label: "Run ID" },
];

function requireApiKey(integrationConfig: Record<string, unknown>, step: ActionDefinition): string {
  const key = String(
    integrationConfig.apiKey ?? process.env.CURSOR_API_KEY ?? "",
  ).trim();
  if (!key) {
    failStep({
      message:
        "Cursor API key is not configured — add it in Integrations or set CURSOR_API_KEY",
      code: "cursor.missing_api_key",
      integration: "cursor",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: { repoUrl: "", agentId: "", runId: "" },
    });
  }
  return key;
}

export const launchCloudAgent: ActionDefinition = {
  id: "launch_cloud_agent",
  label: "Launch cloud agent",
  description: "Start a Cursor Cloud Agent on a repository with a prompt (Agent SDK / Cloud Agents API).",
  actionPlan: [
    "Load the Cursor API key from Integrations (or CURSOR_API_KEY)",
    "Interpolate the prompt and repository URL",
    "POST /v1/agents on api.cursor.com and confirm the agent was created",
  ],
  errorCallback: CURSOR_ERROR_CALLBACK,
  fields: [
    {
      key: "prompt",
      label: "Prompt",
      type: "textarea",
      required: true,
      placeholder: "Investigate {{weather.report}} and open a PR if needed.",
    },
    {
      key: "repoUrl",
      label: "Repository URL",
      type: "text",
      required: false,
      placeholder: "https://github.com/org/repo (or Integrations default)",
    },
    {
      key: "startingRef",
      label: "Starting ref",
      type: "text",
      required: false,
      placeholder: "main",
      default: "main",
    },
    {
      key: "autoCreatePR",
      label: "Auto-create PR",
      type: "select",
      required: false,
      default: "true",
      options: [
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ],
    },
    {
      key: "name",
      label: "Agent name",
      type: "text",
      required: false,
      placeholder: "Optional display name",
    },
  ],
  async execute(config, context) {
    const apiKey = requireApiKey(context.integrationConfig, launchCloudAgent);
    const prompt = interpolate(String(config.prompt ?? ""), context.triggerData).trim();
    if (!prompt) {
      failStep({
        message: "Prompt is required",
        code: "cursor.missing_prompt",
        integration: "cursor",
        step: launchCloudAgent.id,
        stepLabel: launchCloudAgent.label,
        kind: "action",
        plan: launchCloudAgent.actionPlan,
        extras: { repoUrl: "", agentId: "", runId: "" },
      });
    }

    const repoUrl = interpolate(
      String(config.repoUrl ?? context.integrationConfig.defaultRepoUrl ?? ""),
      context.triggerData,
    ).trim();
    const startingRef =
      interpolate(String(config.startingRef ?? "main"), context.triggerData).trim() || "main";
    const autoCreatePR = String(config.autoCreatePR ?? "true") !== "false";
    const name = interpolate(String(config.name ?? ""), context.triggerData).trim();

    const body: Record<string, unknown> = {
      prompt: { text: prompt },
      autoCreatePR,
    };
    if (name) body.name = name.slice(0, 100);
    if (repoUrl) {
      body.repos = [{ url: repoUrl, startingRef }];
    }

    let res: Response;
    try {
      res = await fetch("https://api.cursor.com/v1/agents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Cursor API request failed",
        code: "cursor.request_failed",
        integration: "cursor",
        step: launchCloudAgent.id,
        stepLabel: launchCloudAgent.label,
        kind: "action",
        plan: launchCloudAgent.actionPlan,
        extras: { repoUrl, agentId: "", runId: "" },
      });
    }

    if (!res.ok) {
      const text = await res.text();
      failStep({
        message: `Cursor API error ${res.status}: ${text}`,
        code: "cursor.api_error",
        integration: "cursor",
        step: launchCloudAgent.id,
        stepLabel: launchCloudAgent.label,
        kind: "action",
        plan: launchCloudAgent.actionPlan,
        extras: { repoUrl, agentId: "", runId: "", status: res.status },
      });
    }

    const payload = (await res.json()) as {
      agent?: { id?: string };
      run?: { id?: string };
      id?: string;
    };
    // Soft-success — IDs are useful in logs / catch payloads if something fails later.
    void payload;
  },
};
