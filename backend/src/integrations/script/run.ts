import { spawn } from "node:child_process";
import { access, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { failStep } from "../errors.js";
import type { ActionDefinition, TriggerDefinition } from "../types.js";

type StepDef = ActionDefinition | TriggerDefinition;

export function interpolate(template: string, data: Record<string, unknown>): string {
  const context = { ...data, trigger: data };
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, pathExpr: string) => {
    const keys = pathExpr.trim().split(".");
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

export const SCRIPT_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "mode", label: "Mode", description: "code or path" },
  { path: "scriptPath", label: "Script path" },
  { path: "cwd", label: "Working directory" },
  { path: "exitCode", label: "Exit code" },
  { path: "stdout", label: "Stdout" },
  { path: "stderr", label: "Stderr" },
];

export interface ScriptRunResult {
  mode: "code" | "path";
  scriptPath: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

function defaultShell(): string {
  return process.platform === "win32" ? "cmd.exe" : "/bin/sh";
}

async function runProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  stdin?: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: process.env,
      stdio: [options.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        Object.assign(new Error(`Script timed out after ${options.timeoutMs}ms`), {
          code: "script.timeout",
          stdout,
          stderr,
          exitCode: -1,
        }),
      );
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
      if (stdout.length > 500_000) stdout = `${stdout.slice(0, 500_000)}\n…[truncated]`;
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
      if (stderr.length > 500_000) stderr = `${stderr.slice(0, 500_000)}\n…[truncated]`;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 0,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
      });
    });

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    }
  });
}

export async function runScript(options: {
  mode: string;
  code?: string;
  scriptPath?: string;
  cwd?: string;
  timeoutMs?: number;
  failOnNonZero?: boolean;
  integrationConfig: Record<string, unknown>;
  step: StepDef;
  kind: "trigger" | "action";
}): Promise<ScriptRunResult> {
  const mode = options.mode === "path" ? "path" : "code";
  const cwd =
    options.cwd?.trim() ||
    String(options.integrationConfig.defaultCwd ?? "").trim() ||
    process.cwd();
  const shell = String(options.integrationConfig.shell ?? "").trim() || defaultShell();
  const timeoutMs = Math.max(
    1_000,
    Number(options.timeoutMs ?? options.integrationConfig.timeoutMs ?? 60_000) || 60_000,
  );
  const failOnNonZero = options.failOnNonZero !== false;

  let scriptPath = "";
  let tempPath: string | null = null;
  let command = shell;
  let args: string[] = [];
  let stdin: string | undefined;

  try {
    if (mode === "path") {
      scriptPath = options.scriptPath?.trim() || "";
      if (!scriptPath) {
        failStep({
          message: "Script path is empty",
          code: "script.missing_path",
          integration: "script",
          step: options.step.id,
          stepLabel: options.step.label,
          kind: options.kind,
          plan: options.step.actionPlan,
          extras: { mode, scriptPath: "", cwd, exitCode: "", stdout: "", stderr: "" },
        });
      }

      const resolved = path.isAbsolute(scriptPath) ? scriptPath : path.resolve(cwd, scriptPath);
      scriptPath = resolved;
      try {
        await access(resolved);
      } catch {
        failStep({
          message: `Script not found: ${resolved}`,
          code: "script.not_found",
          integration: "script",
          step: options.step.id,
          stepLabel: options.step.label,
          kind: options.kind,
          plan: options.step.actionPlan,
          extras: { mode, scriptPath: resolved, cwd, exitCode: "", stdout: "", stderr: "" },
        });
      }

      if (process.platform === "win32") {
        args = ["/c", resolved];
      } else {
        args = [resolved];
      }
    } else {
      const code = options.code ?? "";
      if (!code.trim()) {
        failStep({
          message: "Script code is empty",
          code: "script.missing_code",
          integration: "script",
          step: options.step.id,
          stepLabel: options.step.label,
          kind: options.kind,
          plan: options.step.actionPlan,
          extras: { mode, scriptPath: "", cwd, exitCode: "", stdout: "", stderr: "" },
        });
      }

      // Prefer a temp file so shebangs / multi-line scripts behave like a real .sh file.
      tempPath = path.join(
        tmpdir(),
        `if-else-script-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`,
      );
      await writeFile(tempPath, code.endsWith("\n") ? code : `${code}\n`, {
        encoding: "utf8",
        mode: 0o700,
      });
      scriptPath = tempPath;

      if (process.platform === "win32") {
        args = ["/c", tempPath];
      } else {
        args = [tempPath];
      }
    }

    const proc = await runProcess({ command, args, cwd, timeoutMs, stdin }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Script failed";
      failStep({
        message,
        code: (err as { code?: string })?.code === "script.timeout" ? "script.timeout" : "script.exec_failed",
        integration: "script",
        step: options.step.id,
        stepLabel: options.step.label,
        kind: options.kind,
        plan: options.step.actionPlan,
        extras: {
          mode,
          scriptPath,
          cwd,
          exitCode: String((err as { exitCode?: number })?.exitCode ?? ""),
          stdout: String((err as { stdout?: string })?.stdout ?? ""),
          stderr: String((err as { stderr?: string })?.stderr ?? message),
        },
      });
    });

    const result: ScriptRunResult = {
      mode,
      scriptPath,
      cwd,
      exitCode: proc.exitCode,
      stdout: proc.stdout,
      stderr: proc.stderr,
    };

    if (failOnNonZero && result.exitCode !== 0) {
      failStep({
        message: `Script exited with code ${result.exitCode}${
          result.stderr ? `: ${result.stderr.slice(0, 400)}` : ""
        }`,
        code: "script.nonzero_exit",
        integration: "script",
        step: options.step.id,
        stepLabel: options.step.label,
        kind: options.kind,
        plan: options.step.actionPlan,
        extras: {
          mode,
          scriptPath: result.scriptPath,
          cwd: result.cwd,
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 4000),
          stderr: result.stderr.slice(0, 4000),
        },
      });
    }

    return result;
  } finally {
    if (tempPath) {
      try {
        await unlink(tempPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

export const SCRIPT_FIELDS = [
  {
    key: "mode",
    label: "Script source",
    type: "select" as const,
    required: true,
    default: "code",
    options: [
      { value: "code", label: "Inline code" },
      { value: "path", label: "File path" },
    ],
  },
  {
    key: "code",
    label: "Script",
    type: "textarea" as const,
    required: false,
    placeholder: "#!/bin/sh\necho \"Alert: {{weather.report}}\"\n",
  },
  {
    key: "scriptPath",
    label: "Script path",
    type: "text" as const,
    required: false,
    placeholder: "/opt/hooks/notify.sh or relative to cwd",
  },
  {
    key: "cwd",
    label: "Working directory",
    type: "text" as const,
    required: false,
    placeholder: "Defaults to Integrations setting or process cwd",
  },
  {
    key: "timeoutMs",
    label: "Timeout (ms)",
    type: "number" as const,
    required: false,
    default: 60000,
    placeholder: "60000",
  },
  {
    key: "failOnNonZero",
    label: "Fail on non-zero exit",
    type: "select" as const,
    required: false,
    default: "true",
    options: [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ],
  },
];
