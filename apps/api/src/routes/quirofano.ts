import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

app.get("/quirofanos", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, nombre, ubicacion, activo FROM quirofano ORDER BY nombre`
  ).all();
  return c.json({ data: results });
});

app.post("/quirofanos", requireRole("admin"), async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.nombre) return c.json({ error: "nombre_requerido" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO quirofano (nombre, ubicacion) VALUES (?, ?)`
  )
    .bind(b.nombre, b.ubicacion ?? null)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

app.get("/cirugias", async (c) => {
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const quirofanoId = c.req.query("quirofano_id");
  const filt: string[] = ["1=1"];
  const binds: unknown[] = [];
  if (desde) { filt.push("date(c.fecha_programada) >= ?"); binds.push(desde); }
  if (hasta) { filt.push("date(c.fecha_programada) <= ?"); binds.push(hasta); }
  if (quirofanoId) { filt.push("c.quirofano_id = ?"); binds.push(parseInt(quirofanoId, 10)); }
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, q.nombre AS quirofano,
            COALESCE(p.nombres || ' ' || p.apellidos, c.paciente_pendiente_nombre) AS paciente_nombre
       FROM cirugia c
       JOIN quirofano q ON q.id = c.quirofano_id
       LEFT JOIN paciente p ON p.id = c.paciente_id
      WHERE ${filt.join(" AND ")}
      ORDER BY c.fecha_programada, c.hora_inicio`
  )
    .bind(...binds)
    .all();
  return c.json({ data: results });
});

app.post(
  "/cirugias",
  requireRole("admin", "programador_quirofano", "medico"),
  async (c) => {
    const b = await c.req.json().catch(() => null);
    if (!b?.quirofano_id || !b?.fecha_programada) return c.json({ error: "datos_invalidos" }, 400);

    // Validar traslape simple por quirofano (mismo dia, rango horas)
    if (b.hora_inicio && b.hora_fin) {
      const tras = await c.env.DB.prepare(
        `SELECT id FROM cirugia
          WHERE quirofano_id = ?
            AND date(fecha_programada) = date(?)
            AND estado IN ('programada','en_curso')
            AND NOT (time(hora_fin) <= time(?) OR time(hora_inicio) >= time(?))`
      )
        .bind(b.quirofano_id, b.fecha_programada, b.hora_inicio, b.hora_fin)
        .first();
      if (tras) return c.json({ error: "traslape_quirofano" }, 400);
    }

    const codigo = b.codigo ?? `CIR-${Date.now()}`;
    const r = await c.env.DB.prepare(
      `INSERT INTO cirugia
         (codigo, fecha_programada, hora_inicio, hora_fin, quirofano_id, paciente_id,
          paciente_pendiente_nombre, tipo_cirugia, medico_principal_id, anestesiologo_id,
          enfermera_circulante_id, enfermera_instrumentista_id, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        codigo,
        b.fecha_programada,
        b.hora_inicio ?? null,
        b.hora_fin ?? null,
        b.quirofano_id,
        b.paciente_id ?? null,
        b.paciente_pendiente_nombre ?? null,
        b.tipo_cirugia ?? null,
        b.medico_principal_id ?? null,
        b.anestesiologo_id ?? null,
        b.enfermera_circulante_id ?? null,
        b.enfermera_instrumentista_id ?? null,
        b.observaciones ?? null
      )
      .run();
    return c.json({ id: r.meta.last_row_id, codigo });
  }
);

// Asociar paciente posteriormente
app.post(
  "/cirugias/:id/asociar-paciente",
  requireRole("admin", "programador_quirofano", "medico"),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const b = await c.req.json().catch(() => null);
    if (!b?.paciente_id) return c.json({ error: "paciente_requerido" }, 400);
    await c.env.DB.prepare(
      `UPDATE cirugia SET paciente_id = ?, paciente_pendiente_nombre = NULL WHERE id = ?`
    )
      .bind(b.paciente_id, id)
      .run();
    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "asociar_paciente_cirugia",
      entidad: "cirugia",
      entidad_id: id,
      payload: { paciente_id: b.paciente_id },
      ip: c.get("ip"),
    });
    return c.json({ ok: true });
  }
);

app.post(
  "/cirugias/:id/estado",
  requireRole("admin", "programador_quirofano", "medico", "enfermeria"),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const b = await c.req.json().catch(() => null);
    const validos = ["programada", "en_curso", "realizada", "suspendida", "cancelada"];
    if (!b?.estado || !validos.includes(b.estado)) return c.json({ error: "estado_invalido" }, 400);
    if (b.estado === "realizada") {
      const cir = await c.env.DB.prepare(`SELECT paciente_id FROM cirugia WHERE id = ?`).bind(id).first<{
        paciente_id: number | null;
      }>();
      if (!cir?.paciente_id) return c.json({ error: "paciente_requerido_para_cerrar" }, 400);
    }
    await c.env.DB.prepare(`UPDATE cirugia SET estado = ? WHERE id = ?`).bind(b.estado, id).run();
    return c.json({ ok: true });
  }
);

export default app;
