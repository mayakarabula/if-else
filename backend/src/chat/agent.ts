import { serviceGetRule, serviceListIntegrations } from "../tools/rulesService.js";
import {
  buildCursorToolProtocolPrompt,
  ensureCursorAgent,
  parseCursorReply,
  runCursorPrompt,
} from "./cursorProvider.js";
import { chatStatus, resolveChatProvider, type ResolvedChatProvider } from "./providers.js";
import {
  createChatSession,
  getChatSession,
  newMessage,
  publicMessages,
  saveChatSession,
} from "./sessions.js";
import { chatTools, executeChatTool } from "./tools.js";
import type { ChatMutation, ChatSession, PageContext } from "./types.js";

const MAX_TOOL_ROUNDS = 8;

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export async function chatConfigured() {
  return (await chatStatus()).configured;
}

async function buildSystemPrompt(pageContext?: PageContext): Promise<string> {
  const integrations = await serviceListIntegrations();
  const catalog = integrations.map((item) => ({
    id: item.id,
    name: item.name,
    triggers: item.triggers?.map((t) => ({
      id: t.id,
      label: t.label,
      kind: t.kind ?? "condition",
      fields: t.fields?.map((f) => f.key),
    })),
    actions: item.actions?.map((a) => ({
      id: a.id,
      label: a.label,
      fields: a.fields?.map((f) => f.key),
    })),
  }));

  let pageBlock = "The user is somewhere in the if-else app.";
  if (pageContext) {
    pageBlock = `The user is currently on page "${pageContext.page}" at path ${pageContext.path}${
      pageContext.label ? ` (${pageContext.label})` : ""
    }.`;
    if (pageContext.ruleId) {
      try {
        const rule = await serviceGetRule(pageContext.ruleId);
        pageBlock += `\nThey are editing rule ${pageContext.ruleId}. Current rule JSON:\n${JSON.stringify(rule, null, 2)}`;
      } catch {
        pageBlock += `\nThey appear to be editing rule ${pageContext.ruleId}, but it could not be loaded.`;
      }
    }
  }

  return `You are the if-else assistant embedded in the product UI.
Help the user manage automations: create/edit/delete rules, configure integrations, and explain how triggers and actions work.
Use tools for any read or write against live data — do not invent rule ids or pretend a change succeeded.
When creating rules, call list_integrations first unless you already know the exact trigger/action ids and required fields.
Every rule with a Then must also include a Catch action (error handler; templates may use {{error.message}}).
Integrations — pick the right edit path:
- Secrets/settings for any integration: update_integration_config.
- Custom HTTP (custom: true): create_integration / get_custom_integration / update_integration / delete_integration for YAML request templates. Do not invent built-in ids.
- Built-in TypeScript (cursor, telegram, weather, …): list_integration_sources → get_integration_source → update_integration_source with paths like cursor/actions.ts or registry.ts. That is how you change action/trigger code (fields, execute body, wiring). update_integration does NOT work on built-ins. After source writes, note that api+worker need reload (tsx watch handles local dev).
Prefer concise answers. After making changes, briefly confirm what you did and mention ids.
Suggest navigation when useful (e.g. /integrations, /create, /rules/<id>/edit) but you cannot open pages yourself.

${pageBlock}

Available integrations (summary):
${JSON.stringify(catalog, null, 2)}`;
}

