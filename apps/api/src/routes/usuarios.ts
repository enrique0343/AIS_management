import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole } from "../middleware/auth";
import { hashPassword } from "../lib/auth";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth, requireRole("admin"));

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.nombre, u.activo, u.creado_en,
            GROUP_CONCAT(r.codigo) AS roles
       FROM usuario u
       LEFT JOIN usuario_rol ur ON ur.usuario_id = u.id
       LEFT JOIN rol r ON r.id = ur.rol_id
      GROUP BY u.id
      ORDER BY u.nombre`
  ).all();
  return c.json({ data: results });
});

app.post("/", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.email || !b?.password || !b?.nombre || b.password.length < 8) {
    return c.json({ error: "datos_invalidos" }, 400);
  }
  const hash = await hashPassword(b.password);
  const r = await c.env.DB.prepare(
    `INSERT INTO usuario (email, password_hash, nombre) VALUES (?, ?, ?)`
  )
    .bind(b.email, hash, b.nombre)
    .run();
  const usuarioId = r.meta.last_row_id as number;
  if (Array.isArray(b.roles)) {
    for (const codigo of b.roles) {
      const rol = await c.env.DB.prepare(`SELECT id FROM rol WHERE codigo = ?`).bind(codigo).first<{ id: number }>();
      if (rol) {
        await c.env.DB.prepare(`INSERT INTO usuario_rol (usuario_id, rol_id) VALUES (?, ?)`)
          .bind(usuarioId, rol.id)
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
  });
  return c.json({ id: usuarioId });
});

app.post("/:id/roles", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => null);
  if (!Array.isArray(b?.roles)) return c.json({ error: "roles_requeridos" }, 400);
  await c.env.DB.prepare(`DELETE FROM usuario_rol WHERE usuario_id = ?`).bind(id).run();
  for (const codigo of b.roles) {
    const rol = await c.env.DB.prepare(`SELECT id FROM rol WHERE codigo = ?`).bind(codigo).first<{ id: number }>();
    if (rol) {
      await c.env.DB.prepare(`INSERT INTO usuario_rol (usuario_id, rol_id) VALUES (?, ?)`)
        .bind(id, rol.id)
        .run();
    }
  }
  return c.json({ ok: true });
});

app.post("/:id/desactivar", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await c.env.DB.prepare(`UPDATE usuario SET activo = 0 WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

app.get("/roles", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, codigo, nombre FROM rol ORDER BY nombre`).all();
  return c.json({ data: results });
});

export default app;
