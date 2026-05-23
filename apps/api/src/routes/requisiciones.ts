import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole } from "../middleware/auth";
import { planFEFO } from "../lib/fefo";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

// Listar (filtrable por estado, paciente)
app.get("/", async (c) => {
  const estado = c.req.query("estado");
  const pacienteId = c.req.query("paciente_id");
  const filt: string[] = ["1=1"];
  const binds: unknown[] = [];
  if (estado) { filt.push("r.estado = ?"); binds.push(estado); }
  if (pacienteId) { filt.push("r.paciente_id = ?"); binds.push(parseInt(pacienteId, 10)); }
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.numero, r.fecha_solicitud, r.estado, r.prioridad,
            r.fecha_despacho, r.motivo_rechazo, r.observaciones,
            p.expediente, p.nombres || ' ' || p.apellidos AS paciente,
            ao.nombre AS area_solicitante, af.nombre AS area_farmacia,
            us.nombre AS solicitante, ud.nombre AS despachador,
            (SELECT COUNT(*) FROM requisicion_detalle d WHERE d.requisicion_id = r.id) AS lineas
       FROM requisicion r
       JOIN paciente p ON p.id = r.paciente_id
       LEFT JOIN area ao ON ao.id = r.area_solicitante_id
       JOIN area af ON af.id = r.area_farmacia_id
       JOIN usuario us ON us.id = r.solicitante_id
       LEFT JOIN usuario ud ON ud.id = r.despachador_id
      WHERE ${filt.join(" AND ")}
      ORDER BY (r.estado = 'pendiente') DESC,
               CASE r.prioridad WHEN 'stat' THEN 0 WHEN 'urgente' THEN 1 ELSE 2 END,
               r.fecha_solicitud DESC
      LIMIT 500`
  )
    .bind(...binds)
    .all();
  return c.json({ data: results });
});

// Conteo de pendientes para badge en menu
app.get("/_pendientes_count", async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM requisicion WHERE estado IN ('pendiente','despachada_parcial')`
  ).first<{ n: number }>();
  return c.json({ n: r?.n ?? 0 });
});

// Detalle
app.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const r = await c.env.DB.prepare(
    `SELECT r.*, p.expediente, p.nombres || ' ' || p.apellidos AS paciente,
            ao.nombre AS area_solicitante, af.nombre AS area_farmacia,
            us.nombre AS solicitante, ud.nombre AS despachador
       FROM requisicion r
       JOIN paciente p ON p.id = r.paciente_id
       LEFT JOIN area ao ON ao.id = r.area_solicitante_id
       JOIN area af ON af.id = r.area_farmacia_id
       JOIN usuario us ON us.id = r.solicitante_id
       LEFT JOIN usuario ud ON ud.id = r.despachador_id
      WHERE r.id = ?`
  )
    .bind(id)
    .first();
  if (!r) return c.json({ error: "no_encontrada" }, 404);
  const det = await c.env.DB.prepare(
    `SELECT d.id, d.producto_id, d.cantidad_solicitada, d.cantidad_despachada,
            p.codigo, p.nombre AS producto, u.abreviatura AS unidad,
            (SELECT COALESCE(SUM(cantidad), 0) FROM existencia e WHERE e.producto_id = p.id) AS stock_total
       FROM requisicion_detalle d
       JOIN producto p ON p.id = d.producto_id
       JOIN unidad_medida u ON u.id = p.unidad_medida_id
      WHERE d.requisicion_id = ?`
  )
    .bind(id)
    .all();
  return c.json({ requisicion: r, detalles: det.results });
});

