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

export interface TriggerMeta {
  id: string;
  label: string;
  description: string;
  kind?: "condition" | "data";
  fields: FieldSchema[];
  outputs?: TriggerOutput[];
}

export interface ActionMeta {
  id: string;
  label: string;
  description: string;
  fields: FieldSchema[];
}

export interface Integration {
  id: string;
  name: string;
  icon: string;
  color: string;
  triggers?: TriggerMeta[];
  actions?: ActionMeta[];
}

export interface RuleIfClause {
  integration: string;
  trigger: string;
  config: Record<string, unknown>;
}

export interface RuleIfBlock {
  all: RuleIfClause[];
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

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  if: RuleIf;
  then: RuleThen;
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
};

export function getIntegration(integrations: Integration[], id: string) {
  return integrations.find((i) => i.id === id);
}