async function callOpenAiModel(provider: ResolvedChatProvider, messages: OpenAiMessage[]) {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      tools: chatTools,
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat model error ${res.status}: ${text.slice(0, 500)}`);
  }

  const payload = (await res.json()) as {
    choices?: Array<{ message?: OpenAiMessage }>;
  };
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error("Chat model returned no message");
  return message;
}

function toModelMessages(session: ChatSession, system: string): OpenAiMessage[] {
  const history: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const message of session.messages) {
    if (message.role === "user") {
      history.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      history.push({
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls?.length ? { tool_calls: message.toolCalls } : {}),
      });
    } else if (message.role === "tool") {
      history.push({
        role: "tool",
        content: message.content,
        tool_call_id: message.toolCallId,
      });
    }
  }
  return history;
}

function latestUserText(session: ChatSession): string {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    if (session.messages[i].role === "user") return session.messages[i].content;
  }
  return "";
}

async function runOpenAiTurn(session: ChatSession, system: string, provider: ResolvedChatProvider) {
  const mutations = new Set<ChatMutation>();
  const toolTrace: Array<{ name: string; ok: boolean }> = [];
  let current = session;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const reply = await callOpenAiModel(provider, toModelMessages(current, system));
    const toolCalls = reply.tool_calls ?? [];

    if (toolCalls.length > 0) {
      current.messages.push(newMessage("assistant", reply.content ?? "", { toolCalls }));
      for (const call of toolCalls) {
        const result = await executeChatTool(call.function.name, call.function.arguments ?? "{}");
        for (const mutation of result.mutations) mutations.add(mutation);
        toolTrace.push({ name: call.function.name, ok: result.ok });
        current.messages.push(
          newMessage("tool", JSON.stringify(result.result), {
            toolName: call.function.name,
            toolCallId: call.id,
          }),
        );
      }
      current = await saveChatSession(current);
      continue;
    }

    current.messages.push(newMessage("assistant", (reply.content ?? "").trim() || "Done."));
    current = await saveChatSession(current);
    return { session: current, mutations: [...mutations], toolTrace };
  }

  current.messages.push(
    newMessage(
      "assistant",
      "I hit the tool-call limit for this turn. Ask me to continue if you want me to keep going.",
    ),
  );
  current = await saveChatSession(current);
  return { session: current, mutations: [...mutations], toolTrace };
}

async function runCursorTurn(session: ChatSession, system: string, provider: ResolvedChatProvider) {
  const mutations = new Set<ChatMutation>();
  const toolTrace: Array<{ name: string; ok: boolean }> = [];
  let current: ChatSession = { ...session, provider: "cursor" };

  const bootstrap = buildCursorToolProtocolPrompt(system);
  const ensured = await ensureCursorAgent({
    provider,
    existingAgentId: current.cursorAgentId,
    bootstrapPrompt: bootstrap,
  });
  current.cursorAgentId = ensured.agentId;
  current = await saveChatSession(current);

  let prompt = [
    "Page/system context is already loaded for this agent.",
    `User message:\n${latestUserText(current)}`,
    "Respond with the JSON protocol only.",
  ].join("\n\n");

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const raw = await runCursorPrompt({
      provider,
      agentId: current.cursorAgentId!,
      prompt,
    });
    const parsed = parseCursorReply(raw);

    if (parsed.kind === "tools") {
      current.messages.push(
        newMessage("assistant", "", {
          toolCalls: parsed.toolCalls,
        }),
      );

      const results: Array<{ name: string; ok: boolean; result: unknown }> = [];
      for (const call of parsed.toolCalls) {
        const executed = await executeChatTool(call.function.name, call.function.arguments ?? "{}");
        for (const mutation of executed.mutations) mutations.add(mutation);
        toolTrace.push({ name: call.function.name, ok: executed.ok });
        results.push({ name: call.function.name, ok: executed.ok, result: executed.result });
        current.messages.push(
          newMessage("tool", JSON.stringify(executed.result), {
            toolName: call.function.name,
            toolCallId: call.id,
          }),
        );
      }
      current = await saveChatSession(current);
      prompt = [
        "Tool results from the if-else host:",
        JSON.stringify(results, null, 2),
        "Continue. Reply with more tool_calls or a final {\"message\":\"...\"} JSON object only.",
      ].join("\n\n");
      continue;
    }

    current.messages.push(newMessage("assistant", parsed.content));
    current = await saveChatSession(current);
    return { session: current, mutations: [...mutations], toolTrace };
  }

  current.messages.push(
    newMessage(
      "assistant",
      "I hit the tool-call limit for this turn. Ask me to continue if you want me to keep going.",
    ),
  );
  current = await saveChatSession(current);
  return { session: current, mutations: [...mutations], toolTrace };
}

export async function runChatTurn(input: {
  sessionId?: string;
  message: string;
  pageContext?: PageContext;
}) {
  const text = input.message.trim();
  if (!text) throw new Error("Message is required");

  const provider = await resolveChatProvider("auto");
  if (!provider) {
    throw new Error(
      "Chat is not configured — open Integrations → Agent chat, or set CHAT_API_KEY / CURSOR_API_KEY",
    );
  }

  let session =
    (input.sessionId ? await getChatSession(input.sessionId) : null) ??
    (await createChatSession(input.pageContext));

  if (input.pageContext) {
    session = { ...session, pageContext: input.pageContext };
  }
  session.provider = provider.id;
  session.messages.push(newMessage("user", text));
  session = await saveChatSession(session);

  const system = await buildSystemPrompt(session.pageContext);
  const result =
    provider.id === "cursor"
      ? await runCursorTurn(session, system, provider)
      : await runOpenAiTurn(session, system, provider);

  const status = await chatStatus();
  return {
    sessionId: result.session.id,
    messages: publicMessages(result.session),
    mutations: result.mutations,
    toolTrace: result.toolTrace,
    configured: true,
    provider: status.provider,
    providerLabel: status.providerLabel,
  };
}
