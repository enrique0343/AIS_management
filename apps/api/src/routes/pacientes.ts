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

// Estado de cuenta del paciente: consumos y ocupaciones pendientes + facturados.
// Una "ocupacion abierta" cuenta dias hasta hoy (no facturable hasta egreso).
app.get("/:id/estado-cuenta", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const pac = await c.env.DB.prepare(`SELECT id, nombres, apellidos, expediente FROM paciente WHERE id = ?`)
    .bind(id)
    .first();
  if (!pac) return c.json({ error: "no_encontrado" }, 404);

  const consumos = await c.env.DB.prepare(
    `SELECT cp.id, cp.fecha, cp.cantidad, cp.precio_venta_snapshot,
            ROUND(cp.cantidad * cp.precio_venta_snapshot, 2) AS subtotal,
            p.codigo, p.nombre AS producto, cat.es_servicio,
            cp.factura_detalle_id IS NOT NULL AS facturado,
            cp.episodio_id
       FROM consumo_paciente cp
       JOIN producto p ON p.id = cp.producto_id
       JOIN categoria_producto cat ON cat.id = p.categoria_id
       JOIN episodio_atencion e ON e.id = cp.episodio_id
      WHERE e.paciente_id = ?
      ORDER BY cp.fecha DESC`
  )
    .bind(id)
    .all<any>();

  const ocupaciones = await c.env.DB.prepare(
    `SELECT o.id, o.fecha_ingreso, o.fecha_egreso, o.precio_diario_snapshot,
            o.factura_detalle_id IS NOT NULL AS facturado, o.episodio_id,
            h.numero AS habitacion, h.tipo AS habitacion_tipo,
            -- Dias contados desde ingreso hasta egreso (o hoy si activa).
            -- Minimo 1 dia para estancias del mismo dia.
            MAX(
              CAST((julianday(COALESCE(o.fecha_egreso, datetime('now'))) - julianday(o.fecha_ingreso)) AS INTEGER),
              1
            ) AS dias,
            ROUND(
              MAX(CAST((julianday(COALESCE(o.fecha_egreso, datetime('now'))) - julianday(o.fecha_ingreso)) AS INTEGER), 1)
              * o.precio_diario_snapshot, 2
            ) AS subtotal
       FROM ocupacion_habitacion o
       JOIN habitacion h ON h.id = o.habitacion_id
      WHERE o.paciente_id = ?
      ORDER BY o.fecha_ingreso DESC`
  )
    .bind(id)
    .all<any>();

  const tot = (rows: any[], cond: (r: any) => boolean) =>
    Math.round(rows.filter(cond).reduce((s, r) => s + Number(r.subtotal), 0) * 100) / 100;

  const cons = consumos.results ?? [];
  const ocup = ocupaciones.results ?? [];

  return c.json({
    paciente: pac,
    consumos: cons,
    ocupaciones: ocup,
    totales: {
      consumos_pendientes: tot(cons, (r) => !r.facturado),
      consumos_facturados: tot(cons, (r) => !!r.facturado),
      // Solo ocupaciones cerradas son facturables
      habitacion_pendiente: tot(ocup, (r) => !r.facturado && r.fecha_egreso),
      habitacion_en_curso: tot(ocup, (r) => !r.facturado && !r.fecha_egreso),
      habitacion_facturado: tot(ocup, (r) => !!r.facturado),
    },
  });
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

// Enfermeria solicita el alta del paciente. Marca el episodio para que
// administracion lo revise, ajuste y luego cierre/facture.
app.post(
  "/episodios/:id/solicitar-alta",
  requireRole("admin", "enfermeria", "medico"),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const ep = await c.env.DB.prepare(`SELECT estado FROM episodio_atencion WHERE id = ?`)
      .bind(id)
      .first<{ estado: string }>();
    if (!ep) return c.json({ error: "no_encontrado" }, 404);
    if (ep.estado !== "activo") return c.json({ error: "episodio_no_activo" }, 400);
    await c.env.DB.prepare(
      `UPDATE episodio_atencion
          SET alta_solicitada_en = datetime('now'),
              alta_solicitada_por = ?
        WHERE id = ?`
    )
      .bind(c.get("session")!.usuario_id, id)
      .run();
    return c.json({ ok: true });
  }
);

// Cancela la solicitud de alta (vuelve a activo "normal")
app.post(
  "/episodios/:id/cancelar-alta",
  requireRole("admin", "enfermeria", "medico"),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    await c.env.DB.prepare(
      `UPDATE episodio_atencion SET alta_solicitada_en=NULL, alta_solicitada_por=NULL WHERE id=?`
    )
      .bind(id)
      .run();
    return c.json({ ok: true });
  }
);

// Pacientes "en atencion": episodio activo o habitacion activa.
// Usado por la pagina /atencion (bedside).
app.get("/_en-atencion", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT p.id, p.expediente, p.nombres, p.apellidos,
            e.id AS episodio_id, e.fecha_inicio, e.motivo,
            e.alta_solicitada_en, e.estado AS episodio_estado,
            o.id AS ocupacion_id, h.numero AS habitacion, h.tipo AS habitacion_tipo,
            o.fecha_ingreso AS habitacion_desde,
            (SELECT COUNT(*) FROM consumo_paciente cp WHERE cp.episodio_id = e.id AND cp.factura_detalle_id IS NULL) AS consumos_pend,
            (SELECT codigo FROM cirugia WHERE paciente_id = p.id AND estado IN ('programada','en_curso') ORDER BY fecha_programada LIMIT 1) AS cirugia_proxima
       FROM paciente p
       JOIN episodio_atencion e ON e.paciente_id = p.id AND e.estado = 'activo'
       LEFT JOIN ocupacion_habitacion o ON o.paciente_id = p.id AND o.fecha_egreso IS NULL
       LEFT JOIN habitacion h ON h.id = o.habitacion_id
      ORDER BY e.alta_solicitada_en IS NULL, e.fecha_inicio DESC`
  ).all();
  return c.json({ data: results });
});

export default app;
