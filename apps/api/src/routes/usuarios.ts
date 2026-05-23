import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole, getInstId } from "../middleware/auth";
import { hashPassword } from "../lib/auth";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth, requireRole("admin"));

app.get("/", async (c) => {
  const instId = getInstId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.nombre, u.activo, u.creado_en,
            GROUP_CONCAT(r.codigo) AS roles
       FROM usuario u
       LEFT JOIN usuario_rol ur ON ur.usuario_id = u.id AND ur.institucion_id = ?
       LEFT JOIN rol r ON r.id = ur.rol_id
      WHERE u.institucion_id = ?
      GROUP BY u.id
      ORDER BY u.nombre`
  ).bind(instId, instId).all();
  return c.json({ data: results });
});

app.post("/", async (c) => {
  const instId = getInstId(c);
  const b = await c.req.json().catch(() => null);
  if (!b?.email || !b?.password || !b?.nombre || b.password.length < 8) {
    return c.json({ error: "datos_invalidos" }, 400);
  }
  const hash = await hashPassword(b.password);
  const r = await c.env.DB.prepare(
    `INSERT INTO usuario (email, password_hash, nombre, institucion_id) VALUES (?, ?, ?, ?)`
  )
    .bind(b.email, hash, b.nombre, instId)
    .run();
  const usuarioId = r.meta.last_row_id as number;
  if (Array.isArray(b.roles)) {
    for (const codigo of b.roles) {
      const rol = await c.env.DB.prepare(`SELECT id FROM rol WHERE codigo = ?`).bind(codigo).first<{ id: number }>();
      if (rol) {
        await c.env.DB.prepare(`INSERT INTO usuario_rol (usuario_id, rol_id, institucion_id) VALUES (?, ?, ?)`)
          .bind(usuarioId, rol.id, instId)
          .run();
      }
    }
  }
  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "crear_usuario",
    entidad: "usuario",
    entidad_id: usuarioId,
    payload: { email: b.email, roles: b.roles ?? [] },
    ip: c.get("ip"),
    institucion_id: instId,
  });
  return c.json({ id: usuarioId });
});

app.post("/:id/roles", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => null);
  if (!Array.isArray(b?.roles)) return c.json({ error: "roles_requeridos" }, 400);
  await c.env.DB.prepare(`DELETE FROM usuario_rol WHERE usuario_id = ? AND institucion_id = ?`).bind(id, instId).run();
  for (const codigo of b.roles) {
    const rol = await c.env.DB.prepare(`SELECT id FROM rol WHERE codigo = ?`).bind(codigo).first<{ id: number }>();
    if (rol) {
      await c.env.DB.prepare(`INSERT INTO usuario_rol (usuario_id, rol_id, institucion_id) VALUES (?, ?, ?)`)
        .bind(id, rol.id, instId)
        .run();
    }
  }
  return c.json({ ok: true });
});

app.post("/:id/desactivar", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  await c.env.DB.prepare(`UPDATE usuario SET activo = 0 WHERE id = ? AND institucion_id = ?`).bind(id, instId).run();
  await logAudit(c.env, { usuario_id: c.get("session")!.usuario_id, accion: "desactivar_usuario", entidad: "usuario", entidad_id: id, ip: c.get("ip"), institucion_id: instId });
  return c.json({ ok: true });
});

app.post("/:id/activar", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  await c.env.DB.prepare(`UPDATE usuario SET activo = 1 WHERE id = ? AND institucion_id = ?`).bind(id, instId).run();
  await logAudit(c.env, { usuario_id: c.get("session")!.usuario_id, accion: "activar_usuario", entidad: "usuario", entidad_id: id, ip: c.get("ip"), institucion_id: instId });
  return c.json({ ok: true });
});

app.post("/:id/reset-password", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => null);
  if (!b?.password || b.password.length < 8) return c.json({ error: "password_minimo_8" }, 400);
  const hash = await hashPassword(b.password);
  await c.env.DB.prepare(`UPDATE usuario SET password_hash = ? WHERE id = ? AND institucion_id = ?`).bind(hash, id, instId).run();
  await logAudit(c.env, { usuario_id: c.get("session")!.usuario_id, accion: "reset_password", entidad: "usuario", entidad_id: id, ip: c.get("ip"), institucion_id: instId });
  return c.json({ ok: true });
});

app.get("/auditoria", async (c) => {
  const instId = getInstId(c);
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const accion = c.req.query("accion");
  const usuarioId = c.req.query("usuario_id");
  const filt: string[] = ["a.institucion_id = ?"];
  const binds: unknown[] = [instId];
  if (desde) { filt.push("date(a.fecha) >= ?"); binds.push(desde); }
  if (hasta) { filt.push("date(a.fecha) <= ?"); binds.push(hasta); }
  if (accion) { filt.push("a.accion = ?"); binds.push(accion); }
  if (usuarioId) { filt.push("a.usuario_id = ?"); binds.push(parseInt(usuarioId, 10)); }
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.fecha, a.accion, a.entidad, a.entidad_id, a.payload, a.ip,
            u.id AS usuario_id, u.email AS usuario
       FROM audit_log a
       LEFT JOIN usuario u ON u.id = a.usuario_id
      WHERE ${filt.join(" AND ")}
      ORDER BY a.fecha DESC
      LIMIT 500`
  )
    .bind(...binds)
    .all();
  return c.json({ data: results });
});

app.get("/auditoria/acciones", async (c) => {
  const instId = getInstId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT accion FROM audit_log WHERE institucion_id = ? ORDER BY accion`
  ).bind(instId).all<{ accion: string }>();
  return c.json({ data: results.map((r) => r.accion) });
});

app.get("/roles", async (c) => {
  // rol is global — no institucion_id filter
  const { results } = await c.env.DB.prepare(`SELECT id, codigo, nombre FROM rol ORDER BY nombre`).all();
  return c.json({ data: results });
});

export default app;
