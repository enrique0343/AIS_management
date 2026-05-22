import { Hono } from "hono";
import { RecepcionCompraInput } from "@ais/shared";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole } from "../middleware/auth";
import { recalcCPP } from "../lib/cpp";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

// Listar ordenes de compra
app.get("/ordenes", async (c) => {
  const estado = c.req.query("estado");
  let sql =
    `SELECT oc.id, oc.numero, oc.fecha, oc.estado, oc.subtotal, oc.iva, oc.total,
            pr.nombre AS proveedor
       FROM orden_compra oc
       JOIN proveedor pr ON pr.id = oc.proveedor_id`;
  const binds: unknown[] = [];
  if (estado) {
    sql += ` WHERE oc.estado = ?`;
    binds.push(estado);
  }
  sql += ` ORDER BY oc.fecha DESC, oc.id DESC LIMIT 500`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ data: results });
});

app.get("/ordenes/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const oc = await c.env.DB.prepare(`SELECT * FROM orden_compra WHERE id = ?`).bind(id).first();
  if (!oc) return c.json({ error: "no_encontrado" }, 404);
  const det = await c.env.DB.prepare(
    `SELECT d.*, p.nombre AS producto FROM orden_compra_detalle d
       JOIN producto p ON p.id = d.producto_id WHERE d.orden_id = ?`
  )
    .bind(id)
    .all();
  return c.json({ orden: oc, detalles: det.results });
});

// Crear OC
app.post("/ordenes", requireRole("admin", "jefe_farmacia_central"), async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.proveedor_id || !Array.isArray(b.detalles) || !b.detalles.length) {
    return c.json({ error: "datos_invalidos" }, 400);
  }
  const numero = b.numero ?? `OC-${Date.now()}`;
  let subtotal = 0;
  for (const d of b.detalles) subtotal += Number(d.cantidad) * Number(d.costo_unitario);
  const iva = Number(b.iva ?? 0);
  const total = subtotal + iva;

  const ins = await c.env.DB.prepare(
    `INSERT INTO orden_compra (numero, proveedor_id, fecha, estado, subtotal, iva, total, usuario_id, observaciones)
     VALUES (?, ?, COALESCE(?, date('now')), 'borrador', ?, ?, ?, ?, ?)`
  )
    .bind(
      numero,
      b.proveedor_id,
      b.fecha ?? null,
      subtotal,
      iva,
      total,
      c.get("session")!.usuario_id,
      b.observaciones ?? null
    )
    .run();
  const ordenId = ins.meta.last_row_id as number;

  for (const d of b.detalles) {
    const sub = Number(d.cantidad) * Number(d.costo_unitario);
    await c.env.DB.prepare(
      `INSERT INTO orden_compra_detalle (orden_id, producto_id, cantidad, costo_unitario, subtotal)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(ordenId, d.producto_id, d.cantidad, d.costo_unitario, sub)
      .run();
  }

  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "crear_orden_compra",
    entidad: "orden_compra",
    entidad_id: ordenId,
    payload: { numero, proveedor_id: b.proveedor_id, total },
    ip: c.get("ip"),
  });
  return c.json({ id: ordenId, numero });
});

// Sugerencias de compra por reorden
app.get("/sugerencias", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.codigo, p.nombre, p.punto_reorden,
            (SELECT COALESCE(SUM(cantidad), 0) FROM existencia WHERE producto_id = p.id) AS existencia,
            p.proveedor_preferente_id, p.costo_promedio_ponderado
       FROM producto p
      WHERE p.activo = 1 AND p.punto_reorden > 0
        AND (SELECT COALESCE(SUM(cantidad), 0) FROM existencia WHERE producto_id = p.id) < p.punto_reorden
      ORDER BY p.proveedor_preferente_id, p.nombre`
  ).all();
  return c.json({ data: results });
});

/**
 * Recepcion de compra: descarga del proveedor al area destino,
 * actualiza CPP, crea lote (si aplica), suma existencia y emite movimiento_inventario.
 *
 * Cumple SRS §7.2 (n_autorizacion_srs en ingresos controlados).
 */
