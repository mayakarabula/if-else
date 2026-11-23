import type { TriggerDefinition } from "../types.js";
import { SCRIPT_ERROR_CALLBACK, SCRIPT_FIELDS, interpolate, runScript } from "./run.js";

export const captureScript: TriggerDefinition = {
  id: "capture_script",
  label: "Capture script output",
  description: "Runs an inline script or script file and exposes stdout/stderr/exitCode as SOURCE data.",
  kind: "data",
  actionPlan: [
    "Resolve inline code or a script file path",
    "Run it with the configured shell",
    "Expose stdout, stderr, and exitCode for templates",
  ],
  errorCallback: SCRIPT_ERROR_CALLBACK,
  fields: SCRIPT_FIELDS,
  outputs: [
    { path: "stdout", label: "Stdout" },
    { path: "stderr", label: "Stderr" },
    { path: "exitCode", label: "Exit code" },
    { path: "mode", label: "Mode" },
    { path: "scriptPath", label: "Script path" },
    { path: "cwd", label: "Working directory" },
  ],
  async evaluate(config, context) {
    const mode = String(config.mode ?? "code");
    // SOURCE nodes run with empty prior trigger merge for their own templates;
    // engine still merges outputs under the integration key afterward.
    const result = await runScript({
      mode,
      code: interpolate(String(config.code ?? ""), {}),
      scriptPath: interpolate(String(config.scriptPath ?? ""), {}),
      cwd: interpolate(String(config.cwd ?? ""), {}),
      timeoutMs: Number(config.timeoutMs ?? 60_000),
      failOnNonZero: String(config.failOnNonZero ?? "true") !== "false",
      integrationConfig: context.integrationConfig,
      step: captureScript,
      kind: "trigger",
    });

    return {
      fired: true,
      data: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        mode: result.mode,
        scriptPath: result.scriptPath,
        cwd: result.cwd,
      },
    };
  },
};
