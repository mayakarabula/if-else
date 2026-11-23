import { enqueueRuleEvaluation } from "./queue.js";
import {
  isEventRunTrigger,
  listRules,
  loadIntegrationConfig,
  type Rule,
} from "../store/rules.js";

const RECONNECT_MS = 5_000;
const REFRESH_RULES_MS = 30_000;

function toWsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.startsWith("https://")) return `${trimmed.replace(/^https/, "wss")}/api/websocket`;
  if (trimmed.startsWith("http://")) return `${trimmed.replace(/^http/, "ws")}/api/websocket`;
  if (trimmed.startsWith("wss://") || trimmed.startsWith("ws://")) {
    return trimmed.endsWith("/api/websocket") ? trimmed : `${trimmed}/api/websocket`;
  }
  return `ws://${trimmed}/api/websocket`;
}

function matchesHaRule(rule: Rule, eventType: string, entityId: string | undefined): boolean {
  if (!rule.enabled || !isEventRunTrigger(rule.runTrigger)) return false;
  if ((rule.event?.source ?? "webhook") !== "homeassistant") return false;
  const wantedType = String(rule.event?.eventType ?? "state_changed").trim() || "state_changed";
  if (wantedType !== "*" && wantedType !== eventType) return false;
  const wantedEntity = String(rule.event?.entityId ?? "").trim();
  if (wantedEntity && wantedEntity !== entityId) return false;
  return true;
}

let socket: WebSocket | null = null;
let msgId = 1;
let stopped = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

async function activeHaRules(): Promise<Rule[]> {
  const rules = await listRules();
  return rules.filter(
    (rule) =>
      rule.enabled &&
      isEventRunTrigger(rule.runTrigger) &&
      (rule.event?.source ?? "webhook") === "homeassistant",
  );
}

async function connect() {
  if (stopped) return;

  const rules = await activeHaRules();
  if (rules.length === 0) {
    scheduleReconnect();
    return;
  }

  const config = await loadIntegrationConfig();
  const ha = config.homeassistant ?? {};
  const baseUrl = String(ha.baseUrl ?? "").trim();
  const token = String(ha.accessToken ?? "").trim();
  if (!baseUrl || !token) {
    console.warn("HA event listener: homeassistant URL/token not configured");
    scheduleReconnect();
    return;
  }

  const url = toWsUrl(baseUrl);
  console.log(`HA event listener connecting to ${url}`);

  const ws = new WebSocket(url);
  socket = ws;
  let authenticated = false;

  ws.addEventListener("message", (raw) => {
    void (async () => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(raw.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (message.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: token }));
        return;
      }

      if (message.type === "auth_ok") {
        authenticated = true;
        const eventTypes = new Set(
          rules.map((rule) => String(rule.event?.eventType ?? "state_changed").trim() || "state_changed"),
        );
        for (const eventType of eventTypes) {
          const id = msgId++;
          ws.send(
            JSON.stringify(
              eventType === "*"
                ? { id, type: "subscribe_events" }
                : { id, type: "subscribe_events", event_type: eventType },
            ),
          );
        }
        console.log(`HA event listener authenticated (${eventTypes.size} subscription(s))`);
        return;
      }

      if (message.type === "auth_invalid") {
        console.error("HA event listener: auth invalid");
        ws.close();
        return;
      }

      if (!authenticated || message.type !== "event") return;

      const event = message.event as Record<string, unknown> | undefined;
      if (!event) return;
      const eventType = String(event.event_type ?? "");
      const data = (event.data ?? {}) as Record<string, unknown>;
      const entityId =
        typeof data.entity_id === "string"
          ? data.entity_id
          : typeof (data.new_state as { entity_id?: string } | undefined)?.entity_id === "string"
            ? (data.new_state as { entity_id: string }).entity_id
            : undefined;

      const currentRules = await activeHaRules();
      for (const rule of currentRules) {
        if (!matchesHaRule(rule, eventType, entityId)) continue;
        await enqueueRuleEvaluation({
          ruleId: rule.id,
          manual: true,
          eventPayload: {
            source: "homeassistant",
            eventType,
            entityId,
            data,
            timeFired: event.time_fired,
          },
        });
      }
    })().catch((err) => {
      console.error("HA event handler error:", err);
    });
  });

  ws.addEventListener("close", () => {
    if (socket === ws) socket = null;
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((err) => console.error("HA reconnect failed:", err));
  }, RECONNECT_MS);
}

/** Long-lived Home Assistant websocket subscriber for event-driven rules. */
export async function startHomeAssistantEventListener() {
  stopped = false;
  await connect();
  setInterval(() => {
    // Periodically reconnect if rules appear / config changes and we have no socket.
    if (!socket && !reconnectTimer) {
      connect().catch((err) => console.error("HA refresh connect failed:", err));
    }
  }, REFRESH_RULES_MS);
}