app.post("/recepciones", requireRole("admin", "jefe_farmacia_central"), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RecepcionCompraInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "datos_invalidos", detalle: parsed.error.flatten() }, 400);
  const d = parsed.data;
  const areaDestinoId = Number(body.area_destino_id ?? 0);
  if (!areaDestinoId) return c.json({ error: "area_destino_requerida" }, 400);

  // Validar OC
  const oc = await c.env.DB.prepare(`SELECT id, estado FROM orden_compra WHERE id = ?`)
    .bind(d.orden_compra_id)
    .first<{ id: number; estado: string }>();
  if (!oc) return c.json({ error: "orden_no_encontrada" }, 404);
  if (oc.estado === "cancelada") return c.json({ error: "orden_cancelada" }, 400);

  // Crear cabecera recepcion
  const recIns = await c.env.DB.prepare(
    `INSERT INTO recepcion_compra (orden_id, fecha, n_factura_proveedor, area_destino_id, usuario_id)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      d.orden_compra_id,
      d.fecha,
      d.n_factura_proveedor ?? null,
      areaDestinoId,
      c.get("session")!.usuario_id
    )
    .run();
  const recepcionId = recIns.meta.last_row_id as number;

  for (const item of d.detalles) {
    // Validar producto y categoria
    const prod = await c.env.DB.prepare(
      `SELECT p.id, p.es_controlado, c.requiere_lote_vencimiento
         FROM producto p JOIN categoria_producto c ON c.id = p.categoria_id WHERE p.id = ?`
    )
      .bind(item.producto_id)
      .first<{ id: number; es_controlado: number; requiere_lote_vencimiento: number }>();
    if (!prod) return c.json({ error: "producto_no_encontrado", producto_id: item.producto_id }, 400);

    if (prod.requiere_lote_vencimiento && (!item.lote_numero || !item.fecha_vencimiento)) {
      return c.json({ error: "lote_requerido", producto_id: item.producto_id }, 400);
    }
    if (prod.es_controlado && !item.n_autorizacion_srs) {
      return c.json({ error: "n_autorizacion_srs_requerido", producto_id: item.producto_id }, 400);
    }

    // Lote (si aplica)
    let loteId: number | null = null;
    if (prod.requiere_lote_vencimiento) {
      const existingLote = await c.env.DB.prepare(
        `SELECT id FROM lote WHERE producto_id = ? AND numero_lote = ?`
      )
        .bind(item.producto_id, item.lote_numero)
        .first<{ id: number }>();
      if (existingLote) {
        loteId = existingLote.id;
      } else {
        const li = await c.env.DB.prepare(
          `INSERT INTO lote (producto_id, numero_lote, fecha_vencimiento) VALUES (?, ?, ?)`
        )
          .bind(item.producto_id, item.lote_numero, item.fecha_vencimiento)
          .run();
        loteId = li.meta.last_row_id as number;
      }
    }

    // Detalle recepcion
    await c.env.DB.prepare(
      `INSERT INTO recepcion_compra_detalle
         (recepcion_id, producto_id, lote_numero, fecha_vencimiento, cantidad, costo_unitario, n_autorizacion_srs)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        recepcionId,
        item.producto_id,
        item.lote_numero ?? null,
        item.fecha_vencimiento ?? null,
        item.cantidad,
        item.costo_unitario,
        item.n_autorizacion_srs ?? null
      )
      .run();

    // Recalcular CPP ANTES de sumar existencia (la formula usa existencia previa)
    await recalcCPP(c.env, item.producto_id, item.cantidad, item.costo_unitario);

    // Sumar existencia (area destino + lote)
    const existRow = await c.env.DB.prepare(
      `SELECT id, cantidad FROM existencia
        WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)`
    )
      .bind(item.producto_id, areaDestinoId, loteId)
      .first<{ id: number; cantidad: number }>();
    if (existRow) {
      await c.env.DB.prepare(`UPDATE existencia SET cantidad = cantidad + ? WHERE id = ?`)
        .bind(item.cantidad, existRow.id)
        .run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO existencia (producto_id, area_id, lote_id, cantidad) VALUES (?, ?, ?, ?)`
      )
        .bind(item.producto_id, areaDestinoId, loteId, item.cantidad)
        .run();
    }

    // Movimiento
    await c.env.DB.prepare(
      `INSERT INTO movimiento_inventario
         (tipo, producto_id, lote_id, area_destino_id, cantidad, costo_unitario,
          usuario_id, referencia_tipo, referencia_id, n_autorizacion_srs)
       VALUES ('ingreso_compra', ?, ?, ?, ?, ?, ?, 'orden_compra', ?, ?)`
    )
      .bind(
        item.producto_id,
        loteId,
        areaDestinoId,
        item.cantidad,
        item.costo_unitario,
        c.get("session")!.usuario_id,
        d.orden_compra_id,
        item.n_autorizacion_srs ?? null
      )
      .run();
  }

  // Marcar OC como recibida (simplificado: total). Una mejora seria detectar parcial.
  await c.env.DB.prepare(`UPDATE orden_compra SET estado = 'recibida' WHERE id = ?`)
    .bind(d.orden_compra_id)
    .run();

  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "recibir_compra",
    entidad: "recepcion_compra",
    entidad_id: recepcionId,
    payload: { orden_compra_id: d.orden_compra_id, lineas: d.detalles.length },
    ip: c.get("ip"),
  });

  return c.json({ id: recepcionId, ok: true });
});

export default app;
