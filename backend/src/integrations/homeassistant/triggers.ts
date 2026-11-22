import type { TriggerDefinition } from "../types.js";
import { getEntityState, requireHaConfig } from "./client.js";

const COMMON_ERROR_CALLBACK = [
  { path: "message", label: "Error message" },
  { path: "code", label: "Error code" },
  { path: "integration", label: "Integration id" },
  { path: "step", label: "Step id" },
  { path: "stepLabel", label: "Step label" },
  { path: "kind", label: "Step kind", description: "trigger or action" },
  { path: "plan", label: "Action plan", description: "Planned steps joined with →" },
];

const HA_ERROR_CALLBACK = [
  ...COMMON_ERROR_CALLBACK,
  { path: "entityId", label: "Entity ID" },
  { path: "baseUrl", label: "Home Assistant URL" },
];

const entityField = {
  key: "entityId",
  label: "Entity ID",
  type: "text" as const,
  required: true,
  placeholder: "light.living_room",
};

export const fetchEntityState: TriggerDefinition = {
  id: "fetch_entity_state",
  label: "Fetch entity state",
  description: "Loads a Home Assistant entity into templates. Does not block the rule on its own.",
  kind: "data",
  actionPlan: [
    "Load Home Assistant URL and access token",
    "GET /api/states/<entity_id>",
    "Expose state and common attributes for templates",
  ],
  errorCallback: HA_ERROR_CALLBACK,
  fields: [entityField],
  outputs: [
    { path: "entityId", label: "Entity ID" },
    { path: "state", label: "State" },
    { path: "friendlyName", label: "Friendly name" },
    { path: "attributes", label: "Attributes (JSON)" },
  ],
  async evaluate(config, context) {
    const ha = requireHaConfig(context.integrationConfig, fetchEntityState, "trigger");
    const entityId = String(config.entityId ?? "");
    const entity = await getEntityState(ha, entityId, fetchEntityState, "trigger");
    return {
      fired: true,
      data: {
        entityId: entity.entity_id,
        state: entity.state,
        friendlyName: String(entity.attributes.friendly_name ?? entity.entity_id),
        attributes: JSON.stringify(entity.attributes),
        ...flattenAttrs(entity.attributes),
      },
    };
  },
};

export const entityStateIs: TriggerDefinition = {
  id: "entity_state_is",
  label: "Entity state is",
  description: "Fires when a Home Assistant entity state matches the expected value.",
  actionPlan: [
    "Load Home Assistant URL and access token",
    "Read the entity state from the REST API",
    "Compare against the expected value and apply mode",
  ],
  errorCallback: [
    ...HA_ERROR_CALLBACK,
    { path: "expected", label: "Expected state" },
    { path: "state", label: "Current state" },
  ],
  fields: [
    entityField,
    {
      key: "expected",
      label: "Expected state",
      type: "text",
      required: true,
      placeholder: "on",
      default: "on",
    },
    {
      key: "mode",
      label: "When",
      type: "select",
      required: true,
      default: "matches",
      options: [
        { value: "matches", label: "While the state matches" },
        { value: "becomes", label: "When the state becomes this value" },
        { value: "leaves", label: "When the state leaves this value" },
      ],
    },
  ],
  outputs: [
    { path: "entityId", label: "Entity ID" },
    { path: "state", label: "Current state" },
    { path: "expected", label: "Expected state" },
    { path: "friendlyName", label: "Friendly name" },
    { path: "matched", label: "Matched" },
  ],
  async evaluate(config, context) {
    const ha = requireHaConfig(context.integrationConfig, entityStateIs, "trigger");
    const entityId = String(config.entityId ?? "");
    const expected = String(config.expected ?? "").trim().toLowerCase();
    const mode = String(config.mode ?? "matches");
    const entity = await getEntityState(ha, entityId, entityStateIs, "trigger");
    const state = String(entity.state ?? "");
    const matched = state.toLowerCase() === expected;
    const previous = context.lastState?.matched;
    const data = {
      entityId: entity.entity_id,
      state,
      expected,
      matched,
      mode,
      friendlyName: String(entity.attributes.friendly_name ?? entity.entity_id),
    };

    if (context.manual) {
      return {
        fired: mode === "leaves" ? !matched : matched,
        data,
        state: { matched },
      };
    }

    if ((mode === "becomes" || mode === "leaves") && previous === undefined) {
      return { fired: false, data, state: { matched } };
    }

    let fired = false;
    if (mode === "matches") fired = matched;
    else if (mode === "becomes") fired = matched && previous === false;
    else if (mode === "leaves") fired = !matched && previous === true;

    return { fired, data, state: { matched } };
  },
};

function flattenAttrs(attributes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}
