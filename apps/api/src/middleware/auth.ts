import type { MiddlewareHandler } from "hono";
import type { Bindings, AppVariables } from "../env";
import { getSidFromCookie, readSession } from "../lib/auth";

export const sessionMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AppVariables;
}> = async (c, next) => {
  const sid = getSidFromCookie(c.req.header("Cookie") ?? null);
  const session = await readSession(c.env, sid);
  c.set("session", session);
  c.set(
    "ip",
    c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? ""
  );
  await next();
};

export const requireAuth: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AppVariables;
}> = async (c, next) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "no_autenticado" }, 401);
  await next();
};

export function requireRole(...roles: string[]): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AppVariables;
}> {
  return async (c, next) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "no_autenticado" }, 401);
    const ok = session.roles.some((r) => roles.includes(r) || r === "admin");
    if (!ok) return c.json({ error: "sin_permiso", requeridos: roles }, 403);
    await next();
  };
}
