import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { enqueueRuleEvaluationAndWait } from "../engine/queue.js";
import { listIntegrationsForApi, reloadCustomIntegrations } from "../integrations/registry.js";
import { serviceUpdateCustomIntegrationMeta } from "../tools/rulesService.js";
import {
  deleteRule,
  isEventRunTrigger,
  loadIntegrationConfig,
  loadRule,
  loadRuns,
  listRules,
  ruleActionBlock,
  saveIntegrationConfig,
  saveRule,
  type Rule,
  type RuleEvent,
  type RuleRunTrigger,
  type RuleThen,
} from "../store/rules.js";

function normalizeEvent(
  body: Partial<Rule>,
  existing: Rule | undefined,
  runTrigger: RuleRunTrigger | undefined,
): RuleEvent | undefined {
  if (runTrigger !== "event") return undefined;
  const raw = body.event ?? existing?.event;
  const source = raw?.source === "homeassistant" ? "homeassistant" : "webhook";
  if (source === "homeassistant") {
    return {
      source,
      eventType: String(raw?.eventType ?? "state_changed").trim() || "state_changed",
      ...(raw?.entityId?.trim() ? { entityId: raw.entityId.trim() } : {}),
    };
  }
  return { source: "webhook" };
}

function normalizeRunFields(
  body: Partial<Rule>,
  existing?: Rule,
): Pick<Rule, "enabled" | "runTrigger" | "webhookToken" | "event"> {
  const runTrigger: RuleRunTrigger = isEventRunTrigger(body.runTrigger)
    ? "event"
    : body.runTrigger === "timer"
      ? "timer"
      : isEventRunTrigger(existing?.runTrigger)
        ? "event"
        : "timer";

  const enabled = body.enabled ?? existing?.enabled ?? true;
  let webhookToken = body.webhookToken ?? existing?.webhookToken;
  const event = normalizeEvent(body, existing, enabled ? runTrigger : undefined);

  if (enabled && runTrigger === "event" && (event?.source ?? "webhook") === "webhook") {
    webhookToken = webhookToken?.trim() || uuidv4().replace(/-/g, "");
  }

  return {
    enabled,
    runTrigger: enabled ? runTrigger : isEventRunTrigger(existing?.runTrigger) ? "event" : "timer",
    ...(webhookToken ? { webhookToken } : {}),
    ...(event ? { event } : {}),
  };
}

function resolveActionBlock(body: Partial<Rule>, existing?: Rule): RuleThen | undefined {
  return ruleActionBlock(body) ?? (existing ? ruleActionBlock(existing) : undefined);
}

export const rulesRouter = Router();

rulesRouter.get("/", async (_req, res) => {
  const rules = await listRules();
  res.json(rules);
});

rulesRouter.get("/:id", async (req, res) => {
  const rule = await loadRule(req.params.id);
  if (!rule) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  res.json(rule);
});

rulesRouter.post("/", async (req, res) => {
  const body = req.body as Partial<Rule>;
  const id = body.id ?? uuidv4().slice(0, 8);
  const runFields = normalizeRunFields(body);
  const action = resolveActionBlock(body);
  if (!action) {
    res.status(400).json({ error: "Rule requires an `action` (or legacy `then`) block" });
    return;
  }

  const rule: Rule = {
    id,
    name: body.name ?? "Untitled rule",
    ...runFields,
    if: body.if!,
    action,
    ...(Array.isArray(body.filters) ? { filters: body.filters } : {}),
    ...(body.else ? { else: body.else } : {}),
    ...(body.catch ? { catch: body.catch } : {}),
  };

  const saved = await saveRule(rule);
  res.status(201).json(saved);
});

rulesRouter.put("/:id", async (req, res) => {
  const existing = await loadRule(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

  const body = req.body as Partial<Rule>;
  const runFields = normalizeRunFields(body, existing);
  const action = resolveActionBlock(body, existing);
  const saved = await saveRule({
    ...existing,
    ...body,
    ...runFields,
    id: existing.id,
    action,
    then: undefined,
    filters: Object.prototype.hasOwnProperty.call(body, "filters") ? body.filters : existing.filters,
    // Allow clearing else/catch when the client omits them.
    else: body.else,
    catch: body.catch,
  });
  res.json(saved);
});

rulesRouter.patch("/:id/toggle", async (req, res) => {
  const existing = await loadRule(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

  const saved = await saveRule({ ...existing, enabled: !existing.enabled });
  res.json(saved);
});

rulesRouter.post("/:id/run", async (req, res) => {
  const rule = await loadRule(req.params.id);
  if (!rule) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

  try {
    const run = await enqueueRuleEvaluationAndWait({ ruleId: rule.id, manual: true });
    res.json(run);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to run rule",
    });
  }
});

rulesRouter.delete("/:id", async (req, res) => {
  const existing = await loadRule(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

  await deleteRule(req.params.id);
  res.status(204).send();
});

export const integrationsRouter = Router();

integrationsRouter.get("/", async (_req, res) => {
  await reloadCustomIntegrations();
  const config = await loadIntegrationConfig();
  // Built-in display overrides live in integrations.yaml (displayName / icon / color).
  const list = listIntegrationsForApi().map((item) => {
    const overlay = config[item.id] ?? {};
    const displayName = String(overlay.displayName ?? "").trim();
    const icon = String(overlay.icon ?? "").trim();
    const color = String(overlay.color ?? "").trim();
    return {
      ...item,
      ...(displayName && !item.custom ? { name: displayName } : {}),
      ...(icon && !item.custom ? { icon } : {}),
      ...(color && !item.custom ? { color } : {}),
    };
  });
  res.json(list);
});

integrationsRouter.get("/config", async (_req, res) => {
  const config = await loadIntegrationConfig();
  res.json(config);
});

integrationsRouter.put("/config", async (req, res) => {
  const config = req.body as Record<string, Record<string, unknown>>;
  await saveIntegrationConfig(config);
  res.json(config);
});

integrationsRouter.patch("/custom/:id", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const saved = await serviceUpdateCustomIntegrationMeta(req.params.id, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.icon === "string" ? { icon: body.icon } : {}),
      ...(typeof body.color === "string" ? { color: body.color } : {}),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
    });
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Update failed" });
  }
});

export const runsRouter = Router();

runsRouter.get("/", async (_req, res) => {
  const runs = await loadRuns();
  res.json(runs);
});

/** Public event webhook — no session auth; gated by per-rule secret token. */
export const hooksRouter = Router();

async function handleHook(req: Request, res: Response) {
  const token = String(req.params.token ?? "").trim();
  if (!token) {
    res.status(400).json({ error: "Missing webhook token" });
    return;
  }

  const rules = await listRules();
  const rule = rules.find(
    (item) =>
      item.enabled &&
      isEventRunTrigger(item.runTrigger) &&
      (item.event?.source ?? "webhook") === "webhook" &&
      item.webhookToken === token,
  );

  if (!rule) {
    res.status(404).json({ error: "Event webhook not found" });
    return;
  }

  const payload =
    req.method === "GET"
      ? { query: req.query }
      : { body: req.body, query: req.query };

  try {
    const run = await enqueueRuleEvaluationAndWait({
      ruleId: rule.id,
      manual: true,
      eventPayload: {
        source: "webhook",
        method: req.method,
        ...payload,
      },
    });
    res.json({ ok: true, ruleId: rule.id, run });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to run rule",
    });
  }
}

hooksRouter.post("/:token", async (req, res) => {
  await handleHook(req, res);
});

hooksRouter.get("/:token", async (req, res) => {
  await handleHook(req, res);
});
