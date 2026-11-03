export type IntegrationKind = "trigger" | "action";

export interface FieldSchema {
  key: string;
  label: string;
  type: "text" | "number" | "textarea" | "select" | "place";
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  default?: string | number;
}

export type TriggerKind = "condition" | "data";

export interface TriggerOutput {
  path: string;
  label: string;
  description?: string;
}

export interface TriggerDefinition {
  id: string;
  label: string;
  description: string;
  kind?: TriggerKind;
  fields: FieldSchema[];
  outputs?: TriggerOutput[];
  evaluate: (config: Record<string, unknown>, context: TriggerContext) => Promise<TriggerResult>;
}

export interface ActionDefinition {
  id: string;
  label: string;
  description: string;
  fields: FieldSchema[];
  execute: (config: Record<string, unknown>, context: ActionContext) => Promise<void>;
}

export interface IntegrationDefinition {
  id: string;
  name: string;
  icon: string;
  color: string;
  triggers?: TriggerDefinition[];
  actions?: ActionDefinition[];
}

export interface TriggerContext {
  integrationConfig: Record<string, unknown>;
  lastState?: Record<string, unknown>;
  manual?: boolean;
}

export interface ActionContext {
  integrationConfig: Record<string, unknown>;
  triggerData: Record<string, unknown>;
}

export interface TriggerResult {
  fired: boolean;
  data: Record<string, unknown>;
  state?: Record<string, unknown>;
}
