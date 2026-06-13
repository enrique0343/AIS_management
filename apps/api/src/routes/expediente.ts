import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole, getInstId } from "../middleware/auth";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

// ──────────────── SIGNOS VITALES ────────────────

app.get("/episodio/:id/signos-vitales", async (c) => {
  const instId = getInstId(c);
  const epId = parseInt(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    `SELECT sv.*, u.nombre AS registrado_por_nombre
       FROM signo_vital sv
       LEFT JOIN usuario u ON u.id = sv.registrado_por
      WHERE sv.episodio_id = ? AND sv.institucion_id = ?
      ORDER BY sv.fecha DESC LIMIT 100`
  ).bind(epId, instId).all();
  return c.json(rows.results ?? []);
});

app.post("/episodio/:id/signos-vitales", async (c) => {
  const instId = getInstId(c);
  const session = c.get("session")!;
  const epId = parseInt(c.req.param("id"));
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const r = await c.env.DB.prepare(
    `INSERT INTO signo_vital (episodio_id, registrado_por, fecha, fc, ta_sistolica, ta_diastolica, spo2, temperatura, fr, glucosa, peso, talla, notas, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    epId, session.usuario_id,
    b.fecha ?? new Date().toISOString(),
    b.fc ?? null, b.ta_sistolica ?? null, b.ta_diastolica ?? null,
    b.spo2 ?? null, b.temperatura ?? null, b.fr ?? null,
    b.glucosa ?? null, b.peso ?? null, b.talla ?? null,
    b.notas ?? null, instId
  ).run();
  return c.json({ id: r.meta.last_row_id });
});

app.delete("/signos-vitales/:id", requireRole("admin", "medico"), async (c) => {
  const instId = getInstId(c);
  await c.env.DB.prepare("DELETE FROM signo_vital WHERE id = ? AND institucion_id = ?")
    .bind(parseInt(c.req.param("id")), instId).run();
  return c.json({ ok: true });
});

// ──────────────── NOTAS CLÍNICAS ────────────────

app.get("/episodio/:id/notas", async (c) => {
  const instId = getInstId(c);
  const epId = parseInt(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    `SELECT nc.*, u.nombre AS creado_por_nombre, p.nombres || ' ' || p.apellidos AS firmado_por_nombre
       FROM nota_clinica nc
       LEFT JOIN usuario u ON u.id = nc.creado_por
       LEFT JOIN profesional p ON p.id = nc.firmado_por_id
      WHERE nc.episodio_id = ? AND nc.institucion_id = ?
      ORDER BY nc.creado_en DESC`
  ).bind(epId, instId).all();
  return c.json(rows.results ?? []);
});

app.post("/episodio/:id/notas", async (c) => {
  const instId = getInstId(c);
  const session = c.get("session")!;
  const epId = parseInt(c.req.param("id"));
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!b.cuerpo) return c.json({ error: "cuerpo_requerido" }, 400);
  const tipo = (b.tipo as string) ?? "evolucion";
  const r = await c.env.DB.prepare(
    `INSERT INTO nota_clinica (episodio_id, tipo, cuerpo, creado_por, institucion_id)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(epId, tipo, b.cuerpo, session.usuario_id, instId).run();
  return c.json({ id: r.meta.last_row_id });
});

app.post("/notas/:id/firmar", requireRole("admin", "medico"), async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"));
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const nota = await c.env.DB.prepare(
    "SELECT firmada FROM nota_clinica WHERE id = ? AND institucion_id = ?"
  ).bind(id, instId).first<{ firmada: number }>();
  if (!nota) return c.json({ error: "no_encontrada" }, 404);
  if (nota.firmada) return c.json({ error: "ya_firmada" }, 409);
  await c.env.DB.prepare(
    `UPDATE nota_clinica SET firmada = 1, firmado_por_id = ?, fecha_firma = datetime('now')
      WHERE id = ? AND institucion_id = ?`
  ).bind(b.profesional_id ?? null, id, instId).run();
  return c.json({ ok: true });
});

// ──────────────── CIE-10 ────────────────

app.get("/cie10", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json([]);
  const rows = await c.env.DB.prepare(
    `SELECT codigo, nombre, categoria FROM cie10
      WHERE codigo LIKE ? OR nombre LIKE ?
      ORDER BY codigo LIMIT 20`
  ).bind(`${q}%`, `%${q}%`).all();
  return c.json(rows.results ?? []);
});

// ──────────────── DIAGNÓSTICOS ────────────────

app.get("/episodio/:id/diagnosticos", async (c) => {
  const instId = getInstId(c);
  const epId = parseInt(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    `SELECT d.*, c.nombre AS cie10_nombre, u.nombre AS creado_por_nombre
       FROM diagnostico_episodio d
       LEFT JOIN cie10 c ON c.codigo = d.cie10_codigo
       LEFT JOIN usuario u ON u.id = d.creado_por
      WHERE d.episodio_id = ? AND d.institucion_id = ?
      ORDER BY d.tipo, d.creado_en`
  ).bind(epId, instId).all();
  return c.json(rows.results ?? []);
});

