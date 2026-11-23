import { randomUUID } from "node:crypto";
import type { ChatMutation } from "./types.js";

export type ChatDataEvent = {
  id: string;
  at: string;
  mutations: ChatMutation[];
  ruleId?: string;
  integrationId?: string;
};

const MAX_EVENTS = 80;
const events: ChatDataEvent[] = [];

export function publishChatMutations(
  mutations: ChatMutation[],
  meta?: { ruleId?: string; integrationId?: string },
): ChatDataEvent | null {
  const unique = [...new Set(mutations)];
  if (unique.length === 0) return null;

  const event: ChatDataEvent = {
    id: randomUUID().replace(/-/g, "").slice(0, 12),
    at: new Date().toISOString(),
    mutations: unique,
    ...(meta?.ruleId ? { ruleId: meta.ruleId } : {}),
    ...(meta?.integrationId ? { integrationId: meta.integrationId } : {}),
  };
  events.unshift(event);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  return event;
}

/** Events strictly newer than `since` (ISO timestamp), oldest → newest. */
export function listChatEventsSince(since?: string): ChatDataEvent[] {
  if (!since) return [...events].reverse();
  return [...events].reverse().filter((event) => event.at > since);
}
