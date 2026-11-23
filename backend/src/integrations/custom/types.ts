import type { FieldSchema } from "../types.js";

export interface CustomHttpRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Supports {{config.*}}, action field keys, and trigger template paths. */
  url: string;
  headers?: Record<string, string>;
  /** Raw body string after template interpolation (often JSON). */
  body?: string;
  /** HTTP statuses treated as success (default 200–399). */
  successStatuses?: number[];
}

export interface CustomActionSpec {
  id: string;
  label: string;
  description?: string;
  fields?: FieldSchema[];
  request: CustomHttpRequest;
}

export interface CustomTriggerSpec {
  id: string;
  label: string;
  description?: string;
  kind?: "condition" | "data";
  fields?: FieldSchema[];
  request: CustomHttpRequest;
  /**
   * For conditions: fire when this JSON path is truthy (e.g. `ok` or `status`).
   * For data sources: whole JSON response is merged under the integration id.
   */
  fireWhenPath?: string;
}

export interface CustomIntegrationSpec {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  description?: string;
  configFields?: FieldSchema[];
  actions?: CustomActionSpec[];
  triggers?: CustomTriggerSpec[];
  createdAt?: string;
  updatedAt?: string;
}
