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
import { requireAuth, requireRole } from "../middleware/auth";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

/** Resuelve el slug de institución desde el cuerpo o el header Host. */
function resolveSlug(bodySlug: string | undefined, hostHeader: string | undefined): string {
  if (bodySlug?.trim()) return bodySlug.trim();
  if (hostHeader) {
    if (hostHeader.includes("workers.dev") || hostHeader.includes("localhost")) {
      return "principal";
    }
    const parts = hostHeader.split(".");
    // psi.ais.worke.net → 4 partes → parts[0] = "psi" → slug del cliente
    // ais.worke.net     → 3 partes                    → institución principal
    if (parts.length >= 4) return parts[0].toLowerCase();
  }
  return "principal";
}

/**
 * Bootstrap del usuario admin inicial para una institución.
 * Solo permitido si la institución no tiene usuarios aún.
 */
app.post("/bootstrap", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (
    !body ||
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    typeof body.nombre !== "string" ||
    body.password.length < 8
  ) {
    return c.json({ error: "datos_invalidos", detalle: "email, password (>=8), nombre requeridos" }, 400);
  }
  const slug = resolveSlug(body.slug, c.req.header("Host"));
  const inst = await c.env.DB.prepare(
    `SELECT id, slug FROM institucion WHERE slug = ? AND activa = 1`
  ).bind(slug).first<{ id: number; slug: string }>();
  if (!inst) return c.json({ error: "institucion_no_encontrada", slug }, 404);

  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM usuario WHERE institucion_id = ?`
  ).bind(inst.id).first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return c.json({ error: "ya_inicializado" }, 400);

  const hash = await hashPassword(body.password);
  const ins = await c.env.DB.prepare(
    `INSERT INTO usuario (email, password_hash, nombre, institucion_id) VALUES (?, ?, ?, ?)`
  ).bind(body.email, hash, body.nombre, inst.id).run();
  const usuarioId = ins.meta.last_row_id as number;

  const rolAdmin = await c.env.DB.prepare(`SELECT id FROM rol WHERE codigo = 'admin'`).first<{ id: number }>();
  if (rolAdmin) {
    await c.env.DB.prepare(`INSERT INTO usuario_rol (usuario_id, rol_id, institucion_id) VALUES (?, ?, ?)`)
      .bind(usuarioId, rolAdmin.id, inst.id).run();
  }
  await logAudit(c.env, {
    usuario_id: usuarioId,
    accion: "bootstrap_admin",
    entidad: "usuario",
    entidad_id: usuarioId,
    payload: { email: body.email, slug },
    ip: c.get("ip"),
    institucion_id: inst.id,
  });
  return c.json({ ok: true, usuario_id: usuarioId, institucion_id: inst.id });
});

app.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = LoginInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "datos_invalidos" }, 400);

  const slug = resolveSlug(parsed.data.slug, c.req.header("Host"));
  const inst = await c.env.DB.prepare(
    `SELECT id, slug FROM institucion WHERE slug = ? AND activa = 1`
  ).bind(slug).first<{ id: number; slug: string }>();
  if (!inst) return c.json({ error: "credenciales_invalidas" }, 401);

  const user = await c.env.DB.prepare(
    `SELECT id, email, nombre, password_hash, activo FROM usuario WHERE email = ? AND institucion_id = ?`
  ).bind(parsed.data.email, inst.id).first<{ id: number; email: string; nombre: string; password_hash: string; activo: number }>();
  if (!user || !user.activo) return c.json({ error: "credenciales_invalidas" }, 401);

  const ok = await verifyPassword(parsed.data.password, user.password_hash);
  if (!ok) return c.json({ error: "credenciales_invalidas" }, 401);

  const roles = await c.env.DB.prepare(
    `SELECT r.codigo FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id WHERE ur.usuario_id = ? AND ur.institucion_id = ?`
  ).bind(user.id, inst.id).all<{ codigo: string }>();

  const sid = await createSession(c.env, {
    usuario_id: user.id,
    email: user.email,
    nombre: user.nombre,
    roles: (roles.results ?? []).map((r) => r.codigo),
    institucion_id: inst.id,
    institucion_slug: inst.slug,
  });
  const ttl = parseInt(c.env.SESSION_TTL_SECONDS || "28800", 10);
  c.header("Set-Cookie", buildSessionCookie(sid, ttl, c.env.APP_ENV !== "dev"));
  await logAudit(c.env, {
    usuario_id: user.id,
    accion: "login",
    entidad: "usuario",
    entidad_id: user.id,
    ip: c.get("ip"),
    institucion_id: inst.id,
  });
  return c.json({
    ok: true,
    usuario: { id: user.id, email: user.email, nombre: user.nombre, roles: (roles.results ?? []).map((r) => r.codigo) },
    institucion: { id: inst.id, slug: inst.slug },
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
  return c.json({
    usuario: { id: s.usuario_id, email: s.email, nombre: s.nombre, roles: s.roles },
    institucion: { id: s.institucion_id, slug: s.institucion_slug },
  });
});

/** Gestión de instituciones (solo super_admin). */
app.post("/instituciones", requireRole("super_admin"), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.slug || !body?.nombre) return c.json({ error: "slug y nombre requeridos" }, 400);
  const res = await c.env.DB.prepare(
    `INSERT INTO institucion (slug, nombre, nit) VALUES (?, ?, ?)`
  ).bind(body.slug, body.nombre, body.nit ?? null).run();
  const newInstId = res.meta.last_row_id as number;

  // Sembrar datos base para la nueva institución
  const inst = await c.env.DB.prepare(
    `SELECT * FROM institucion WHERE institucion_id = 1 LIMIT 1`
  ).first();
  void inst; // placeholder — seed se hace por script separado

  return c.json({ ok: true, institucion_id: newInstId, slug: body.slug });
});

app.get("/instituciones", requireRole("super_admin"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, slug, nombre, nit, activa, creado_en FROM institucion ORDER BY id`
  ).all();
  return c.json({ data: results });
});

export default app;
