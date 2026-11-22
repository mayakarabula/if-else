import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { enqueueRuleEvaluationAndWait } from "../engine/queue.js";
import { listIntegrationsForApi } from "../integrations/registry.js";
import {
  deleteRule,
  loadIntegrationConfig,
  loadRule,
  loadRuns,
  listRules,
  saveIntegrationConfig,
  saveRule,
  type Rule,
  type RuleRunTrigger,
} from "../store/rules.js";

function normalizeRunFields(body: Partial<Rule>, existing?: Rule): Pick<Rule, "enabled" | "runTrigger" | "webhookToken"> {
  const runTrigger: RuleRunTrigger =
    body.runTrigger === "webhook"
      ? "webhook"
      : body.runTrigger === "timer"
        ? "timer"
        : existing?.runTrigger === "webhook"
          ? "webhook"
          : "timer";

  const enabled = body.enabled ?? existing?.enabled ?? true;
  let webhookToken = body.webhookToken ?? existing?.webhookToken;

  if (enabled && runTrigger === "webhook") {
    webhookToken = webhookToken?.trim() || uuidv4().replace(/-/g, "");
  }

  return {
    enabled,
    runTrigger: enabled ? runTrigger : existing?.runTrigger === "webhook" ? "webhook" : "timer",
    ...(webhookToken ? { webhookToken } : {}),
  };
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

  const rule: Rule = {
    id,
    name: body.name ?? "Untitled rule",
    ...runFields,
    if: body.if!,
    then: body.then!,
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
  const saved = await saveRule({
    ...existing,
    ...body,
    ...runFields,
    id: existing.id,
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

integrationsRouter.get("/", (_req, res) => {
  res.json(listIntegrationsForApi());
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

export const runsRouter = Router();

runsRouter.get("/", async (_req, res) => {
  const runs = await loadRuns();
  res.json(runs);
});

/** Public webhook trigger — no session auth; gated by per-rule secret token. */
export const hooksRouter = Router();

async function handleHook(req: Request, res: Response) {
  const token = String(req.params.token ?? "").trim();
  if (!token) {
    res.status(400).json({ error: "Missing webhook token" });
    return;
  }

  const rules = await listRules();
  const rule = rules.find(
    (item) => item.enabled && item.runTrigger === "webhook" && item.webhookToken === token,
  );

  if (!rule) {
    res.status(404).json({ error: "Webhook not found" });
    return;
  }

  try {
    const run = await enqueueRuleEvaluationAndWait({ ruleId: rule.id, manual: true });
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
