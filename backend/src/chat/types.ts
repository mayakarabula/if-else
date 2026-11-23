export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface PageContext {
  path: string;
  page: "rules" | "create" | "edit" | "integrations" | "activity" | "other";
  ruleId?: string;
  label?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  /** Tool name when role is tool or when assistant requested tools. */
  toolName?: string;
  toolCallId?: string;
  /** Assistant-only: raw tool calls for the model loop (not shown in UI). */
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface ChatSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  pageContext?: PageContext;
  messages: ChatMessage[];
}

export type ChatMutation = "rules" | "integrations" | "runs";