app.post("/episodio/:id/diagnosticos", async (c) => {
  const instId = getInstId(c);
  const session = c.get("session")!;
  const epId = parseInt(c.req.param("id"));
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!b.descripcion) return c.json({ error: "descripcion_requerida" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO diagnostico_episodio (episodio_id, cie10_codigo, descripcion, tipo, creado_por, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(epId, b.cie10_codigo ?? null, b.descripcion, b.tipo ?? "principal", session.usuario_id, instId).run();
  return c.json({ id: r.meta.last_row_id });
});

app.delete("/diagnosticos/:id", requireRole("admin", "medico"), async (c) => {
  const instId = getInstId(c);
  await c.env.DB.prepare("DELETE FROM diagnostico_episodio WHERE id = ? AND institucion_id = ?")
    .bind(parseInt(c.req.param("id")), instId).run();
  return c.json({ ok: true });
});

// ──────────────── PRESCRIPCIONES ────────────────

app.get("/episodio/:id/prescripciones", async (c) => {
  const instId = getInstId(c);
  const epId = parseInt(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    `SELECT pr.*, p.nombre AS producto_nombre, p.descripcion AS producto_desc,
            med.nombres || ' ' || med.apellidos AS prescrito_por_nombre,
            (SELECT COUNT(*) FROM administracion_medicamento am WHERE am.prescripcion_id = pr.id) AS administraciones
       FROM prescripcion pr
       JOIN producto p ON p.id = pr.producto_id
       LEFT JOIN profesional med ON med.id = pr.prescrito_por
      WHERE pr.episodio_id = ? AND pr.institucion_id = ?
      ORDER BY pr.creado_en DESC`
  ).bind(epId, instId).all();
  return c.json(rows.results ?? []);
});

app.post("/episodio/:id/prescripciones", requireRole("admin", "medico"), async (c) => {
  const instId = getInstId(c);
  const session = c.get("session")!;
  const epId = parseInt(c.req.param("id"));
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!b.producto_id || !b.dosis) return c.json({ error: "producto_id_y_dosis_requeridos" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO prescripcion (episodio_id, producto_id, prescrito_por, dosis, frecuencia_horas, dias, via, notas, creado_por, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    epId, b.producto_id, b.prescrito_por ?? null, b.dosis,
    b.frecuencia_horas ?? 8, b.dias ?? 1, b.via ?? "oral",
    b.notas ?? null, session.usuario_id, instId
  ).run();
  return c.json({ id: r.meta.last_row_id });
});

app.post("/prescripciones/:id/suspender", requireRole("admin", "medico"), async (c) => {
  const instId = getInstId(c);
  await c.env.DB.prepare(
    "UPDATE prescripcion SET estado = 'suspendida' WHERE id = ? AND institucion_id = ?"
  ).bind(parseInt(c.req.param("id")), instId).run();
  return c.json({ ok: true });
});

// POST /prescripciones/:id/administrar — MAR
app.post("/prescripciones/:id/administrar", requireRole("admin", "enfermeria", "medico"), async (c) => {
  const instId = getInstId(c);
  const session = c.get("session")!;
  const prescId = parseInt(c.req.param("id"));
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const presc = await c.env.DB.prepare(
    "SELECT estado, dosis FROM prescripcion WHERE id = ? AND institucion_id = ?"
  ).bind(prescId, instId).first<{ estado: string; dosis: string }>();
  if (!presc) return c.json({ error: "no_encontrada" }, 404);
  if (presc.estado !== "activa") return c.json({ error: "prescripcion_no_activa" }, 409);
  await c.env.DB.prepare(
    `INSERT INTO administracion_medicamento (prescripcion_id, administrado_por, fecha, dosis_administrada, via, observaciones, institucion_id)
     VALUES (?, ?, datetime('now'), ?, ?, ?, ?)`
  ).bind(prescId, session.usuario_id, b.dosis_administrada ?? presc.dosis, b.via ?? null, b.observaciones ?? null, instId).run();
  return c.json({ ok: true });
});

app.get("/prescripciones/:id/administraciones", async (c) => {
  const instId = getInstId(c);
  const rows = await c.env.DB.prepare(
    `SELECT am.*, u.nombre AS administrado_por_nombre
       FROM administracion_medicamento am
       LEFT JOIN usuario u ON u.id = am.administrado_por
      WHERE am.prescripcion_id = ? AND am.institucion_id = ?
      ORDER BY am.fecha DESC`
  ).bind(parseInt(c.req.param("id")), instId).all();
  return c.json(rows.results ?? []);
});

export default app;
