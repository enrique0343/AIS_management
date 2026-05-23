import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole, getInstId } from "../middleware/auth";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

// === Medicos ===
app.get("/medicos", async (c) => {
  const instId = getInstId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, usuario_id, nombres, apellidos, jvpm, especialidad, activo
       FROM profesional_medico WHERE institucion_id = ? ORDER BY apellidos, nombres`
  ).bind(instId).all();
  return c.json({ data: results });
});

app.post("/medicos", requireRole("admin"), async (c) => {
  const instId = getInstId(c);
  const b = await c.req.json().catch(() => null);
  if (!b?.nombres || !b?.apellidos) return c.json({ error: "datos_invalidos" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO profesional_medico (usuario_id, nombres, apellidos, jvpm, especialidad, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(b.usuario_id ?? null, b.nombres, b.apellidos, b.jvpm ?? null, b.especialidad ?? null, instId)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

// === Enfermeria ===
app.get("/enfermeria", async (c) => {
  const instId = getInstId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, usuario_id, nombres, apellidos, registro, nivel, activo
       FROM profesional_enfermeria WHERE institucion_id = ? ORDER BY apellidos, nombres`
  ).bind(instId).all();
  return c.json({ data: results });
});

app.post("/enfermeria", requireRole("admin"), async (c) => {
  const instId = getInstId(c);
  const b = await c.req.json().catch(() => null);
  if (!b?.nombres || !b?.apellidos) return c.json({ error: "datos_invalidos" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO profesional_enfermeria (usuario_id, nombres, apellidos, registro, nivel, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(b.usuario_id ?? null, b.nombres, b.apellidos, b.registro ?? null, b.nivel ?? null, instId)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

// === Administrativos ===
app.get("/administrativos", async (c) => {
  const instId = getInstId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT pa.id, pa.usuario_id, u.nombre, u.email, pa.cargo, pa.area_id, a.nombre AS area, pa.activo
       FROM personal_administrativo pa
       LEFT JOIN usuario u ON u.id = pa.usuario_id AND u.institucion_id = ?
       LEFT JOIN area a ON a.id = pa.area_id AND a.institucion_id = ?
      WHERE pa.institucion_id = ?
      ORDER BY u.nombre`
  ).bind(instId, instId, instId).all();
  return c.json({ data: results });
});

app.post("/administrativos", requireRole("admin"), async (c) => {
  const instId = getInstId(c);
  const b = await c.req.json().catch(() => null);
  if (!b?.usuario_id || !b?.cargo) return c.json({ error: "datos_invalidos" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO personal_administrativo (usuario_id, cargo, area_id, institucion_id) VALUES (?, ?, ?, ?)`
  )
    .bind(b.usuario_id, b.cargo, b.area_id ?? null, instId)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

export default app;
