import { serviceGetRule, serviceListIntegrations } from "../tools/rulesService.js";
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

function chatConfig() {
  const apiKey = String(process.env.CHAT_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim();
  const baseUrl = String(process.env.CHAT_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = String(process.env.CHAT_MODEL ?? "gpt-4o-mini").trim() || "gpt-4o-mini";
  return { apiKey, baseUrl, model };
}

export function chatConfigured() {
  return Boolean(chatConfig().apiKey);
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
Prefer concise answers. After making changes, briefly confirm what you did and mention ids.
Suggest navigation when useful (e.g. /integrations, /create, /rules/<id>/edit) but you cannot open pages yourself.

${pageBlock}

Available integrations (summary):
${JSON.stringify(catalog, null, 2)}`;
}

async function callChatModel(messages: OpenAiMessage[]) {
  const { apiKey, baseUrl, model } = chatConfig();
  if (!apiKey) {
    throw new Error(
      "Chat is not configured — set CHAT_API_KEY (or OPENAI_API_KEY) on the backend",
    );
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
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
    choices?: Array<{
      message?: OpenAiMessage;
    }>;
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

export async function runChatTurn(input: {
  sessionId?: string;
  message: string;
  pageContext?: PageContext;
}) {
  const text = input.message.trim();
  if (!text) throw new Error("Message is required");

  let session =
    (input.sessionId ? await getChatSession(input.sessionId) : null) ??
    (await createChatSession(input.pageContext));

  if (input.pageContext) {
    session = { ...session, pageContext: input.pageContext };
  }

  session.messages.push(newMessage("user", text));
  session = await saveChatSession(session);

  const system = await buildSystemPrompt(session.pageContext);
  const mutations = new Set<ChatMutation>();
  const toolTrace: Array<{ name: string; ok: boolean }> = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const modelMessages = toModelMessages(session, system);
    const reply = await callChatModel(modelMessages);
    const toolCalls = reply.tool_calls ?? [];

    if (toolCalls.length > 0) {
      session.messages.push(
        newMessage("assistant", reply.content ?? "", {
          toolCalls,
        }),
      );

      for (const call of toolCalls) {
        const result = await executeChatTool(call.function.name, call.function.arguments ?? "{}");
        for (const mutation of result.mutations) mutations.add(mutation);
        toolTrace.push({ name: call.function.name, ok: result.ok });
        session.messages.push(
          newMessage("tool", JSON.stringify(result.result), {
            toolName: call.function.name,
            toolCallId: call.id,
          }),
        );
      }

      session = await saveChatSession(session);
      continue;
    }

    const content = (reply.content ?? "").trim() || "Done.";
    session.messages.push(newMessage("assistant", content));
    session = await saveChatSession(session);

    return {
      sessionId: session.id,
      messages: publicMessages(session),
      mutations: [...mutations],
      toolTrace,
      configured: true,
    };
  }

  session.messages.push(
    newMessage(
      "assistant",
      "I hit the tool-call limit for this turn. Ask me to continue if you want me to keep going.",
    ),
  );
  session = await saveChatSession(session);

  return {
    sessionId: session.id,
    messages: publicMessages(session),
    mutations: [...mutations],
    toolTrace,
    configured: true,
  };
}
