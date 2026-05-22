import { Hono } from "hono";
import { LoginInput } from "@ais/shared";
import type { Bindings, AppVariables } from "../env";
import {
  buildSessionCookie,
  clearSessionCookie,
  createSession,
  destroySession,
  getSidFromCookie,
  hashPassword,
  verifyPassword,
} from "../lib/auth";
import { logAudit } from "../lib/audit";
import { requireAuth } from "../middleware/auth";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

/**
 * Bootstrap del usuario admin inicial. Solo permitido si no hay usuarios.
 * No requiere auth (es la unica via para crear el primer admin).
 */
app.post("/bootstrap", async (c) => {
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM usuario`).first<{ n: number }>();
  if ((count?.n ?? 0) > 0) {
    return c.json({ error: "ya_inicializado" }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = LoginInput.extend({ nombre: (LoginInput as any).shape.email.constructor }).safeParse(
    body
  );
  // Validacion manual mas simple:
  if (
    !body ||
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    typeof body.nombre !== "string" ||
    body.password.length < 8
  ) {
    return c.json({ error: "datos_invalidos", detalle: "email, password (>=8), nombre requeridos" }, 400);
  }
  const hash = await hashPassword(body.password);
  const ins = await c.env.DB.prepare(
    `INSERT INTO usuario (email, password_hash, nombre) VALUES (?, ?, ?)`
  )
    .bind(body.email, hash, body.nombre)
    .run();
  const usuarioId = ins.meta.last_row_id as number;
  // Asignar rol admin
  const rolAdmin = await c.env.DB.prepare(`SELECT id FROM rol WHERE codigo = 'admin'`).first<{
    id: number;
  }>();
  if (rolAdmin) {
    await c.env.DB.prepare(`INSERT INTO usuario_rol (usuario_id, rol_id) VALUES (?, ?)`)
      .bind(usuarioId, rolAdmin.id)
      .run();
  }
  await logAudit(c.env, {
    usuario_id: usuarioId,
    accion: "bootstrap_admin",
    entidad: "usuario",
    entidad_id: usuarioId,
    payload: { email: body.email },
    ip: c.get("ip"),
  });
  return c.json({ ok: true, usuario_id: usuarioId });
});

app.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = LoginInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "datos_invalidos" }, 400);

  const user = await c.env.DB.prepare(
    `SELECT id, email, nombre, password_hash, activo FROM usuario WHERE email = ?`
  )
    .bind(parsed.data.email)
    .first<{ id: number; email: string; nombre: string; password_hash: string; activo: number }>();
  if (!user || !user.activo) return c.json({ error: "credenciales_invalidas" }, 401);

  const ok = await verifyPassword(parsed.data.password, user.password_hash);
  if (!ok) return c.json({ error: "credenciales_invalidas" }, 401);

  const roles = await c.env.DB.prepare(
    `SELECT r.codigo FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id WHERE ur.usuario_id = ?`
  )
    .bind(user.id)
    .all<{ codigo: string }>();

  const sid = await createSession(c.env, {
    usuario_id: user.id,
    email: user.email,
    nombre: user.nombre,
    roles: (roles.results ?? []).map((r) => r.codigo),
  });
  const ttl = parseInt(c.env.SESSION_TTL_SECONDS || "28800", 10);
  c.header(
    "Set-Cookie",
    buildSessionCookie(sid, ttl, c.env.APP_ENV !== "dev")
  );
  await logAudit(c.env, {
    usuario_id: user.id,
    accion: "login",
    entidad: "usuario",
    entidad_id: user.id,
    ip: c.get("ip"),
  });
  return c.json({
    ok: true,
    usuario: { id: user.id, email: user.email, nombre: user.nombre, roles: (roles.results ?? []).map((r) => r.codigo) },
  });
});

app.post("/logout", requireAuth, async (c) => {
  const sid = getSidFromCookie(c.req.header("Cookie") ?? null);
  if (sid) await destroySession(c.env, sid);
  c.header("Set-Cookie", clearSessionCookie(c.env.APP_ENV !== "dev"));
  return c.json({ ok: true });
});

app.get("/me", requireAuth, async (c) => {
  const s = c.get("session")!;
  return c.json({ usuario: { id: s.usuario_id, email: s.email, nombre: s.nombre, roles: s.roles } });
});

export default app;
