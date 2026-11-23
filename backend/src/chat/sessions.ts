import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR } from "../store/rules.js";
import type { ChatMessage, ChatSession, PageContext } from "./types.js";

const SESSIONS_PATH = path.join(CONFIG_DIR, "chat-sessions.json");

type Store = Record<string, ChatSession>;

async function readStore(): Promise<Store> {
  try {
    const raw = await readFile(SESSIONS_PATH, "utf8");
    return JSON.parse(raw) as Store;
  } catch {
    return {};
  }
}

async function writeStore(store: Store) {
  await mkdir(CONFIG_DIR, { recursive: true });
  // Keep the newest 40 sessions to avoid unbounded growth.
  const entries = Object.values(store).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const trimmed: Store = {};
  for (const session of entries.slice(0, 40)) {
    trimmed[session.id] = {
      ...session,
      messages: session.messages.slice(-80),
    };
  }
  await writeFile(SESSIONS_PATH, JSON.stringify(trimmed, null, 2), "utf8");
}

export type ChatSessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  pageLabel?: string;
  provider?: ChatSession["provider"];
};

function sessionTitle(session: ChatSession): string {
  const firstUser = session.messages.find(
    (message) => message.role === "user" && message.content.trim().length > 0,
  );
  const raw = firstUser?.content.trim() || "New chat";
  return raw.length > 72 ? `${raw.slice(0, 69).trimEnd()}…` : raw;
}

export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  const store = await readStore();
  return Object.values(store)
    .filter((session) =>
      session.messages.some(
        (message) =>
          (message.role === "user" || message.role === "assistant") &&
          message.content.trim().length > 0,
      ),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((session) => ({
      id: session.id,
      title: sessionTitle(session),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: publicMessages(session).length,
      ...(session.pageContext?.label ? { pageLabel: session.pageContext.label } : {}),
      ...(session.provider ? { provider: session.provider } : {}),
    }));
}

export async function getChatSession(id: string): Promise<ChatSession | null> {
  const store = await readStore();
  return store[id] ?? null;
}

export async function createChatSession(pageContext?: PageContext): Promise<ChatSession> {
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: randomUUID().replace(/-/g, "").slice(0, 12),
    createdAt: now,
    updatedAt: now,
    pageContext,
    messages: [],
  };
  const store = await readStore();
  store[session.id] = session;
  await writeStore(store);
  return session;
}

export async function saveChatSession(session: ChatSession): Promise<ChatSession> {
  const store = await readStore();
  const next = { ...session, updatedAt: new Date().toISOString() };
  store[next.id] = next;
  await writeStore(store);
  return next;
}

export async function clearChatSession(id: string): Promise<void> {
  const store = await readStore();
  delete store[id];
  await writeStore(store);
}

export function newMessage(
  role: ChatMessage["role"],
  content: string,
  extras?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id: randomUUID().replace(/-/g, "").slice(0, 10),
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extras,
  };
}

/** Messages safe to show in the UI (hide raw tool-call plumbing). */
export function publicMessages(session: ChatSession): ChatMessage[] {
  return session.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => message.role !== "assistant" || message.content.trim().length > 0)
    .map(({ id, role, content, createdAt, toolName }) => ({
      id,
      role,
      content,
      createdAt,
      ...(toolName ? { toolName } : {}),
    }));
}