// Crear (enfermeria) - sin lote (no tiene visibilidad)
app.post(
  "/",
  requireRole("admin", "enfermeria", "medico", "farmaceutico"),
  async (c) => {
    const b = await c.req.json().catch(() => null);
    if (!b?.paciente_id || !Array.isArray(b.detalles) || !b.detalles.length) {
      return c.json({ error: "datos_invalidos" }, 400);
    }

    // area_farmacia_id: si no viene, usar la primera farmacia central activa
    let farmaciaId = b.area_farmacia_id;
    if (!farmaciaId) {
      const f = await c.env.DB.prepare(
        `SELECT id FROM area WHERE tipo = 'farmacia_central' ORDER BY id LIMIT 1`
      ).first<{ id: number }>();
      if (!f) return c.json({ error: "no_hay_farmacia_central_configurada" }, 400);
      farmaciaId = f.id;
    }

    // Validar que ningun producto sea servicio (no se solicitan)
    for (const d of b.detalles) {
      const cat = await c.env.DB.prepare(
        `SELECT c.es_servicio FROM producto p JOIN categoria_producto c ON c.id = p.categoria_id WHERE p.id = ?`
      )
        .bind(d.producto_id)
        .first<{ es_servicio: number }>();
      if (!cat) return c.json({ error: "producto_no_encontrado", producto_id: d.producto_id }, 400);
      if (cat.es_servicio === 1) {
        return c.json({ error: "servicios_no_se_solicitan", producto_id: d.producto_id }, 400);
      }
    }

    const numero = `REQ-${Date.now()}`;
    const ins = await c.env.DB.prepare(
      `INSERT INTO requisicion
         (numero, paciente_id, episodio_id, area_solicitante_id, area_farmacia_id,
          prioridad, solicitante_id, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        numero,
        b.paciente_id,
        b.episodio_id ?? null,
        b.area_solicitante_id ?? null,
        farmaciaId,
        b.prioridad ?? "normal",
        c.get("session")!.usuario_id,
        b.observaciones ?? null
      )
      .run();
    const reqId = ins.meta.last_row_id as number;

    for (const d of b.detalles) {
      await c.env.DB.prepare(
        `INSERT INTO requisicion_detalle
           (requisicion_id, producto_id, cantidad_solicitada, observaciones)
         VALUES (?, ?, ?, ?)`
      )
        .bind(reqId, d.producto_id, Number(d.cantidad_solicitada), d.observaciones ?? null)
        .run();
    }

    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "crear_requisicion",
      entidad: "requisicion",
      entidad_id: reqId,
      payload: { numero, lineas: b.detalles.length, paciente_id: b.paciente_id },
      ip: c.get("ip"),
    });

    return c.json({ id: reqId, numero });
  }
);

// Despachar (farmacia). El farmaceutico ELIGE el lote(s) por linea.
// Si una linea no especifica lotes, fallback a FEFO automatico.
//
// body: {
//   items?: [{
//     id: number,                          // requisicion_detalle.id
//     lotes?: [{ lote_id: number|null, cantidad: number }],  // eleccion manual
//     cantidad_despachada?: number          // si NO se manda lotes, FEFO con este total
//   }]
// }
app.post(
  "/:id/despachar",
  requireRole("admin", "jefe_farmacia_central", "farmaceutico"),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const b = await c.req.json().catch(() => ({}));
    const itemsByDetalle: Record<number, { lotes?: { lote_id: number | null; cantidad: number }[]; cantidad_despachada?: number }> = {};
    if (Array.isArray(b?.items)) {
      for (const it of b.items) itemsByDetalle[Number(it.id)] = it;
    }

    const req = await c.env.DB.prepare(
      `SELECT r.*, p.id AS paciente_id_real
         FROM requisicion r JOIN paciente p ON p.id = r.paciente_id WHERE r.id = ?`
    )
      .bind(id)
      .first<any>();
    if (!req) return c.json({ error: "no_encontrada" }, 404);
    if (!["pendiente", "despachada_parcial"].includes(req.estado)) {
      return c.json({ error: "estado_no_despachable", estado: req.estado }, 400);
    }

    // Asegurar episodio activo (la cuenta hospitalaria se actualiza via consumo_paciente)
    let episodioId: number | null = req.episodio_id;
    if (!episodioId) {
      const ep = await c.env.DB.prepare(
        `SELECT id FROM episodio_atencion WHERE paciente_id = ? AND estado = 'activo' ORDER BY id DESC LIMIT 1`
      )
        .bind(req.paciente_id)
        .first<{ id: number }>();
      if (ep) episodioId = ep.id;
      else {
        const ins = await c.env.DB.prepare(
          `INSERT INTO episodio_atencion (paciente_id, motivo) VALUES (?, 'Atencion')`
        )
          .bind(req.paciente_id)
          .run();
        episodioId = ins.meta.last_row_id as number;
      }
      await c.env.DB.prepare(`UPDATE requisicion SET episodio_id = ? WHERE id = ?`)
        .bind(episodioId, id)
        .run();
    }

    const detalles = await c.env.DB.prepare(
      `SELECT d.*, p.costo_promedio_ponderado AS cpp, p.precio_venta
         FROM requisicion_detalle d JOIN producto p ON p.id = d.producto_id
        WHERE d.requisicion_id = ?`
    )
      .bind(id)
      .all<any>();

    const resultados: any[] = [];
    let huboParcial = false;
    let huboCompleto = false;

    const ejecutarStep = async (productoId: number, loteId: number | null, cantidad: number, cpp: number, precioVenta: number, refTexto: string) => {
      // Validar que el lote tenga stock en el area_farmacia
      const ex = await c.env.DB.prepare(
        `SELECT cantidad FROM existencia
          WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)`
      )
        .bind(productoId, req.area_farmacia_id, loteId)
        .first<{ cantidad: number }>();
      if (!ex || ex.cantidad < cantidad) {
        throw new Error(`Stock insuficiente en lote seleccionado (disponible ${ex?.cantidad ?? 0})`);
      }
      await c.env.DB.prepare(
        `UPDATE existencia SET cantidad = cantidad - ?
          WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)`
      )
        .bind(cantidad, productoId, req.area_farmacia_id, loteId)
        .run();
      await c.env.DB.prepare(
        `INSERT INTO movimiento_inventario
           (tipo, producto_id, lote_id, area_origen_id, cantidad, costo_unitario,
            usuario_id, referencia_tipo, referencia_id, observaciones)
         VALUES ('consumo_paciente', ?, ?, ?, ?, ?, ?, 'requisicion', ?, ?)`
      )
        .bind(productoId, loteId, req.area_farmacia_id, cantidad, cpp, c.get("session")!.usuario_id, id, refTexto)
        .run();
      await c.env.DB.prepare(
        `INSERT INTO consumo_paciente
           (episodio_id, producto_id, lote_id, area_id, cantidad,
            costo_unitario_snapshot, precio_venta_snapshot, usuario_id, observaciones)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(episodioId, productoId, loteId, req.area_farmacia_id, cantidad, cpp, precioVenta, c.get("session")!.usuario_id, refTexto)
        .run();
    };

    for (const d of detalles.results ?? []) {
      const pendiente = Number(d.cantidad_solicitada) - Number(d.cantidad_despachada);
      if (pendiente <= 0) continue;
      const item = itemsByDetalle[d.id];

      try {
        let totalDespachado = 0;
        if (item?.lotes && item.lotes.length) {
          // Despacho con lotes elegidos manualmente
          const total = item.lotes.reduce((s, x) => s + Number(x.cantidad), 0);
          if (total > pendiente) throw new Error(`Cantidad asignada (${total}) excede pendiente (${pendiente})`);
          for (const l of item.lotes) {
            const cant = Number(l.cantidad);
            if (cant <= 0) continue;
            await ejecutarStep(d.producto_id, l.lote_id ?? null, cant, d.cpp, d.precio_venta, `Despacho req. ${req.numero}`);
            totalDespachado += cant;
          }
        } else {
          // Fallback: FEFO automatico
          const aDespachar = item?.cantidad_despachada !== undefined
            ? Math.min(Number(item.cantidad_despachada), pendiente)
            : pendiente;
          if (aDespachar <= 0) continue;
          const plan = await planFEFO(c.env, d.producto_id, req.area_farmacia_id, aDespachar);
          for (const step of plan) {
            await ejecutarStep(d.producto_id, step.lote_id, step.tomar, d.cpp, d.precio_venta, `Despacho req. ${req.numero}`);
            totalDespachado += step.tomar;
          }
        }

        if (totalDespachado > 0) {
          await c.env.DB.prepare(
            `UPDATE requisicion_detalle SET cantidad_despachada = cantidad_despachada + ? WHERE id = ?`
          )
            .bind(totalDespachado, d.id)
            .run();
          const completo = totalDespachado >= pendiente;
          if (completo) huboCompleto = true; else huboParcial = true;
          resultados.push({ detalle_id: d.id, despachado: totalDespachado, ok: true });
        }
      } catch (e: any) {
        resultados.push({ detalle_id: d.id, despachado: 0, ok: false, error: e.message });
        huboParcial = true;
      }
    }

    // Determinar estado final segun cantidades
    const finales = await c.env.DB.prepare(
      `SELECT SUM(cantidad_solicitada - cantidad_despachada) AS pend
         FROM requisicion_detalle WHERE requisicion_id = ?`
    )
      .bind(id)
      .first<{ pend: number }>();
    const totalPend = Number(finales?.pend ?? 0);
    const nuevoEstado = totalPend <= 0 ? "despachada" : huboCompleto || huboParcial ? "despachada_parcial" : req.estado;

    await c.env.DB.prepare(
      `UPDATE requisicion
          SET estado = ?, despachador_id = ?, fecha_despacho = COALESCE(fecha_despacho, datetime('now'))
        WHERE id = ?`
    )
      .bind(nuevoEstado, c.get("session")!.usuario_id, id)
      .run();

    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "despachar_requisicion",
      entidad: "requisicion",
      entidad_id: id,
      payload: { resultados, estado: nuevoEstado },
      ip: c.get("ip"),
    });

    return c.json({ ok: true, estado: nuevoEstado, resultados });
  }
);

