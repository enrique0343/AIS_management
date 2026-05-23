import type { Bindings, SessionData } from "../env";

// PBKDF2 con WebCrypto nativo (Cloudflare Workers no permite WASM dinamico).
// Formato del hash: "pbkdf2$<iterations>$<salt_hex>$<derived_hex>".
const PBKDF2_ITERATIONS = 100000;

function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const km = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    km,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(derived)}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const parts = hash.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iter = parseInt(parts[1], 10);
    const salt = fromHex(parts[2]);
    const expected = fromHex(parts[3]);
    const got = await deriveKey(password, salt, iter);
    if (got.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
    return diff === 0;
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
