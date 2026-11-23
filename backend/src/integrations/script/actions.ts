import type { ActionDefinition } from "../types.js";
import { SCRIPT_ERROR_CALLBACK, SCRIPT_FIELDS, interpolate, runScript } from "./run.js";

export const runScriptAction: ActionDefinition = {
  id: "run_script",
  label: "Run script",
  description: "Run an inline shell script or a script file on the worker host.",
  actionPlan: [
    "Resolve inline code or a script file path (with template interpolation)",
    "Run it with the configured shell in the working directory",
    "Fail on timeout or non-zero exit unless allowed",
  ],
  errorCallback: SCRIPT_ERROR_CALLBACK,
  fields: SCRIPT_FIELDS,
  async execute(config, context) {
    const mode = String(config.mode ?? "code");
    await runScript({
      mode,
      code: interpolate(String(config.code ?? ""), context.triggerData),
      scriptPath: interpolate(String(config.scriptPath ?? ""), context.triggerData),
      cwd: interpolate(String(config.cwd ?? ""), context.triggerData),
      timeoutMs: Number(config.timeoutMs ?? 60_000),
      failOnNonZero: String(config.failOnNonZero ?? "true") !== "false",
      integrationConfig: context.integrationConfig,
      step: runScriptAction,
      kind: "action",
    });
  },
};
