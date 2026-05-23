import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole, getInstId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { planFEFO } from "../lib/fefo";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

app.get("/quirofanos", async (c) => {
  const instId = getInstId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, nombre, ubicacion, activo FROM quirofano WHERE institucion_id = ? ORDER BY nombre`
  ).bind(instId).all();
  return c.json({ data: results });
});

app.post("/quirofanos", requireRole("admin"), async (c) => {
  const instId = getInstId(c);
  const b = await c.req.json().catch(() => null);
  if (!b?.nombre) return c.json({ error: "nombre_requerido" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO quirofano (nombre, ubicacion, institucion_id) VALUES (?, ?, ?)`
  )
    .bind(b.nombre, b.ubicacion ?? null, instId)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

app.get("/cirugias", async (c) => {
  const instId = getInstId(c);
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const quirofanoId = c.req.query("quirofano_id");
  const filt: string[] = ["c.institucion_id = ?"];
  const binds: unknown[] = [instId];
  if (desde) { filt.push("date(COALESCE(c.inicio_at, c.fecha_programada)) >= ?"); binds.push(desde); }
  if (hasta) { filt.push("date(COALESCE(c.inicio_at, c.fecha_programada)) <= ?"); binds.push(hasta); }
  if (quirofanoId) { filt.push("c.quirofano_id = ?"); binds.push(parseInt(quirofanoId, 10)); }
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.codigo, c.fecha_programada, c.hora_inicio, c.hora_fin,
            c.inicio_at, c.fin_at, c.quirofano_id, c.paciente_id,
            c.paciente_pendiente_nombre, c.tipo_cirugia, c.estado, c.observaciones,
            c.medico_principal_id, c.cirujano_ayudante_id, c.anestesiologo_id,
            c.enfermera_circulante_id, c.enfermera_instrumentista_id,
            q.nombre AS quirofano,
            COALESCE(p.nombres || ' ' || p.apellidos, c.paciente_pendiente_nombre) AS paciente_nombre,
            (SELECT nombres || ' ' || apellidos FROM profesional_medico WHERE id = c.medico_principal_id AND institucion_id = ?) AS cirujano_nombre,
            (SELECT nombres || ' ' || apellidos FROM profesional_medico WHERE id = c.cirujano_ayudante_id AND institucion_id = ?) AS ayudante_nombre,
            (SELECT nombres || ' ' || apellidos FROM profesional_medico WHERE id = c.anestesiologo_id AND institucion_id = ?) AS anestesiologo_nombre
       FROM cirugia c
       JOIN quirofano q ON q.id = c.quirofano_id AND q.institucion_id = ?
       LEFT JOIN paciente p ON p.id = c.paciente_id AND p.institucion_id = ?
      WHERE ${filt.join(" AND ")}
      ORDER BY COALESCE(c.inicio_at, c.fecha_programada), c.hora_inicio`
  )
    .bind(instId, instId, instId, instId, instId, ...binds)
    .all();
  return c.json({ data: results });
});

app.post(
  "/cirugias",
  requireRole("admin", "programador_quirofano", "medico"),
  async (c) => {
    const instId = getInstId(c);
    const b = await c.req.json().catch(() => null);
    if (!b?.quirofano_id || !b?.inicio_at || !b?.fin_at) {
      return c.json({ error: "datos_invalidos", detalle: "quirofano_id, inicio_at, fin_at requeridos" }, 400);
    }
    if (b.fin_at <= b.inicio_at) {
      return c.json({ error: "fin_debe_ser_posterior_a_inicio" }, 400);
    }
    if (!b.medico_principal_id) {
      return c.json({ error: "cirujano_requerido" }, 400);
    }

    // Validar traslape por rango datetime completo (soporta cruzar medianoche)
    const tras = await c.env.DB.prepare(
      `SELECT id FROM cirugia
        WHERE quirofano_id = ?
          AND institucion_id = ?
          AND estado IN ('programada','en_curso')
          AND inicio_at IS NOT NULL AND fin_at IS NOT NULL
          AND NOT (datetime(fin_at) <= datetime(?) OR datetime(inicio_at) >= datetime(?))`
    )
      .bind(b.quirofano_id, instId, b.inicio_at, b.fin_at)
      .first();
    if (tras) return c.json({ error: "traslape_quirofano" }, 400);

    const codigo = b.codigo ?? `CIR-${Date.now()}`;
    // Derivar fecha_programada / hora_inicio / hora_fin para compat
    const fechaProg = String(b.inicio_at).slice(0, 10);
    const horaIni = String(b.inicio_at).slice(11, 16);
    const horaFin = String(b.fin_at).slice(11, 16);

    const r = await c.env.DB.prepare(
      `INSERT INTO cirugia
         (codigo, fecha_programada, hora_inicio, hora_fin, inicio_at, fin_at,
          quirofano_id, paciente_id, paciente_pendiente_nombre, tipo_cirugia,
          medico_principal_id, cirujano_ayudante_id, anestesiologo_id,
          enfermera_circulante_id, enfermera_instrumentista_id, observaciones, institucion_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        codigo,
        fechaProg,
        horaIni,
        horaFin,
        b.inicio_at,
        b.fin_at,
        b.quirofano_id,
        b.paciente_id ?? null,
        b.paciente_pendiente_nombre ?? null,
        b.tipo_cirugia ?? null,
        b.medico_principal_id,
        b.cirujano_ayudante_id ?? null,
        b.anestesiologo_id ?? null,
        b.enfermera_circulante_id ?? null,
        b.enfermera_instrumentista_id ?? null,
        b.observaciones ?? null,
        instId
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
    const instId = getInstId(c);
    const id = parseInt(c.req.param("id"), 10);
    const b = await c.req.json().catch(() => null);
    if (!b?.paciente_id) return c.json({ error: "paciente_requerido" }, 400);
    await c.env.DB.prepare(
      `UPDATE cirugia SET paciente_id = ?, paciente_pendiente_nombre = NULL WHERE id = ? AND institucion_id = ?`
    )
      .bind(b.paciente_id, id, instId)
      .run();
    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "asociar_paciente_cirugia",
      entidad: "cirugia",
      entidad_id: id,
      payload: { paciente_id: b.paciente_id },
      ip: c.get("ip"),
      institucion_id: instId,
    });
    return c.json({ ok: true });
  }
);

