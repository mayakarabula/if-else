import { loadIntegrationConfig } from "../store/rules.js";
import type { ChatProviderId } from "./types.js";

export interface AgentChatConfig {
  provider?: "auto" | ChatProviderId;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  cursorApiKey?: string;
  cursorModel?: string;
  cursorRepoUrl?: string;
  cursorStartingRef?: string;
}

export interface ResolvedChatProvider {
  id: ChatProviderId;
  label: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  repoUrl?: string;
  startingRef?: string;
}

export function readAgentChatConfig(
  integrationConfig?: Record<string, Record<string, unknown>>,
): AgentChatConfig {
  const raw = (integrationConfig?.agentchat ?? {}) as Record<string, unknown>;
  return {
    provider: (["auto", "openai", "cursor"].includes(String(raw.provider))
      ? String(raw.provider)
      : "auto") as AgentChatConfig["provider"],
    openaiApiKey: String(raw.openaiApiKey ?? "").trim() || undefined,
    openaiBaseUrl: String(raw.openaiBaseUrl ?? "").trim() || undefined,
    openaiModel: String(raw.openaiModel ?? "").trim() || undefined,
    cursorApiKey: String(raw.cursorApiKey ?? "").trim() || undefined,
    cursorModel: String(raw.cursorModel ?? "").trim() || undefined,
    cursorRepoUrl: String(raw.cursorRepoUrl ?? "").trim() || undefined,
    cursorStartingRef: String(raw.cursorStartingRef ?? "").trim() || undefined,
  };
}

export function redactAgentChatConfig(config: AgentChatConfig): AgentChatConfig {
  return {
    ...config,
    openaiApiKey: config.openaiApiKey ? "[configured]" : undefined,
    cursorApiKey: config.cursorApiKey ? "[configured]" : undefined,
  };
}

export async function resolveChatProvider(
  preferred?: ChatProviderId | "auto",
): Promise<ResolvedChatProvider | null> {
  const integrationConfig = await loadIntegrationConfig();
  const ui = readAgentChatConfig(integrationConfig);

  const explicit = String(
    preferred && preferred !== "auto"
      ? preferred
      : process.env.CHAT_PROVIDER ?? ui.provider ?? "auto",
  )
    .trim()
    .toLowerCase();

  const openaiKey = String(
    ui.openaiApiKey ?? process.env.CHAT_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
  ).trim();
  const openai = openaiKey
    ? ({
        id: "openai" as const,
        label: "OpenAI-compatible",
        apiKey: openaiKey,
        baseUrl: String(
          ui.openaiBaseUrl ?? process.env.CHAT_BASE_URL ?? "https://api.openai.com/v1",
        ).replace(/\/$/, ""),
        model:
          String(ui.openaiModel ?? process.env.CHAT_MODEL ?? "gpt-4o-mini").trim() ||
          "gpt-4o-mini",
      } satisfies ResolvedChatProvider)
    : null;

  const cursorKey = String(
    ui.cursorApiKey ??
      process.env.CURSOR_API_KEY ??
      integrationConfig.cursor?.apiKey ??
      "",
  ).trim();
  const cursor = cursorKey
    ? ({
        id: "cursor" as const,
        label: "Cursor Agent",
        apiKey: cursorKey,
        model:
          String(ui.cursorModel ?? process.env.CHAT_CURSOR_MODEL ?? "").trim() || undefined,
        repoUrl: String(
          ui.cursorRepoUrl ??
            process.env.CHAT_CURSOR_REPO_URL ??
            integrationConfig.cursor?.defaultRepoUrl ??
            "",
        ).trim(),
        startingRef:
          String(
            ui.cursorStartingRef ?? process.env.CHAT_CURSOR_STARTING_REF ?? "main",
          ).trim() || "main",
      } satisfies ResolvedChatProvider)
    : null;

  if (explicit === "cursor") return cursor;
  if (explicit === "openai") return openai;
  return openai ?? cursor;
}

export async function chatStatus() {
  const integrationConfig = await loadIntegrationConfig();
  const ui = readAgentChatConfig(integrationConfig);
  const provider = await resolveChatProvider(ui.provider ?? "auto");
  return {
    configured: Boolean(provider),
    provider: provider?.id ?? null,
    providerLabel: provider?.label ?? null,
    preference: ui.provider ?? "auto",
  };
}
