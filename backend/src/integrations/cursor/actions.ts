import { failStep } from "../errors.js";
import type { ActionDefinition } from "../types.js";

const CURSOR_API = "https://api.cursor.com/v1";
const POLL_MS = 2_000;
const MAX_WAIT_MS = 4 * 60_000;
const ACTIVE_STATUSES = new Set([
  "CREATING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
]);
const TERMINAL_STATUSES = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunText(
  apiKey: string,
  agentId: string,
  runId: string,
  extras: { repoUrl: string },
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    let res: Response;
    try {
      res = await fetch(`${CURSOR_API}/agents/${agentId}/runs/${runId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Cursor run poll failed",
        code: "cursor.poll_failed",
        integration: "cursor",
        step: launchCloudAgent.id,
        stepLabel: launchCloudAgent.label,
        kind: "action",
        plan: launchCloudAgent.actionPlan,
        extras: { ...extras, agentId, runId },
      });
    }

    if (!res.ok) {
      const body = await res.text();
      failStep({
        message: `Cursor run poll error ${res.status}: ${body}`,
        code: "cursor.poll_error",
        integration: "cursor",
        step: launchCloudAgent.id,
        stepLabel: launchCloudAgent.label,
        kind: "action",
        plan: launchCloudAgent.actionPlan,
        extras: { ...extras, agentId, runId, status: res.status },
      });
    }

    const run = (await res.json()) as { id?: string; status?: string; result?: string };
    const status = String(run.status ?? "");
    if (TERMINAL_STATUSES.has(status)) {
      if (status !== "FINISHED") {
        failStep({
          message: `Cursor run ${status}${run.result ? `: ${run.result}` : ""}`,
          code: "cursor.run_failed",
          integration: "cursor",
          step: launchCloudAgent.id,
          stepLabel: launchCloudAgent.label,
          kind: "action",
          plan: launchCloudAgent.actionPlan,
          extras: { ...extras, agentId, runId, status },
        });
      }
      return String(run.result ?? "").trim();
    }
    if (!ACTIVE_STATUSES.has(status) && status) {
      // Unknown but non-active — treat as terminal without text.
      return String(run.result ?? "").trim();
    }
    await sleep(POLL_MS);
  }

  failStep({
    message: "Cursor agent timed out waiting for a reply",
    code: "cursor.timeout",
    integration: "cursor",
    step: launchCloudAgent.id,
    stepLabel: launchCloudAgent.label,
    kind: "action",
    plan: launchCloudAgent.actionPlan,
    extras: { ...extras, agentId, runId },
  });
}

export const launchCloudAgent: ActionDefinition = {
  id: "launch_cloud_agent",
  label: "Launch cloud agent",
  description:
    "Start a Cursor Cloud Agent, wait for it to finish, and expose the reply as {{cursor.text}}.",
  actionPlan: [
    "Load the Cursor API key from Integrations (or CURSOR_API_KEY)",
    "Interpolate the prompt and repository URL",
    "POST /v1/agents on api.cursor.com",
    "Poll the run until finished and capture the reply text",
  ],
  errorCallback: CURSOR_ERROR_CALLBACK,
  outputs: [
    {
      path: "text",
      label: "Agent reply text",
      description: "Final message from the finished cloud agent run",
    },
    { path: "agentId", label: "Agent ID" },
    { path: "runId", label: "Run ID" },
    { path: "repoUrl", label: "Repository URL" },
  ],
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
    const extras = { repoUrl };

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
      res = await fetch(`${CURSOR_API}/agents`, {
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
        extras: { ...extras, agentId: "", runId: "" },
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
        extras: { ...extras, agentId: "", runId: "", status: res.status },
      });
    }

    const payload = (await res.json()) as {
      agent?: { id?: string };
      run?: { id?: string };
      id?: string;
    };
    const agentId = String(payload.agent?.id ?? payload.id ?? "").trim();
    const runId = String(payload.run?.id ?? "").trim();
    if (!agentId || !runId) {
      failStep({
        message: "Cursor API did not return agent/run ids",
        code: "cursor.missing_ids",
        integration: "cursor",
        step: launchCloudAgent.id,
        stepLabel: launchCloudAgent.label,
        kind: "action",
        plan: launchCloudAgent.actionPlan,
        extras: { ...extras, agentId, runId },
      });
    }

    const text = await waitForRunText(apiKey, agentId, runId, extras);
    return { text, agentId, runId, repoUrl };
  },
};
