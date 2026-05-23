import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole } from "../middleware/auth";
import { planFEFO } from "../lib/fefo";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

/**
 * Registro de consumo del paciente. Descuenta del stock (FEFO) y deja
 * snapshot del CPP y precio_venta para facturacion posterior.
 *
 * Nota: los productos controlados se gestionan documentalmente en el libro
 * fisico autorizado por la SRS (fuera del sistema). El sistema solo registra
 * el movimiento de inventario.
 */
app.post("/consumos", requireRole("admin", "enfermeria", "medico", "farmaceutico"), async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.episodio_id || !b?.producto_id || !b?.area_id || !b?.cantidad) {
    return c.json({ error: "datos_invalidos" }, 400);
  }
  const cantidad = Number(b.cantidad);

  const ep = await c.env.DB.prepare(
    `SELECT id, estado, paciente_id FROM episodio_atencion WHERE id = ?`
  )
    .bind(b.episodio_id)
    .first<{ id: number; estado: string; paciente_id: number }>();
  if (!ep) return c.json({ error: "episodio_no_encontrado" }, 404);
  if (ep.estado !== "activo") return c.json({ error: "episodio_cerrado" }, 400);

  const prod = await c.env.DB.prepare(
    `SELECT p.id, p.costo_promedio_ponderado AS cpp, p.precio_venta, c.es_servicio
       FROM producto p JOIN categoria_producto c ON c.id = p.categoria_id
      WHERE p.id = ?`
  )
    .bind(b.producto_id)
    .first<{ id: number; cpp: number; precio_venta: number; es_servicio: number }>();
  if (!prod) return c.json({ error: "producto_no_encontrado" }, 404);

  // Servicios (laboratorio, radiologia, etc.) no descuentan stock ni generan
  // movimiento_inventario: solo se registran como cargo del paciente.
  if (prod.es_servicio === 1) {
    const r = await c.env.DB.prepare(
      `INSERT INTO consumo_paciente
         (episodio_id, producto_id, lote_id, area_id, cantidad,
          costo_unitario_snapshot, precio_venta_snapshot, usuario_id, observaciones)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        ep.id,
        b.producto_id,
        b.area_id,
        Number(b.cantidad),
        prod.cpp,
        prod.precio_venta,
        c.get("session")!.usuario_id,
        b.observaciones ?? null
      )
      .run();
    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "registrar_servicio",
      entidad: "consumo_paciente",
      payload: { episodio_id: ep.id, producto_id: b.producto_id, cantidad: Number(b.cantidad) },
      ip: c.get("ip"),
    });
    return c.json({ ok: true, consumos: [r.meta.last_row_id] });
  }

  let plan;
  try {
    plan = await planFEFO(c.env, b.producto_id, b.area_id, cantidad);
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }

  const insertedIds: number[] = [];
  for (const step of plan) {
    await c.env.DB.prepare(
      `UPDATE existencia SET cantidad = cantidad - ?
         WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id,0) = COALESCE(?,0)`
    )
      .bind(step.tomar, b.producto_id, b.area_id, step.lote_id)
      .run();
    await c.env.DB.prepare(
      `INSERT INTO movimiento_inventario
         (tipo, producto_id, lote_id, area_origen_id, cantidad, costo_unitario, usuario_id, referencia_tipo, referencia_id)
       VALUES ('consumo_paciente', ?, ?, ?, ?, ?, ?, 'consumo', ?)`
    )
      .bind(b.producto_id, step.lote_id, b.area_id, step.tomar, prod.cpp, c.get("session")!.usuario_id, ep.id)
      .run();
    const r = await c.env.DB.prepare(
      `INSERT INTO consumo_paciente
         (episodio_id, producto_id, lote_id, area_id, cantidad, costo_unitario_snapshot, precio_venta_snapshot, usuario_id, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        ep.id,
        b.producto_id,
        step.lote_id,
        b.area_id,
        step.tomar,
        prod.cpp,
        prod.precio_venta,
        c.get("session")!.usuario_id,
        b.observaciones ?? null
      )
      .run();
    insertedIds.push(r.meta.last_row_id as number);
  }

  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "consumo_paciente",
    entidad: "consumo_paciente",
    payload: { episodio_id: ep.id, producto_id: b.producto_id, cantidad, lineas: insertedIds.length },
    ip: c.get("ip"),
  });

  return c.json({ ok: true, consumos: insertedIds });
});