// Registrar consumo intra-cirugia (descarga del area destino, FEFO).
// Si no hay paciente aun, el consumo queda asociado solo a la cirugia.
// Al cerrarla con estado=realizada, los consumos se vuelcan a consumo_paciente
// si hay paciente y un episodio abierto del mismo (se abre uno si no existe).
app.post(
  "/cirugias/:id/consumos",
  requireRole("admin", "enfermeria", "medico", "programador_quirofano"),
  async (c) => {
    const instId = getInstId(c);
    const id = parseInt(c.req.param("id"), 10);
    const b = await c.req.json().catch(() => null);
    if (!b?.producto_id || !b?.area_id || !b?.cantidad) return c.json({ error: "datos_invalidos" }, 400);

    const cir = await c.env.DB.prepare(`SELECT id, estado FROM cirugia WHERE id = ? AND institucion_id = ?`)
      .bind(id, instId)
      .first<{ id: number; estado: string }>();
    if (!cir) return c.json({ error: "cirugia_no_encontrada" }, 404);
    if (cir.estado === "realizada" || cir.estado === "cancelada") {
      return c.json({ error: "cirugia_cerrada" }, 400);
    }

    const prod = await c.env.DB.prepare(
      `SELECT id, costo_promedio_ponderado AS cpp FROM producto WHERE id = ? AND institucion_id = ?`
    )
      .bind(b.producto_id, instId)
      .first<{ id: number; cpp: number }>();
    if (!prod) return c.json({ error: "producto_no_encontrado" }, 404);

    let plan;
    try {
      plan = await planFEFO(c.env, b.producto_id, b.area_id, Number(b.cantidad), instId);
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
    for (const step of plan) {
      await c.env.DB.prepare(
        `UPDATE existencia SET cantidad = cantidad - ?
           WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id,0) = COALESCE(?,0)
             AND institucion_id = ?`
      )
        .bind(step.tomar, b.producto_id, b.area_id, step.lote_id, instId)
        .run();
      await c.env.DB.prepare(
        `INSERT INTO movimiento_inventario
           (tipo, producto_id, lote_id, area_origen_id, cantidad, costo_unitario, usuario_id, referencia_tipo, referencia_id, observaciones, institucion_id)
         VALUES ('consumo_paciente', ?, ?, ?, ?, ?, ?, 'cirugia', ?, 'cirugia ' || ?, ?)`
      )
        .bind(b.producto_id, step.lote_id, b.area_id, step.tomar, prod.cpp,
              c.get("session")!.usuario_id, id, id, instId)
        .run();
      await c.env.DB.prepare(
        `INSERT INTO cirugia_consumo (cirugia_id, producto_id, lote_id, area_id, cantidad, costo_unitario_snapshot, institucion_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(id, b.producto_id, step.lote_id, b.area_id, step.tomar, prod.cpp, instId)
        .run();
    }
    return c.json({ ok: true });
  }
);

app.get("/cirugias/:id/consumos", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const { results } = await c.env.DB.prepare(
    `SELECT cc.id, cc.cantidad, cc.costo_unitario_snapshot,
            p.nombre AS producto, p.codigo, l.numero_lote, l.fecha_vencimiento,
            cc.consumo_id
       FROM cirugia_consumo cc
       JOIN producto p ON p.id = cc.producto_id AND p.institucion_id = ?
       LEFT JOIN lote l ON l.id = cc.lote_id AND l.institucion_id = ?
      WHERE cc.cirugia_id = ? AND cc.institucion_id = ?
      ORDER BY cc.id`
  )
    .bind(instId, instId, id, instId)
    .all();
  return c.json({ data: results });
});

app.post(
  "/cirugias/:id/estado",
  requireRole("admin", "programador_quirofano", "medico", "enfermeria"),
  async (c) => {
    const instId = getInstId(c);
    const id = parseInt(c.req.param("id"), 10);
    const b = await c.req.json().catch(() => null);
    const validos = ["programada", "en_curso", "realizada", "suspendida", "cancelada"];
    if (!b?.estado || !validos.includes(b.estado)) return c.json({ error: "estado_invalido" }, 400);
    if (b.estado === "realizada") {
      const cir = await c.env.DB.prepare(`SELECT paciente_id FROM cirugia WHERE id = ? AND institucion_id = ?`).bind(id, instId).first<{
        paciente_id: number | null;
      }>();
      if (!cir?.paciente_id) return c.json({ error: "paciente_requerido_para_cerrar" }, 400);

      // Buscar episodio activo del paciente, o crear uno nuevo asociado a quirofano
      let ep = await c.env.DB.prepare(
        `SELECT id FROM episodio_atencion WHERE paciente_id = ? AND estado='activo' AND institucion_id = ? ORDER BY id DESC LIMIT 1`
      )
        .bind(cir.paciente_id, instId)
        .first<{ id: number }>();
      if (!ep) {
        const ins = await c.env.DB.prepare(
          `INSERT INTO episodio_atencion (paciente_id, motivo, institucion_id) VALUES (?, 'Cirugia', ?)`
        )
          .bind(cir.paciente_id, instId)
          .run();
        ep = { id: ins.meta.last_row_id as number };
      }

      // Volcar consumos no facturados (que aun no tienen consumo_id)
      const pendientes = await c.env.DB.prepare(
        `SELECT cc.id, cc.producto_id, cc.lote_id, cc.area_id, cc.cantidad, cc.costo_unitario_snapshot,
                p.precio_venta
           FROM cirugia_consumo cc
           JOIN producto p ON p.id = cc.producto_id AND p.institucion_id = ?
          WHERE cc.cirugia_id = ? AND cc.consumo_id IS NULL AND cc.institucion_id = ?`
      )
        .bind(instId, id, instId)
        .all<{
          id: number;
          producto_id: number;
          lote_id: number | null;
          area_id: number | null;
          cantidad: number;
          costo_unitario_snapshot: number;
          precio_venta: number;
        }>();

      for (const cc of pendientes.results ?? []) {
        if (!cc.area_id) continue; // sin area no podemos asociar
        const ins = await c.env.DB.prepare(
          `INSERT INTO consumo_paciente
             (episodio_id, producto_id, lote_id, area_id, cantidad,
              costo_unitario_snapshot, precio_venta_snapshot, usuario_id, observaciones, institucion_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Cirugia #' || ?, ?)`
        )
          .bind(
            ep.id,
            cc.producto_id,
            cc.lote_id,
            cc.area_id,
            cc.cantidad,
            cc.costo_unitario_snapshot,
            cc.precio_venta,
            c.get("session")!.usuario_id,
            id,
            instId
          )
          .run();
        await c.env.DB.prepare(`UPDATE cirugia_consumo SET consumo_id = ? WHERE id = ? AND institucion_id = ?`)
          .bind(ins.meta.last_row_id, cc.id, instId)
          .run();
      }
    }
    await c.env.DB.prepare(`UPDATE cirugia SET estado = ? WHERE id = ? AND institucion_id = ?`).bind(b.estado, id, instId).run();
    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "cambio_estado_cirugia",
      entidad: "cirugia",
      entidad_id: id,
      payload: { estado: b.estado },
      ip: c.get("ip"),
      institucion_id: instId,
    });
    return c.json({ ok: true });
  }
);

export default app;
