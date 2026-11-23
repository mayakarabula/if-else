import { Router } from "express";
import { chatConfigured, runChatTurn } from "../chat/agent.js";
import { clearChatSession, getChatSession, publicMessages } from "../chat/sessions.js";
import type { PageContext } from "../chat/types.js";

function parsePageContext(value: unknown): PageContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const pathValue = String(raw.path ?? "").trim();
  if (!pathValue) return undefined;

  const pageRaw = String(raw.page ?? "other");
  const page: PageContext["page"] =
    pageRaw === "rules" ||
    pageRaw === "create" ||
    pageRaw === "edit" ||
    pageRaw === "integrations" ||
    pageRaw === "activity"
      ? pageRaw
      : "other";

  return {
    path: pathValue,
    page,
    ...(typeof raw.ruleId === "string" && raw.ruleId.trim()
      ? { ruleId: raw.ruleId.trim() }
      : {}),
    ...(typeof raw.label === "string" && raw.label.trim() ? { label: raw.label.trim() } : {}),
  };
}

export const chatRouter = Router();

chatRouter.get("/status", (_req, res) => {
  res.json({ configured: chatConfigured() });
});

chatRouter.get("/:id", async (req, res) => {
  const session = await getChatSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Chat session not found" });
    return;
  }
  res.json({
    sessionId: session.id,
    messages: publicMessages(session),
    pageContext: session.pageContext,
    configured: chatConfigured(),
  });
});

chatRouter.delete("/:id", async (req, res) => {
  await clearChatSession(req.params.id);
  res.status(204).send();
});

chatRouter.post("/", async (req, res) => {
  try {
    if (!chatConfigured()) {
      res.status(503).json({
        error:
          "Chat is not configured. Set CHAT_API_KEY (OpenAI-compatible) on the backend, optional CHAT_BASE_URL and CHAT_MODEL.",
      });
      return;
    }

    const message = String(req.body?.message ?? "");
    const sessionId =
      typeof req.body?.sessionId === "string" && req.body.sessionId.trim()
        ? req.body.sessionId.trim()
        : undefined;
    const pageContext = parsePageContext(req.body?.pageContext);

    const result = await runChatTurn({ sessionId, message, pageContext });
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Chat failed",
    });
  }
});
