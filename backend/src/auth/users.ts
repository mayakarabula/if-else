import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { CONFIG_DIR, ensureDirs } from "../store/rules.js";

export const USERS_PATH = path.join(CONFIG_DIR, "users.json");

const BCRYPT_ROUNDS = 12;

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash?: string;
  picture?: string;
  createdAt: string;
  updatedAt: string;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function emailLocalPart(email: string) {
  return email.split("@")[0] || email;
}

async function loadUsers(): Promise<User[]> {
  await ensureDirs();
  try {
    const raw = await readFile(USERS_PATH, "utf8");
    return JSON.parse(raw) as User[];
  } catch {
    return [];
  }
}

async function saveUsers(users: User[]) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(USERS_PATH, JSON.stringify(users, null, 2), "utf8");
}

export async function findUserById(id: string): Promise<User | null> {
  const users = await loadUsers();
  return users.find((user) => user.id === id) ?? null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const normalized = normalizeEmail(email);
  const users = await loadUsers();
  return users.find((user) => user.email === normalized) ?? null;
}

export async function createLocalUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<User> {
  const email = normalizeEmail(input.email);
  const existing = await findUserByEmail(email);
  if (existing) {
    throw new Error("An account with this email already exists");
  }

  const now = new Date().toISOString();
  const user: User = {
    id: randomUUID(),
    email,
    name: input.name?.trim() || emailLocalPart(email),
    passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    createdAt: now,
    updatedAt: now,
  };

  const users = await loadUsers();
  users.push(user);
  await saveUsers(users);
  return user;
}

export async function verifyLocalPassword(user: User, password: string): Promise<boolean> {
  if (!user.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
}

export function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
  };
}