// Rechazar (farmacia, solo si pendiente)
app.post(
  "/:id/rechazar",
  requireRole("admin", "jefe_farmacia_central", "farmaceutico"),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const b = await c.req.json().catch(() => null);
    if (!b?.motivo) return c.json({ error: "motivo_requerido" }, 400);
    const r = await c.env.DB.prepare(`SELECT estado FROM requisicion WHERE id = ?`).bind(id).first<{ estado: string }>();
    if (!r) return c.json({ error: "no_encontrada" }, 404);
    if (r.estado !== "pendiente") return c.json({ error: "solo_pendientes" }, 400);
    await c.env.DB.prepare(
      `UPDATE requisicion SET estado='rechazada', motivo_rechazo=?, despachador_id=?, fecha_despacho=datetime('now') WHERE id=?`
    )
      .bind(b.motivo, c.get("session")!.usuario_id, id)
      .run();
    return c.json({ ok: true });
  }
);

// Cancelar (solicitante, solo si pendiente)
app.post(
  "/:id/cancelar",
  requireRole("admin", "enfermeria", "medico", "farmaceutico"),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const r = await c.env.DB.prepare(`SELECT estado FROM requisicion WHERE id = ?`).bind(id).first<{ estado: string }>();
    if (!r) return c.json({ error: "no_encontrada" }, 404);
    if (r.estado !== "pendiente") return c.json({ error: "solo_pendientes" }, 400);
    await c.env.DB.prepare(`UPDATE requisicion SET estado='cancelada' WHERE id=?`).bind(id).run();
    return c.json({ ok: true });
  }
);

export default app;
