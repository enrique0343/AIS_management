import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

app.get("/", async (c) => {
  const q = c.req.query("q") ?? "";
  const sql = q
    ? `SELECT * FROM paciente WHERE nombres LIKE ? OR apellidos LIKE ? OR documento_numero LIKE ? OR expediente LIKE ? ORDER BY apellidos, nombres LIMIT 200`
    : `SELECT * FROM paciente ORDER BY creado_en DESC LIMIT 200`;
  const stmt = q
    ? c.env.DB.prepare(sql).bind(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
    : c.env.DB.prepare(sql);
  const { results } = await stmt.all();
  return c.json({ data: results });
});

app.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const p = await c.env.DB.prepare(`SELECT * FROM paciente WHERE id = ?`).bind(id).first();
  if (!p) return c.json({ error: "no_encontrado" }, 404);
  const ep = await c.env.DB.prepare(
    `SELECT * FROM episodio_atencion WHERE paciente_id = ? ORDER BY fecha_inicio DESC`
  )
    .bind(id)
    .all();
  return c.json({ paciente: p, episodios: ep.results });
});

app.post(
  "/",
  requireRole("admin", "medico", "enfermeria", "facturacion", "programador_quirofano"),
  async (c) => {
    const b = await c.req.json().catch(() => null);
    if (!b?.nombres || !b?.apellidos) return c.json({ error: "nombres_apellidos_requeridos" }, 400);
    const expediente = b.expediente ?? `EXP-${Date.now()}`;
    const r = await c.env.DB.prepare(
      `INSERT INTO paciente (expediente, nombres, apellidos, documento_tipo, documento_numero,
        fecha_nacimiento, sexo, telefono, direccion, contacto_emergencia, alergias, observaciones, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        expediente,
        b.nombres,
        b.apellidos,
        b.documento_tipo ?? null,
        b.documento_numero ?? null,
        b.fecha_nacimiento ?? null,
        b.sexo ?? null,
        b.telefono ?? null,
        b.direccion ?? null,
        b.contacto_emergencia ?? null,
        b.alergias ?? null,
        b.observaciones ?? null,
        c.get("session")!.usuario_id
      )
      .run();
    const id = r.meta.last_row_id as number;
    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "crear_paciente",
      entidad: "paciente",
      entidad_id: id,
      ip: c.get("ip"),
    });
    return c.json({ id, expediente });
  }
);

app.put("/:id", requireAuth, async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => null);
  if (!b) return c.json({ error: "datos_invalidos" }, 400);
  const allowed = [
    "nombres",
    "apellidos",
    "documento_tipo",
    "documento_numero",
    "fecha_nacimiento",
    "sexo",
    "telefono",
    "direccion",
    "contacto_emergencia",
    "alergias",
    "observaciones",
  ];
  const fields: string[] = [];
  const binds: unknown[] = [];
  for (const k of allowed) {
    if (b[k] !== undefined) {
      fields.push(`${k} = ?`);
      binds.push(b[k]);
    }
  }
  if (!fields.length) return c.json({ ok: true });
  binds.push(id);
  await c.env.DB.prepare(`UPDATE paciente SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  return c.json({ ok: true });
});

// Listar episodios (filtrables por estado / paciente)
app.get("/episodios/list", async (c) => {
  const estado = c.req.query("estado");
  const pacienteId = c.req.query("paciente_id");
  const filt: string[] = ["1=1"];
  const binds: unknown[] = [];
  if (estado) { filt.push("e.estado = ?"); binds.push(estado); }
  if (pacienteId) { filt.push("e.paciente_id = ?"); binds.push(parseInt(pacienteId, 10)); }
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.paciente_id, e.estado, e.fecha_inicio, e.motivo,
            p.nombres || ' ' || p.apellidos AS paciente, p.expediente,
            (SELECT COUNT(*) FROM consumo_paciente WHERE episodio_id = e.id AND factura_detalle_id IS NULL) AS consumos_pendientes
       FROM episodio_atencion e
       JOIN paciente p ON p.id = e.paciente_id
      WHERE ${filt.join(" AND ")}
      ORDER BY e.fecha_inicio DESC
      LIMIT 200`
  )
    .bind(...binds)
    .all();
  return c.json({ data: results });
});

// === Episodios ===
app.post("/:id/episodios", requireRole("admin", "medico", "enfermeria"), async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => ({}));
  const r = await c.env.DB.prepare(
    `INSERT INTO episodio_atencion (paciente_id, area_id, medico_id, enfermera_responsable_id, motivo)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, b.area_id ?? null, b.medico_id ?? null, b.enfermera_responsable_id ?? null, b.motivo ?? null)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

app.post("/episodios/:id/cerrar", requireRole("admin", "medico", "enfermeria"), async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await c.env.DB.prepare(
    `UPDATE episodio_atencion SET estado='cerrado', fecha_fin=datetime('now') WHERE id = ?`
  )
    .bind(id)
    .run();
  return c.json({ ok: true });
});

export default app;