// ── Solicitud de devolucion (paso 1 - enfermeria) ──────────────────────────
// Crea un registro pendiente en devolucion_pendiente sin afectar inventario.
// Farmacia procesara o rechazara el registro en el paso 2.
app.post(
  "/consumos/:id/solicitar-devolucion",
  requireRole("admin", "enfermeria", "medico", "farmaceutico"),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const b = await c.req.json().catch(() => null);
    if (!b?.cantidad || !b?.area_destino_id) {
      return c.json({ error: "datos_invalidos", detalle: "cantidad y area_destino_id requeridos" }, 400);
    }
    const cantDev = Number(b.cantidad);
    const cp = await c.env.DB.prepare(
      `SELECT cp.id, cp.cantidad, cp.producto_id, cp.lote_id, cp.factura_detalle_id,
              cat.es_servicio, p.nombre AS producto
         FROM consumo_paciente cp
         JOIN producto p ON p.id = cp.producto_id
         JOIN categoria_producto cat ON cat.id = p.categoria_id
        WHERE cp.id = ?`
    ).bind(id).first<{ id: number; cantidad: number; producto_id: number; lote_id: number | null; factura_detalle_id: number | null; es_servicio: number; producto: string }>();
    if (!cp) return c.json({ error: "consumo_no_encontrado" }, 404);
    if (cp.factura_detalle_id) return c.json({ error: "consumo_ya_facturado_no_puede_devolverse" }, 400);
    if (cp.es_servicio === 1) return c.json({ error: "servicios_no_se_pueden_devolver" }, 400);
    if (cantDev <= 0 || cantDev > cp.cantidad) {
      return c.json({ error: "cantidad_invalida", maximo_disponible: cp.cantidad }, 400);
    }
    const session = c.get("session")!;
    // Enfermeria puede seleccionar un lote diferente al del consumo si hubo error en el despacho
    const loteId = b.lote_id != null ? Number(b.lote_id) : cp.lote_id;
    await c.env.DB.prepare(
      `INSERT INTO devolucion_pendiente
         (consumo_id, producto_id, lote_id, cantidad, area_destino_id, observaciones, solicitante_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, cp.producto_id, loteId, cantDev, b.area_destino_id, b.observaciones ?? null, session.usuario_id).run();
    await logAudit(c.env, { usuario_id: session.usuario_id, accion: "solicitar_devolucion", entidad: "consumo_paciente", entidad_id: id, payload: { cantidad: cantDev, area_destino_id: b.area_destino_id }, ip: c.get("ip") });
    return c.json({ ok: true });
  }
);

// ── Listado de devoluciones pendientes (farmacia) ───────────────────────────
app.get(
  "/devoluciones-pendientes",
  requireRole("admin", "jefe_farmacia_central", "farmaceutico"),
  async (c) => {
    const solo = c.req.query("estado") ?? "pendiente";
    const { results } = await c.env.DB.prepare(
      `SELECT dp.id, dp.estado, dp.cantidad, dp.observaciones, dp.created_at,
              dp.lote_id, dp.lote_final_id, dp.area_destino_id, dp.area_final_id,
              dp.motivo_rechazo, dp.procesado_en,
              p.nombre AS producto, p.codigo,
              l.numero_lote, l.fecha_vencimiento,
              cp.episodio_id,
              pac.nombres || ' ' || pac.apellidos AS paciente,
              us.nombre AS solicitante,
              ud.nombre AS procesado_por,
              ao.nombre AS area_sugerida
         FROM devolucion_pendiente dp
         JOIN consumo_paciente cp ON cp.id = dp.consumo_id
         JOIN producto p ON p.id = dp.producto_id
         JOIN episodio_atencion ep ON ep.id = cp.episodio_id
         JOIN paciente pac ON pac.id = ep.paciente_id
         JOIN usuario us ON us.id = dp.solicitante_id
         LEFT JOIN usuario ud ON ud.id = dp.procesado_por_id
         LEFT JOIN lote l ON l.id = dp.lote_id
         LEFT JOIN area ao ON ao.id = dp.area_destino_id
        WHERE dp.estado = ?
        ORDER BY dp.created_at DESC`
    ).bind(solo).all();
    return c.json({ data: results });
  }
);

// ── Procesar devolucion (paso 2 - farmacia) ─────────────────────────────────
app.post(
  "/devoluciones/:id/procesar",
  requireRole("admin", "jefe_farmacia_central", "farmaceutico"),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const b = await c.req.json().catch(() => null);
    const dp = await c.env.DB.prepare(
      `SELECT dp.*, cp.area_id AS area_origen_id, cp.costo_unitario_snapshot
         FROM devolucion_pendiente dp
         JOIN consumo_paciente cp ON cp.id = dp.consumo_id
        WHERE dp.id = ?`
    ).bind(id).first<any>();
    if (!dp) return c.json({ error: "devolucion_no_encontrada" }, 404);
    if (dp.estado !== "pendiente") return c.json({ error: "devolucion_ya_procesada" }, 400);

    const loteId    = b?.lote_id    ?? dp.lote_id;
    const areaId    = b?.area_id    ?? dp.area_destino_id;
    const session   = c.get("session")!;

    // Reducir consumo
    await c.env.DB.prepare(`UPDATE consumo_paciente SET cantidad = cantidad - ? WHERE id = ?`)
      .bind(dp.cantidad, dp.consumo_id).run();

    // Reingreso al stock preservando lote
    const ex = await c.env.DB.prepare(
      `SELECT id FROM existencia WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id,0) = COALESCE(?,0)`
    ).bind(dp.producto_id, areaId, loteId).first<{ id: number }>();
    if (ex) {
      await c.env.DB.prepare(`UPDATE existencia SET cantidad = cantidad + ? WHERE id = ?`).bind(dp.cantidad, ex.id).run();
    } else {
      await c.env.DB.prepare(`INSERT INTO existencia (producto_id, area_id, lote_id, cantidad) VALUES (?,?,?,?)`)
        .bind(dp.producto_id, areaId, loteId, dp.cantidad).run();
    }

    // Movimiento de inventario
    await c.env.DB.prepare(
      `INSERT INTO movimiento_inventario
         (tipo, producto_id, lote_id, area_origen_id, area_destino_id, cantidad, costo_unitario, usuario_id, referencia_tipo, referencia_id, observaciones)
       VALUES ('devolucion', ?, ?, ?, ?, ?, ?, ?, 'consumo', ?, ?)`
    ).bind(dp.producto_id, loteId, dp.area_origen_id, areaId, dp.cantidad, dp.costo_unitario_snapshot, session.usuario_id, dp.consumo_id, dp.observaciones ?? "Devolucion procesada por farmacia").run();

    // Marcar como procesada
    await c.env.DB.prepare(
      `UPDATE devolucion_pendiente SET estado='procesada', procesado_por_id=?, procesado_en=datetime('now'), lote_final_id=?, area_final_id=? WHERE id=?`
    ).bind(session.usuario_id, loteId, areaId, id).run();

    await logAudit(c.env, { usuario_id: session.usuario_id, accion: "procesar_devolucion", entidad: "devolucion_pendiente", entidad_id: id, payload: { lote_id: loteId, area_id: areaId }, ip: c.get("ip") });
    return c.json({ ok: true });
  }
);

// ── Rechazar devolucion (farmacia) ──────────────────────────────────────────
app.post(
  "/devoluciones/:id/rechazar",
  requireRole("admin", "jefe_farmacia_central", "farmaceutico"),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const b = await c.req.json().catch(() => null);
    const dp = await c.env.DB.prepare(`SELECT id, estado FROM devolucion_pendiente WHERE id = ?`).bind(id).first<{ id: number; estado: string }>();
    if (!dp) return c.json({ error: "devolucion_no_encontrada" }, 404);
    if (dp.estado !== "pendiente") return c.json({ error: "devolucion_ya_procesada" }, 400);
    const session = c.get("session")!;
    await c.env.DB.prepare(
      `UPDATE devolucion_pendiente SET estado='rechazada', procesado_por_id=?, procesado_en=datetime('now'), motivo_rechazo=? WHERE id=?`
    ).bind(session.usuario_id, b?.motivo ?? null, id).run();
    return c.json({ ok: true });
  }
);

// ── Devolucion directa legacy (mantiene compatibilidad) ─────────────────────
app.post(
  "/consumos/:id/devolucion",
  requireRole("admin", "enfermeria", "medico", "farmaceutico"),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const b = await c.req.json().catch(() => null);
    if (!b?.cantidad || !b?.area_destino_id) {
      return c.json({ error: "datos_invalidos", detalle: "cantidad y area_destino_id requeridos" }, 400);
    }
    const cantDev = Number(b.cantidad);

    const cp = await c.env.DB.prepare(
      `SELECT cp.id, cp.cantidad, cp.producto_id, cp.lote_id, cp.area_id,
              cp.costo_unitario_snapshot, cp.factura_detalle_id,
              cat.es_servicio, p.nombre AS producto
         FROM consumo_paciente cp
         JOIN producto p ON p.id = cp.producto_id
         JOIN categoria_producto cat ON cat.id = p.categoria_id
        WHERE cp.id = ?`
    )
      .bind(id)
      .first<{
        id: number; cantidad: number; producto_id: number; lote_id: number | null;
        area_id: number; costo_unitario_snapshot: number; factura_detalle_id: number | null;
        es_servicio: number; producto: string;
      }>();
    if (!cp) return c.json({ error: "consumo_no_encontrado" }, 404);
    if (cp.factura_detalle_id) return c.json({ error: "consumo_ya_facturado_no_puede_devolverse" }, 400);
    if (cp.es_servicio === 1) return c.json({ error: "servicios_no_se_pueden_devolver" }, 400);
    if (cantDev <= 0 || cantDev > cp.cantidad) {
      return c.json({ error: "cantidad_invalida", maximo_disponible: cp.cantidad }, 400);
    }

    // Reducir el consumo
    await c.env.DB.prepare(`UPDATE consumo_paciente SET cantidad = cantidad - ? WHERE id = ?`)
      .bind(cantDev, id)
      .run();

    // Sumar al area destino (farmacia interna que custodia) preservando lote
    const ex = await c.env.DB.prepare(
      `SELECT id FROM existencia
        WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)`
    )
      .bind(cp.producto_id, b.area_destino_id, cp.lote_id)
      .first<{ id: number }>();
    if (ex) {
      await c.env.DB.prepare(`UPDATE existencia SET cantidad = cantidad + ? WHERE id = ?`)
        .bind(cantDev, ex.id)
        .run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO existencia (producto_id, area_id, lote_id, cantidad) VALUES (?, ?, ?, ?)`
      )
        .bind(cp.producto_id, b.area_destino_id, cp.lote_id, cantDev)
        .run();
    }

    // Movimiento de inventario tipo 'devolucion'
    await c.env.DB.prepare(
      `INSERT INTO movimiento_inventario
         (tipo, producto_id, lote_id, area_origen_id, area_destino_id, cantidad,
          costo_unitario, usuario_id, referencia_tipo, referencia_id, observaciones)
       VALUES ('devolucion', ?, ?, ?, ?, ?, ?, ?, 'consumo', ?, ?)`
    )
      .bind(
        cp.producto_id,
        cp.lote_id,
        cp.area_id,
        b.area_destino_id,
        cantDev,
        cp.costo_unitario_snapshot,
        c.get("session")!.usuario_id,
        id,
        b.observaciones ?? `Devolucion de ${cp.producto} no utilizado`
      )
      .run();

    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "devolucion_consumo",
      entidad: "consumo_paciente",
      entidad_id: id,
      payload: { cantidad: cantDev, area_destino_id: b.area_destino_id },
      ip: c.get("ip"),
    });

    return c.json({ ok: true });
  }
);

app.get("/consumos", async (c) => {
  const episodioId = c.req.query("episodio_id");
  if (!episodioId) return c.json({ error: "episodio_id_requerido" }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT cp.*, p.nombre AS producto, p.codigo, l.numero_lote, l.fecha_vencimiento
       FROM consumo_paciente cp
       JOIN producto p ON p.id = cp.producto_id
       LEFT JOIN lote l ON l.id = cp.lote_id
      WHERE cp.episodio_id = ?
      ORDER BY cp.fecha`
  )
    .bind(parseInt(episodioId, 10))
    .all();
  return c.json({ data: results });
});

export default app;
