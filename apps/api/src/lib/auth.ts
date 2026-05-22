import { argon2id, argon2Verify } from "hash-wasm";
import type { Bindings, SessionData } from "../env";

const ARGON_PARAMS = {
  parallelism: 1,
  iterations: 2,
  memorySize: 19456, // 19 MiB - razonable para Workers
  hashLength: 32,
  outputType: "encoded" as const,
};

function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    ...ARGON_PARAMS,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}

export function newSessionId(): string {
  const bytes = randomBytes(32);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(
  env: Bindings,
  data: Omit<SessionData, "created_at">
): Promise<string> {
  const sid = newSessionId();
  const ttl = parseInt(env.SESSION_TTL_SECONDS || "28800", 10);
  const payload: SessionData = { ...data, created_at: Date.now() };
  await env.SESSIONS.put(`sid:${sid}`, JSON.stringify(payload), {
    expirationTtl: ttl,
  });
  return sid;
}

export async function readSession(env: Bindings, sid: string | null): Promise<SessionData | null> {
  if (!sid) return null;
  const raw = await env.SESSIONS.get(`sid:${sid}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export async function destroySession(env: Bindings, sid: string): Promise<void> {
  await env.SESSIONS.delete(`sid:${sid}`);
}

export function getSidFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)sid=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function buildSessionCookie(sid: string, ttlSeconds: number, secure: boolean): string {
  const attrs = [
    `sid=${sid}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${ttlSeconds}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const attrs = ["sid=", "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}
