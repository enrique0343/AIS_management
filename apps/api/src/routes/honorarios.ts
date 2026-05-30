import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole, getInstId } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth, requireRole("admin", "facturacion"));

app.get("/", async (c) => {
  const instId = getInstId(c);
  const estado = c.req.query("estado");
  const profId = c.req.query("profesional_id");
  const filt: string[] = ["h.institucion_id = ?"];
  const binds: unknown[] = [instId];
  if (estado) { filt.push("h.estado = ?"); binds.push(estado); }
  if (profId) { filt.push("h.profesional_id = ?"); binds.push(parseInt(profId, 10)); }
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.episodio_id, h.cirugia_id, h.concepto, h.monto, h.estado,
            h.fecha_cobro, h.notas, h.creado_en,
            pm.nombres || ' ' || pm.apellidos AS profesional,
            pm.especialidad,
            p.nombres || ' ' || p.apellidos AS paciente,
            p.expediente
       FROM honorario_medico h
       JOIN profesional_medico pm ON pm.id = h.profesional_id AND pm.institucion_id = h.institucion_id
       LEFT JOIN episodio_atencion ea ON ea.id = h.episodio_id
       LEFT JOIN paciente p ON p.id = ea.paciente_id
      WHERE ${filt.join(" AND ")}
      ORDER BY h.creado_en DESC LIMIT 500`
  ).bind(...binds).all();
  return c.json({ data: results });
});

app.post("/", async (c) => {
  const instId = getInstId(c);
  const b = await c.req.json().catch(() => null);
  if (!b?.profesional_id || !b?.concepto || !b?.monto) return c.json({ error: "datos_invalidos" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO honorario_medico (episodio_id, cirugia_id, profesional_id, concepto, monto, notas, creado_por, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    b.episodio_id ?? null, b.cirugia_id ?? null,
    b.profesional_id, b.concepto, b.monto,
    b.notas ?? null, c.get("session")!.usuario_id, instId
  ).run();
  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "registrar_honorario",
    entidad: "honorario_medico",
    entidad_id: r.meta.last_row_id as number,
    payload: { profesional_id: b.profesional_id, monto: b.monto, concepto: b.concepto },
    ip: c.get("ip"),
    institucion_id: instId,
  });
  return c.json({ id: r.meta.last_row_id });
});

app.put("/:id", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const h = await c.env.DB.prepare(`SELECT estado FROM honorario_medico WHERE id=? AND institucion_id=?`).bind(id, instId).first<{ estado: string }>();
  if (!h) return c.json({ error: "no_encontrado" }, 404);
  if (h.estado !== "pendiente") return c.json({ error: "solo_se_puede_editar_si_esta_pendiente" }, 400);
  const b = await c.req.json().catch(() => null);
  if (!b?.concepto || !b?.monto) return c.json({ error: "datos_invalidos" }, 400);
  await c.env.DB.prepare(
    `UPDATE honorario_medico SET concepto=?, monto=?, notas=? WHERE id=? AND institucion_id=?`
  ).bind(b.concepto, b.monto, b.notas ?? null, id, instId).run();
  return c.json({ ok: true });
});

app.post("/:id/cobrar", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const h = await c.env.DB.prepare(`SELECT estado FROM honorario_medico WHERE id=? AND institucion_id=?`).bind(id, instId).first<{ estado: string }>();
  if (!h) return c.json({ error: "no_encontrado" }, 404);
  if (h.estado !== "pendiente") return c.json({ error: "ya_procesado" }, 400);
  await c.env.DB.prepare(
    `UPDATE honorario_medico SET estado='cobrado', fecha_cobro=datetime('now') WHERE id=? AND institucion_id=?`
  ).bind(id, instId).run();
  return c.json({ ok: true });
});

app.delete("/:id", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const h = await c.env.DB.prepare(`SELECT estado FROM honorario_medico WHERE id=? AND institucion_id=?`).bind(id, instId).first<{ estado: string }>();
  if (!h) return c.json({ error: "no_encontrado" }, 404);
  if (h.estado !== "pendiente") return c.json({ error: "no_se_puede_eliminar" }, 400);
  await c.env.DB.prepare(`DELETE FROM honorario_medico WHERE id=? AND institucion_id=?`).bind(id, instId).run();
  return c.json({ ok: true });
});

// Totales agrupados por médico para liquidar
app.get("/pendientes-entrega", async (c) => {
  const instId = getInstId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT h.profesional_id,
            pm.nombres || ' ' || pm.apellidos AS profesional,
            pm.especialidad,
            COUNT(*) AS cantidad,
            ROUND(SUM(h.monto), 2) AS total
       FROM honorario_medico h
       JOIN profesional_medico pm ON pm.id = h.profesional_id AND pm.institucion_id = h.institucion_id
      WHERE h.estado = 'cobrado' AND h.institucion_id = ?
      GROUP BY h.profesional_id
      ORDER BY profesional`
  ).bind(instId).all();
  return c.json({ data: results });
});

// Crear entrega (liquidar al médico)
app.post("/entregar", async (c) => {
  const instId = getInstId(c);
  const b = await c.req.json().catch(() => null);
  if (!b?.profesional_id || !b?.monto_total) return c.json({ error: "datos_invalidos" }, 400);
  const e = await c.env.DB.prepare(
    `INSERT INTO entrega_honorario (profesional_id, monto_total, comprobante, notas, creado_por, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(b.profesional_id, b.monto_total, b.comprobante ?? null, b.notas ?? null, c.get("session")!.usuario_id, instId).run();
  const entregaId = e.meta.last_row_id as number;
  await c.env.DB.prepare(
    `UPDATE honorario_medico SET estado='entregado', entrega_id=?
     WHERE profesional_id=? AND estado='cobrado' AND institucion_id=?`
  ).bind(entregaId, b.profesional_id, instId).run();
  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "entregar_honorarios",
    entidad: "entrega_honorario",
    entidad_id: entregaId,
    payload: { profesional_id: b.profesional_id, monto_total: b.monto_total },
    ip: c.get("ip"),
    institucion_id: instId,
  });
  return c.json({ id: entregaId });
});

app.get("/entregas", async (c) => {
  const instId = getInstId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.fecha, e.monto_total, e.comprobante, e.notas, e.creado_en,
            pm.nombres || ' ' || pm.apellidos AS profesional,
            u.nombre AS creado_por_nombre
       FROM entrega_honorario e
       JOIN profesional_medico pm ON pm.id = e.profesional_id AND pm.institucion_id = e.institucion_id
       LEFT JOIN usuario u ON u.id = e.creado_por
      WHERE e.institucion_id = ?
      ORDER BY e.fecha DESC LIMIT 200`
  ).bind(instId).all();
  return c.json({ data: results });
});

export default app;
