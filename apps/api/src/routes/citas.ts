import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole, getInstId } from "../middleware/auth";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

// ──────────────── AGENDA (disponibilidad) ────────────────

app.get("/agenda", async (c) => {
  const instId = getInstId(c);
  const profId = c.req.query("profesional_id");
  let q = `SELECT ag.*, p.nombres || ' ' || p.apellidos AS profesional_nombre
             FROM agenda_medico ag
             JOIN profesional p ON p.id = ag.profesional_id
            WHERE ag.institucion_id = ? AND ag.activo = 1`;
  const binds: unknown[] = [instId];
  if (profId) { q += " AND ag.profesional_id = ?"; binds.push(parseInt(profId)); }
  q += " ORDER BY ag.profesional_id, ag.dia_semana, ag.hora_inicio";
  const rows = await c.env.DB.prepare(q).bind(...binds).all();
  return c.json(rows.results ?? []);
});

app.post("/agenda", requireRole("admin", "programador_quirofano"), async (c) => {
  const instId = getInstId(c);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!b.profesional_id || b.dia_semana === undefined || !b.hora_inicio || !b.hora_fin) {
    return c.json({ error: "campos_requeridos" }, 400);
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO agenda_medico (profesional_id, dia_semana, hora_inicio, hora_fin, duracion_cita, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(b.profesional_id, b.dia_semana, b.hora_inicio, b.hora_fin, b.duracion_cita ?? 30, instId).run();
  return c.json({ id: r.meta.last_row_id });
});

app.delete("/agenda/:id", requireRole("admin", "programador_quirofano"), async (c) => {
  const instId = getInstId(c);
  await c.env.DB.prepare("UPDATE agenda_medico SET activo = 0 WHERE id = ? AND institucion_id = ?")
    .bind(parseInt(c.req.param("id")), instId).run();
  return c.json({ ok: true });
});

// ──────────────── CITAS ────────────────

app.get("/", async (c) => {
  const instId = getInstId(c);
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const profId = c.req.query("profesional_id");
  const pacId  = c.req.query("paciente_id");
  const estado = c.req.query("estado");

  let q = `SELECT ci.*, pac.nombres || ' ' || pac.apellidos AS paciente_nombre,
                  pac.expediente,
                  p.nombres || ' ' || p.apellidos AS profesional_nombre,
                  p.especialidad
             FROM cita ci
             JOIN paciente pac ON pac.id = ci.paciente_id
             JOIN profesional p ON p.id = ci.profesional_id
            WHERE ci.institucion_id = ?`;
  const binds: unknown[] = [instId];
  if (desde) { q += " AND date(ci.fecha_hora) >= ?"; binds.push(desde); }
  if (hasta) { q += " AND date(ci.fecha_hora) <= ?"; binds.push(hasta); }
  if (profId) { q += " AND ci.profesional_id = ?"; binds.push(parseInt(profId)); }
  if (pacId)  { q += " AND ci.paciente_id = ?"; binds.push(parseInt(pacId)); }
  if (estado) { q += " AND ci.estado = ?"; binds.push(estado); }
  q += " ORDER BY ci.fecha_hora";

  const rows = await c.env.DB.prepare(q).bind(...binds).all();
  return c.json(rows.results ?? []);
});

app.post("/", async (c) => {
  const instId = getInstId(c);
  const session = c.get("session")!;
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!b.profesional_id || !b.paciente_id || !b.fecha_hora) {
    return c.json({ error: "profesional_paciente_fecha_requeridos" }, 400);
  }

  // Anti-traslape: mismo médico mismo slot
  const conflicto = await c.env.DB.prepare(
    `SELECT id FROM cita
      WHERE profesional_id = ? AND institucion_id = ?
        AND estado NOT IN ('cancelada','no_show')
        AND datetime(fecha_hora) = datetime(?)`
  ).bind(b.profesional_id, instId, b.fecha_hora).first();
  if (conflicto) return c.json({ error: "horario_ocupado" }, 409);

  const r = await c.env.DB.prepare(
    `INSERT INTO cita (profesional_id, paciente_id, fecha_hora, duracion, tipo, estado, motivo, notas, creado_por, institucion_id)
     VALUES (?, ?, ?, ?, ?, 'agendada', ?, ?, ?, ?)`
  ).bind(
    b.profesional_id, b.paciente_id, b.fecha_hora,
    b.duracion ?? 30, b.tipo ?? "consulta",
    b.motivo ?? null, b.notas ?? null,
    session.usuario_id, instId
  ).run();
  return c.json({ id: r.meta.last_row_id });
});

app.put("/:id", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"));
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const cita = await c.env.DB.prepare("SELECT id FROM cita WHERE id = ? AND institucion_id = ?")
    .bind(id, instId).first();
  if (!cita) return c.json({ error: "no_encontrada" }, 404);

  const fields: string[] = [];
  const vals: unknown[] = [];
  if (b.estado   !== undefined) { fields.push("estado = ?");    vals.push(b.estado); }
  if (b.notas    !== undefined) { fields.push("notas = ?");     vals.push(b.notas); }
  if (b.motivo   !== undefined) { fields.push("motivo = ?");    vals.push(b.motivo); }
  if (b.fecha_hora !== undefined) { fields.push("fecha_hora = ?"); vals.push(b.fecha_hora); }
  if (!fields.length) return c.json({ error: "nada_que_actualizar" }, 400);

  vals.push(id, instId);
  await c.env.DB.prepare(`UPDATE cita SET ${fields.join(", ")} WHERE id = ? AND institucion_id = ?`)
    .bind(...vals).run();
  return c.json({ ok: true });
});

app.delete("/:id", requireRole("admin", "programador_quirofano", "facturacion"), async (c) => {
  const instId = getInstId(c);
  await c.env.DB.prepare("UPDATE cita SET estado = 'cancelada' WHERE id = ? AND institucion_id = ?")
    .bind(parseInt(c.req.param("id")), instId).run();
  return c.json({ ok: true });
});

// Stats del día
app.get("/_stats_dia", async (c) => {
  const instId = getInstId(c);
  const fecha = c.req.query("fecha") ?? new Date().toISOString().slice(0, 10);
  const row = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN estado = 'agendada'    THEN 1 ELSE 0 END) AS agendadas,
       SUM(CASE WHEN estado = 'confirmada'  THEN 1 ELSE 0 END) AS confirmadas,
       SUM(CASE WHEN estado = 'en_espera'   THEN 1 ELSE 0 END) AS en_espera,
       SUM(CASE WHEN estado = 'atendida'    THEN 1 ELSE 0 END) AS atendidas,
       SUM(CASE WHEN estado = 'no_show'     THEN 1 ELSE 0 END) AS no_show
     FROM cita WHERE institucion_id = ? AND date(fecha_hora) = ?`
  ).bind(instId, fecha).first();
  return c.json(row ?? {});
});

export default app;
