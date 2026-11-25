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

/** Field available under {{error.*}} when this step fails and CATCH runs. */
export interface ErrorCallbackField {
  path: string;
  label: string;
  description?: string;
}

export interface TriggerDefinition {
  id: string;
  label: string;
  description: string;
  kind?: TriggerKind;
  /** Ordered plan of what this trigger does when evaluated. */
  actionPlan: string[];
  /** Error fields this trigger may populate for CATCH handlers. */
  errorCallback: ErrorCallbackField[];
  fields: FieldSchema[];
  outputs?: TriggerOutput[];
  evaluate: (config: Record<string, unknown>, context: TriggerContext) => Promise<TriggerResult>;
}

export interface ActionDefinition {
  id: string;
  label: string;
  description: string;
  /** Ordered plan of what this action does when executed. */
  actionPlan: string[];
  /** Error fields this action may populate for CATCH handlers. */
  errorCallback: ErrorCallbackField[];
  fields: FieldSchema[];
  /** Template outputs merged under {{integration.path}} after this action runs. */
  outputs?: TriggerOutput[];
  execute: (
    config: Record<string, unknown>,
    context: ActionContext,
  ) => Promise<Record<string, unknown> | void>;
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
