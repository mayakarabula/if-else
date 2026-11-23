export interface FieldSchema {
  key: string;
  label: string;
  type: "text" | "number" | "textarea" | "select" | "place";
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  default?: string | number;
}

export interface TriggerOutput {
  path: string;
  label: string;
  description?: string;
}

export interface ErrorCallbackField {
  path: string;
  label: string;
  description?: string;
}

export interface TriggerMeta {
  id: string;
  label: string;
  description: string;
  kind?: "condition" | "data";
  fields: FieldSchema[];
  outputs?: TriggerOutput[];
  actionPlan?: string[];
  errorCallback?: ErrorCallbackField[];
}

export interface ActionMeta {
  id: string;
  label: string;
  description: string;
  fields: FieldSchema[];
  actionPlan?: string[];
  errorCallback?: ErrorCallbackField[];
}

export interface Integration {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** True for user/AI-defined HTTP integrations. */
  custom?: boolean;
  description?: string;
  /** Settings fields for custom (and optionally built-in) integrations. */
  configFields?: FieldSchema[];
  triggers?: TriggerMeta[];
  actions?: ActionMeta[];
}

export interface RuleIfClause {
  integration: string;
  trigger: string;
  config: Record<string, unknown>;
}

export interface RuleIfBlock {
  all?: RuleIfClause[];
  any?: RuleIfClause[];
  pollInterval?: string;
}

export type RuleIf = RuleIfClause | RuleIfBlock;

export interface RuleThenClause {
  integration: string;
  action: string;
  config: Record<string, unknown>;
}

export interface RuleThenBlock {
  all: RuleThenClause[];
}

export type RuleThen = RuleThenClause | RuleThenBlock;

export type RuleRunTrigger = "timer" | "webhook";

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  /** `timer` (default) polls; `webhook` only runs via `/api/hooks/:token`. */
  runTrigger?: RuleRunTrigger;
  webhookToken?: string;
  if: RuleIf;
  then: RuleThen;
  else?: RuleThen;
  catch?: RuleThen;
  createdAt?: string;
  updatedAt?: string;
}

export interface RunLog {
  id: string;
  ruleId: string;
  ruleName: string;
  status: "success" | "error" | "skipped";
  message: string;
  triggerData?: Record<string, unknown>;
  timestamp: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // Keep raw response text.
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  getMe: () => request<{ user: AuthUser }>("/api/auth/me"),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  login: (input: { email: string; password: string }) =>
    request<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  register: (input: { email: string; password: string; name?: string }) =>
    request<{ user: AuthUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getRules: () => request<Rule[]>("/api/rules"),
  getRule: (id: string) => request<Rule>(`/api/rules/${id}`),
  createRule: (rule: Partial<Rule>) =>
    request<Rule>("/api/rules", { method: "POST", body: JSON.stringify(rule) }),
  updateRule: (id: string, rule: Partial<Rule>) =>
    request<Rule>(`/api/rules/${id}`, { method: "PUT", body: JSON.stringify(rule) }),
  toggleRule: (id: string) => request<Rule>(`/api/rules/${id}/toggle`, { method: "PATCH" }),
  runRule: (id: string) => request<RunLog>(`/api/rules/${id}/run`, { method: "POST" }),
  deleteRule: (id: string) => request<void>(`/api/rules/${id}`, { method: "DELETE" }),
  getIntegrations: () => request<Integration[]>("/api/integrations"),
  getIntegrationConfig: () => request<Record<string, Record<string, unknown>>>("/api/integrations/config"),
  saveIntegrationConfig: (config: Record<string, Record<string, unknown>>) =>
    request<Record<string, Record<string, unknown>>>("/api/integrations/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  getRuns: () => request<RunLog[]>("/api/runs"),
  getChatStatus: () => request<ChatStatus>("/api/chat/status"),
  listChatSessions: () => request<{ sessions: ChatSessionSummary[] }>("/api/chat/sessions"),
  getChatEvents: (since?: string) =>
    request<{ events: ChatDataEvent[] }>(
      since ? `/api/chat/events?since=${encodeURIComponent(since)}` : "/api/chat/events",
    ),
  getChatSession: (id: string) =>
    request<{
      sessionId: string;
      messages: ChatMessage[];
      pageContext?: PageContext;
    } & ChatStatus>(`/api/chat/${id}`),
  clearChatSession: (id: string) => request<void>(`/api/chat/${id}`, { method: "DELETE" }),
  sendChat: (input: { sessionId?: string; message: string; pageContext?: PageContext }) =>
    request<ChatTurnResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

export type ChatMutation = "rules" | "integrations" | "runs";

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
  toolName?: string;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  pageLabel?: string;
  provider?: "openai" | "cursor";
}

export interface ChatDataEvent {
  id: string;
  at: string;
  mutations: ChatMutation[];
  ruleId?: string;
  integrationId?: string;
}

export interface ChatStatus {
  configured: boolean;
  provider?: "openai" | "cursor" | null;
  providerLabel?: string | null;
  preference?: "auto" | "openai" | "cursor";
  cursorEnvConfigured?: boolean;
  cursorIntegrationConfigured?: boolean;
  cursorUiConfigured?: boolean;
}

export interface ChatTurnResponse extends ChatStatus {
  sessionId: string;
  messages: ChatMessage[];
  mutations: ChatMutation[];
  toolTrace?: Array<{ name: string; ok: boolean }>;
}

export type DataChangedDetail = {
  mutations: ChatMutation[];
  ruleId?: string;
  integrationId?: string;
  source?: "chat" | "chat-live" | "ui";
};

export function notifyDataChanged(
  mutations: ChatMutation[],
  extra?: Omit<DataChangedDetail, "mutations">,
) {
  if (typeof window === "undefined" || mutations.length === 0) return;
  window.dispatchEvent(
    new CustomEvent("if-else:data-changed", {
      detail: { mutations, ...extra } satisfies DataChangedDetail,
    }),
  );
}

export function getIntegration(integrations: Integration[], id: string) {
  return integrations.find((i) => i.id === id);
}
