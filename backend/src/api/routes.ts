import { Router } from "express";
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
} from "../store/rules.js";

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

  const rule: Rule = {
    id,
    name: body.name ?? "Untitled rule",
    enabled: body.enabled ?? true,
    if: body.if!,
    then: body.then!,
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
  const saved = await saveRule({
    ...existing,
    ...body,
    id: existing.id,
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
