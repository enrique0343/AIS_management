import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole, getInstId } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

// Listar habitaciones con ocupacion actual (cuantos ocupantes activos)
app.get("/", async (c) => {
  const instId = getInstId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT h.*,
            (SELECT COUNT(*) FROM ocupacion_habitacion o
              WHERE o.habitacion_id = h.id AND o.fecha_egreso IS NULL AND o.institucion_id = ?) AS ocupantes_actuales,
            (SELECT GROUP_CONCAT(p.nombres || ' ' || p.apellidos)
               FROM ocupacion_habitacion o
               JOIN paciente p ON p.id = o.paciente_id
              WHERE o.habitacion_id = h.id AND o.fecha_egreso IS NULL AND o.institucion_id = ?) AS pacientes_actuales
       FROM habitacion h
      WHERE h.institucion_id = ?
      ORDER BY h.numero`
  ).bind(instId, instId, instId).all();
  return c.json({ data: results });
});

app.post("/", requireRole("admin"), async (c) => {
  const instId = getInstId(c);
  const b = await c.req.json().catch(() => null);
  if (!b?.numero) return c.json({ error: "numero_requerido" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO habitacion (numero, tipo, precio_diario, capacidad, area_id, ubicacion, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      b.numero,
      b.tipo ?? "individual",
      Number(b.precio_diario ?? 0),
      Number(b.capacidad ?? 1),
      b.area_id ?? null,
      b.ubicacion ?? null,
      instId
    )
    .run();
  return c.json({ id: r.meta.last_row_id });
});

app.put("/:id", requireRole("admin"), async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => null);
  if (!b) return c.json({ error: "datos_invalidos" }, 400);
  const fields: string[] = [];
  const binds: unknown[] = [];
  for (const k of ["numero", "tipo", "precio_diario", "capacidad", "area_id", "ubicacion", "activa"]) {
    if (b[k] !== undefined) {
      fields.push(`${k} = ?`);
      binds.push(typeof b[k] === "boolean" ? (b[k] ? 1 : 0) : b[k]);
    }
  }
  if (!fields.length) return c.json({ ok: true });
  binds.push(id, instId);
  await c.env.DB.prepare(`UPDATE habitacion SET ${fields.join(", ")} WHERE id = ? AND institucion_id = ?`)
    .bind(...binds)
    .run();
  return c.json({ ok: true });
});

// Asignar paciente a habitacion (crea ocupacion)
app.post(
  "/asignar",
  requireRole("admin", "enfermeria", "medico", "facturacion"),
  async (c) => {
    const instId = getInstId(c);
    const b = await c.req.json().catch(() => null);
    if (!b?.paciente_id || !b?.habitacion_id) return c.json({ error: "datos_invalidos" }, 400);
    if (!b?.medico_cabecera_id) {
      return c.json({ error: "medico_cabecera_requerido", detalle: "debe seleccionarse el medico de cabecera registrado" }, 400);
    }

    const hab = await c.env.DB.prepare(
      `SELECT id, precio_diario, capacidad, activa FROM habitacion WHERE id = ? AND institucion_id = ?`
    )
      .bind(b.habitacion_id, instId)
      .first<{ id: number; precio_diario: number; capacidad: number; activa: number }>();
    if (!hab) return c.json({ error: "habitacion_no_encontrada" }, 404);
    if (!hab.activa) return c.json({ error: "habitacion_inactiva" }, 400);

    const med = await c.env.DB.prepare(
      `SELECT id FROM profesional_medico WHERE id = ? AND activo = 1 AND institucion_id = ?`
    )
      .bind(b.medico_cabecera_id, instId)
      .first<{ id: number }>();
    if (!med) return c.json({ error: "medico_cabecera_no_encontrado_o_inactivo" }, 400);

    const ocup = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ocupacion_habitacion
        WHERE habitacion_id = ? AND fecha_egreso IS NULL AND institucion_id = ?`
    )
      .bind(b.habitacion_id, instId)
      .first<{ n: number }>();
    if ((ocup?.n ?? 0) >= hab.capacidad) {
      return c.json({ error: "habitacion_llena", capacidad: hab.capacidad }, 400);
    }

    // Si el paciente ya esta en otra habitacion activa, egresarla primero
    await c.env.DB.prepare(
      `UPDATE ocupacion_habitacion
          SET fecha_egreso = datetime('now')
        WHERE paciente_id = ? AND fecha_egreso IS NULL AND institucion_id = ?`
    )
      .bind(b.paciente_id, instId)
      .run();

    // Si no se especifica episodio_id, usar el activo del paciente o crear uno.
    // Asignar habitacion = hospitalizar; no requiere cargos previos.
    // Se registra el medico de cabecera en episodio_atencion.medico_id.
    let episodioId: number | null = b.episodio_id ?? null;
    if (!episodioId) {
      const epActivo = await c.env.DB.prepare(
        `SELECT id FROM episodio_atencion WHERE paciente_id = ? AND estado = 'activo' AND institucion_id = ? ORDER BY id DESC LIMIT 1`
      )
        .bind(b.paciente_id, instId)
        .first<{ id: number }>();
      if (epActivo) {
        episodioId = epActivo.id;
      } else {
        const ep = await c.env.DB.prepare(
          `INSERT INTO episodio_atencion (paciente_id, medico_id, motivo, institucion_id) VALUES (?, ?, ?, ?)`
        )
          .bind(b.paciente_id, b.medico_cabecera_id, b.motivo ?? "Hospitalizacion", instId)
          .run();
        episodioId = ep.meta.last_row_id as number;
      }
    }
    // Actualizar medico de cabecera del episodio (sobrescribe el previo si lo hubiera)
    await c.env.DB.prepare(
      `UPDATE episodio_atencion SET medico_id = ? WHERE id = ? AND institucion_id = ?`
    )
      .bind(b.medico_cabecera_id, episodioId, instId)
      .run();

    const r = await c.env.DB.prepare(
      `INSERT INTO ocupacion_habitacion
         (paciente_id, episodio_id, habitacion_id, precio_diario_snapshot, usuario_id, observaciones, institucion_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        b.paciente_id,
        episodioId,
        b.habitacion_id,
        hab.precio_diario,
        c.get("session")!.usuario_id,
        b.observaciones ?? null,
        instId
      )
      .run();
    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "asignar_habitacion",
      entidad: "ocupacion_habitacion",
      entidad_id: r.meta.last_row_id as number,
      payload: { paciente_id: b.paciente_id, habitacion_id: b.habitacion_id },
      ip: c.get("ip"),
      institucion_id: instId,
    });
    return c.json({ id: r.meta.last_row_id, ok: true });
  }
);

// Egresar (cierra ocupacion activa) — al hacerlo queda facturable
app.post(
  "/ocupacion/:id/egresar",
  requireRole("admin", "facturacion"),
  async (c) => {
    const instId = getInstId(c);
    const id = parseInt(c.req.param("id"), 10);
    const o = await c.env.DB.prepare(`SELECT fecha_egreso FROM ocupacion_habitacion WHERE id = ? AND institucion_id = ?`)
      .bind(id, instId)
      .first<{ fecha_egreso: string | null }>();
    if (!o) return c.json({ error: "ocupacion_no_encontrada" }, 404);
    if (o.fecha_egreso) return c.json({ error: "ya_egresada" }, 400);
    await c.env.DB.prepare(
      `UPDATE ocupacion_habitacion SET fecha_egreso = datetime('now') WHERE id = ? AND institucion_id = ?`
    )
      .bind(id, instId)
      .run();
    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "egresar_habitacion",
      entidad: "ocupacion_habitacion",
      entidad_id: id,
      ip: c.get("ip"),
      institucion_id: instId,
    });
    return c.json({ ok: true });
  }
);

// Pacientes hospitalizados (todas las ocupaciones activas)
app.get("/_hospitalizados", async (c) => {
  const instId = getInstId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT o.id AS ocupacion_id, o.fecha_ingreso, o.precio_diario_snapshot,
            o.episodio_id, o.observaciones,
            p.id AS paciente_id, p.expediente, p.nombres, p.apellidos,
            p.documento_tipo, p.documento_numero, p.telefono,
            h.id AS habitacion_id, h.numero AS habitacion, h.tipo AS habitacion_tipo,
            MAX(CAST((julianday('now') - julianday(o.fecha_ingreso)) AS INTEGER), 1) AS dias_estancia,
            e.alta_solicitada_en
       FROM ocupacion_habitacion o
       JOIN paciente p ON p.id = o.paciente_id
       JOIN habitacion h ON h.id = o.habitacion_id
       LEFT JOIN episodio_atencion e ON e.id = o.episodio_id
      WHERE o.fecha_egreso IS NULL AND o.institucion_id = ?
      ORDER BY o.fecha_ingreso DESC`
  ).bind(instId).all();
  return c.json({ data: results });
});

// Ocupaciones de un paciente (historial)
app.get("/paciente/:pid", async (c) => {
  const instId = getInstId(c);
  const pid = parseInt(c.req.param("pid"), 10);
  const { results } = await c.env.DB.prepare(
    `SELECT o.*, h.numero AS habitacion_numero, h.tipo AS habitacion_tipo
       FROM ocupacion_habitacion o
       JOIN habitacion h ON h.id = o.habitacion_id
      WHERE o.paciente_id = ? AND o.institucion_id = ?
      ORDER BY o.fecha_ingreso DESC`
  )
    .bind(pid, instId)
    .all();
  return c.json({ data: results });
});

export default app;
