import { randomUUID } from "node:crypto";
import type { ResolvedChatProvider } from "./providers.js";
import { chatTools } from "./tools.js";

const CURSOR_API = "https://api.cursor.com/v1";
const POLL_MS = 2_000;
const MAX_WAIT_MS = 4 * 60_000;
const ACTIVE_STATUSES = new Set([
  "CREATING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
]);
const TERMINAL_STATUSES = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

interface CursorRun {
  id: string;
  agentId?: string;
  status: string;
  result?: string;
}

interface CursorAgent {
  id: string;
  status?: string;
  latestRunId?: string;
}

/** Serialize follow-ups per agent so concurrent UI requests don't race into 409. */
const agentLocks = new Map<string, Promise<unknown>>();

async function withAgentLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
  const previous = agentLocks.get(agentId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.catch(() => undefined).then(() => gate);
  agentLocks.set(agentId, chain);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function cursorFetch(path: string, apiKey: string, init?: RequestInit) {
  const res = await fetch(`${CURSOR_API}${path}`, {
    ...init,
    headers: {
      ...authHeaders(apiKey),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const message =
      typeof json === "object" &&
      json &&
      "error" in json &&
      typeof (json as { error?: { message?: string } }).error?.message === "string"
        ? (json as { error: { message: string } }).error.message
        : text.slice(0, 500) || res.statusText;
    const err = new Error(`Cursor API ${res.status}: ${message}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return json;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBusyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as Error & { status?: number }).status;
  return status === 409 || /agent already has an active run|agent_busy/i.test(err.message);
}

async function getAgent(apiKey: string, agentId: string): Promise<CursorAgent> {
  return (await cursorFetch(`/agents/${agentId}`, apiKey)) as CursorAgent;
}

async function getRun(apiKey: string, agentId: string, runId: string): Promise<CursorRun> {
  return (await cursorFetch(`/agents/${agentId}/runs/${runId}`, apiKey)) as CursorRun;
}

async function cancelRun(apiKey: string, agentId: string, runId: string): Promise<void> {
  try {
    await cursorFetch(`/agents/${agentId}/runs/${runId}/cancel`, apiKey, { method: "POST" });
  } catch (err) {
    // Already terminal / not cancellable — treat as idle enough to continue.
    if (!isBusyError(err) && !(err instanceof Error && /409/.test(err.message))) {
      // ignore other cancel races
    }
  }
}

async function waitForRun(
  apiKey: string,
  agentId: string,
  runId: string,
  options?: { maxWaitMs?: number },
): Promise<string> {
  const maxWait = options?.maxWaitMs ?? MAX_WAIT_MS;
  const started = Date.now();
  while (Date.now() - started < maxWait) {
    const run = await getRun(apiKey, agentId, runId);
    if (TERMINAL_STATUSES.has(run.status)) {
      if (run.status !== "FINISHED") {
        throw new Error(`Cursor run ${run.status}${run.result ? `: ${run.result}` : ""}`);
      }
      return String(run.result ?? "").trim();
    }
    await sleep(POLL_MS);
  }
  throw new Error("Cursor agent timed out waiting for a reply");
}

/**
 * Cursor allows only one active run per agent. Wait for the latest run to
 * finish; if it's stuck past a grace period, cancel it so follow-ups can proceed.
 */
async function waitUntilAgentIdle(
  apiKey: string,
  agentId: string,
  options?: { cancelAfterMs?: number },
): Promise<void> {
  const cancelAfterMs = options?.cancelAfterMs ?? 90_000;
  const started = Date.now();

  while (Date.now() - started < MAX_WAIT_MS) {
    const agent = await getAgent(apiKey, agentId);
    if (agent.status === "ARCHIVED") {
      throw new Error("Cursor agent was archived — start a new chat");
    }
    if (agent.status === "IDLE" || !agent.latestRunId) return;

    const run = await getRun(apiKey, agentId, agent.latestRunId);
    if (!ACTIVE_STATUSES.has(run.status)) return;

    if (Date.now() - started >= cancelAfterMs) {
      await cancelRun(apiKey, agentId, run.id);
      // Give the API a moment to flip status, then re-check.
      await sleep(POLL_MS);
      continue;
    }

    await sleep(POLL_MS);
  }

  throw new Error("Cursor agent stayed busy too long — try New chat or retry");
}

export function buildCursorToolProtocolPrompt(systemPrompt: string): string {
  const toolNames = chatTools.map((tool) => tool.function.name);
  return `${systemPrompt}

You are running as a Cursor Cloud Agent for the if-else product assistant.
Do not edit the Cursor-attached GitHub clone for live product changes. Use the JSON tool protocol below so the host applies them: rules/config, custom HTTP YAML (create/update/delete_integration), and built-in TypeScript via list/get/update_integration_source (paths under backend/src/integrations, e.g. cursor/actions.ts).

Response format — reply with ONE JSON object only (no markdown fences):
1) Call tools:
{"tool_calls":[{"name":"list_rules","arguments":{}}]}
2) Final user-facing answer:
{"message":"your reply"}

Available tool names: ${toolNames.join(", ")}
Tool schemas:
${JSON.stringify(
  chatTools.map((tool) => tool.function),
  null,
  2,
)}

Rules:
- Prefer tools over guessing live data.
- You may issue multiple tool_calls in one response.
- After tool results are provided, continue until you can return {"message":"..."}.`;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // try to find an embedded object
  }

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export type CursorModelReply =
  | {
      kind: "tools";
      toolCalls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { kind: "message"; content: string };

export function parseCursorReply(raw: string): CursorModelReply {
  const obj = extractJsonObject(raw);
  if (obj) {
    if (Array.isArray(obj.tool_calls)) {
      const toolCalls = obj.tool_calls
        .map((item, index) => {
          if (!item || typeof item !== "object") return null;
          const call = item as Record<string, unknown>;
          const name = String(call.name ?? "").trim();
          if (!name) return null;
          const args =
            typeof call.arguments === "string"
              ? call.arguments
              : JSON.stringify(call.arguments ?? {});
          return {
            id: String(call.id ?? `call_${randomUUID().replace(/-/g, "").slice(0, 8)}_${index}`),
            type: "function" as const,
            function: { name, arguments: args },
          };
        })
        .filter(Boolean) as Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
      if (toolCalls.length > 0) return { kind: "tools", toolCalls };
    }
    if (typeof obj.message === "string" && obj.message.trim()) {
      return { kind: "message", content: obj.message.trim() };
    }
  }

  // Fallback: treat free text as the user-facing answer.
  return { kind: "message", content: raw.trim() || "Done." };
}

export async function ensureCursorAgent(options: {
  provider: ResolvedChatProvider;
  existingAgentId?: string;
  bootstrapPrompt: string;
}): Promise<{ agentId: string; created: boolean }> {
  if (options.existingAgentId) {
    try {
      const agent = await getAgent(options.provider.apiKey, options.existingAgentId);
      if (agent.status !== "ARCHIVED") {
        // Make sure a leftover run from a timed-out / abandoned turn is cleared.
        await waitUntilAgentIdle(options.provider.apiKey, options.existingAgentId, {
          cancelAfterMs: 15_000,
        });
        return { agentId: options.existingAgentId, created: false };
      }
    } catch {
      // recreate below
    }
  }

  const body: Record<string, unknown> = {
    name: "if-else chat",
    prompt: { text: options.bootstrapPrompt },
    autoCreatePR: false,
  };
  if (options.provider.model) {
    body.model = { id: options.provider.model };
  }
  if (options.provider.repoUrl) {
    body.repos = [
      {
        url: options.provider.repoUrl,
        startingRef: options.provider.startingRef ?? "main",
      },
    ];
  }

  const created = (await cursorFetch("/agents", options.provider.apiKey, {
    method: "POST",
    body: JSON.stringify(body),
  })) as {
    agent?: { id?: string };
    id?: string;
    run?: { id?: string };
  };

  const agentId = created.agent?.id ?? created.id;
  if (!agentId) throw new Error("Cursor create agent response missing agent id");

  const runId = created.run?.id;
  if (runId) {
    try {
      await waitForRun(options.provider.apiKey, agentId, runId);
    } catch {
      // Bootstrap can hang; cancel so the first user turn isn't 409'd.
      await cancelRun(options.provider.apiKey, agentId, runId);
      await waitUntilAgentIdle(options.provider.apiKey, agentId, { cancelAfterMs: 5_000 });
    }
  } else {
    await waitUntilAgentIdle(options.provider.apiKey, agentId, { cancelAfterMs: 30_000 });
  }

  return { agentId, created: true };
}

async function createFollowUpRun(
  apiKey: string,
  agentId: string,
  prompt: string,
  model?: string,
): Promise<string> {
  const created = (await cursorFetch(`/agents/${agentId}/runs`, apiKey, {
    method: "POST",
    body: JSON.stringify({
      prompt: { text: prompt },
      ...(model ? { model: { id: model } } : {}),
    }),
  })) as { run?: { id?: string }; id?: string };

  const runId = created.run?.id ?? created.id;
  if (!runId) throw new Error("Cursor follow-up response missing run id");
  return runId;
}

export async function runCursorPrompt(options: {
  provider: ResolvedChatProvider;
  agentId: string;
  prompt: string;
}): Promise<string> {
  return withAgentLock(options.agentId, async () => {
    await waitUntilAgentIdle(options.provider.apiKey, options.agentId, {
      cancelAfterMs: 20_000,
    });

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const runId = await createFollowUpRun(
          options.provider.apiKey,
          options.agentId,
          options.prompt,
          options.provider.model,
        );
        return await waitForRun(options.provider.apiKey, options.agentId, runId);
      } catch (err) {
        lastError = err;
        if (!isBusyError(err)) throw err;
        // Another run won the race — wait/cancel, then retry.
        await waitUntilAgentIdle(options.provider.apiKey, options.agentId, {
          cancelAfterMs: 10_000,
        });
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Cursor agent stayed busy after retries");
  });
}
