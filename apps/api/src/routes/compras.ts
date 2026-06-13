import { Hono } from "hono";
import { RecepcionCompraInput } from "@ais/shared";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole, getInstId } from "../middleware/auth";
import { recalcCPP } from "../lib/cpp";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

// Listar ordenes de compra
app.get("/ordenes", async (c) => {
  const instId = getInstId(c);
  const estado = c.req.query("estado");
  let sql =
    `SELECT oc.id, oc.numero, oc.fecha, oc.estado, oc.subtotal, oc.iva, oc.total,
            pr.nombre AS proveedor
       FROM orden_compra oc
       JOIN proveedor pr ON pr.id = oc.proveedor_id AND pr.institucion_id = oc.institucion_id
      WHERE oc.institucion_id = ?`;
  const binds: unknown[] = [instId];
  if (estado) {
    sql += ` AND oc.estado = ?`;
    binds.push(estado);
  }
  sql += ` ORDER BY oc.fecha DESC, oc.id DESC LIMIT 500`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ data: results });
});

app.get("/ordenes/:id", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const oc = await c.env.DB.prepare(
    `SELECT * FROM orden_compra WHERE id = ? AND institucion_id = ?`
  ).bind(id, instId).first();
  if (!oc) return c.json({ error: "no_encontrado" }, 404);
  const det = await c.env.DB.prepare(
    `SELECT d.*, p.nombre AS producto FROM orden_compra_detalle d
       JOIN producto p ON p.id = d.producto_id AND p.institucion_id = d.institucion_id
      WHERE d.orden_id = ? AND d.institucion_id = ?`
  )
    .bind(id, instId)
    .all();
  const recs = await c.env.DB.prepare(
    `SELECT r.id, r.fecha, r.n_factura_proveedor, r.doc_r2_key,
            a.nombre AS area_destino, u.nombre AS usuario
       FROM recepcion_compra r
       LEFT JOIN area a ON a.id = r.area_destino_id AND a.institucion_id = r.institucion_id
       LEFT JOIN usuario u ON u.id = r.usuario_id
      WHERE r.orden_id = ? AND r.institucion_id = ? ORDER BY r.fecha DESC`
  )
    .bind(id, instId)
    .all();
  return c.json({ orden: oc, detalles: det.results, recepciones: recs.results });
});

// Crear OC
app.post("/ordenes", requireRole("admin", "jefe_farmacia_central"), async (c) => {
  const instId = getInstId(c);
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
    `INSERT INTO orden_compra (numero, proveedor_id, fecha, estado, subtotal, iva, total, usuario_id, observaciones, institucion_id)
     VALUES (?, ?, COALESCE(?, date('now')), 'borrador', ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      numero,
      b.proveedor_id,
      b.fecha ?? null,
      subtotal,
      iva,
      total,
      c.get("session")!.usuario_id,
      b.observaciones ?? null,
      instId
    )
    .run();
  const ordenId = ins.meta.last_row_id as number;

  for (const d of b.detalles) {
    const sub = Number(d.cantidad) * Number(d.costo_unitario);
    await c.env.DB.prepare(
      `INSERT INTO orden_compra_detalle (orden_id, producto_id, cantidad, costo_unitario, subtotal, institucion_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(ordenId, d.producto_id, d.cantidad, d.costo_unitario, sub, instId)
      .run();
  }

  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "crear_orden_compra",
    entidad: "orden_compra",
    entidad_id: ordenId,
    payload: { numero, proveedor_id: b.proveedor_id, total },
    ip: c.get("ip"),
    institucion_id: instId,
  });
  return c.json({ id: ordenId, numero });
});

// Detalle con pendientes por linea de una OC
app.get("/ordenes/:id/pendientes", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const { results } = await c.env.DB.prepare(
    `SELECT d.producto_id, p.nombre AS producto, p.codigo, d.cantidad AS ordenado, d.costo_unitario,
            COALESCE(rcv.recibido, 0) AS recibido,
            MAX(d.cantidad - COALESCE(rcv.recibido, 0), 0) AS pendiente
       FROM orden_compra_detalle d
       JOIN producto p ON p.id = d.producto_id AND p.institucion_id = d.institucion_id
       LEFT JOIN (
         SELECT rd.producto_id, SUM(rd.cantidad) AS recibido
           FROM recepcion_compra_detalle rd
           JOIN recepcion_compra r ON r.id = rd.recepcion_id AND r.institucion_id = rd.institucion_id
          WHERE r.orden_id = ? AND r.institucion_id = ?
          GROUP BY rd.producto_id
       ) rcv ON rcv.producto_id = d.producto_id
      WHERE d.orden_id = ? AND d.institucion_id = ?`
  )
    .bind(id, instId, id, instId)
    .all();
  return c.json({ data: results });
});

// Sugerencias de compra por reorden
app.get("/sugerencias", async (c) => {
  const instId = getInstId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.codigo, p.nombre, p.punto_reorden,
            (SELECT COALESCE(SUM(cantidad), 0) FROM existencia WHERE producto_id = p.id AND institucion_id = p.institucion_id) AS existencia,
            p.proveedor_preferente_id, p.costo_promedio_ponderado
       FROM producto p
      WHERE p.activo = 1 AND p.punto_reorden > 0 AND p.institucion_id = ?
        AND (SELECT COALESCE(SUM(cantidad), 0) FROM existencia WHERE producto_id = p.id AND institucion_id = p.institucion_id) < p.punto_reorden
      ORDER BY p.proveedor_preferente_id, p.nombre`
  ).bind(instId).all();
  return c.json({ data: results });
});

/**
 * Recepcion de compra: descarga del proveedor al area destino,
 * actualiza CPP, crea lote (si aplica), suma existencia y emite movimiento_inventario.
 *
 * Cumple SRS §7.2 (n_autorizacion_srs en ingresos controlados).
 */
app.post("/recepciones", requireRole("admin", "jefe_farmacia_central"), async (c) => {
  const instId = getInstId(c);
  const session = c.get("session")!;
  const body = await c.req.json().catch(() => null);
  const parsed = RecepcionCompraInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "datos_invalidos", detalle: parsed.error.flatten() }, 400);
  const d = parsed.data;
  const areaDestinoId = Number(body.area_destino_id ?? 0);
  if (!areaDestinoId) return c.json({ error: "area_destino_requerida" }, 400);

  // Validar OC
  const oc = await c.env.DB.prepare(
    `SELECT id, estado FROM orden_compra WHERE id = ? AND institucion_id = ?`
  )
    .bind(d.orden_compra_id, instId)
    .first<{ id: number; estado: string }>();
  if (!oc) return c.json({ error: "orden_no_encontrada" }, 404);
  if (oc.estado === "cancelada") return c.json({ error: "orden_cancelada" }, 400);

  // Crear cabecera recepcion
  const recIns = await c.env.DB.prepare(
    `INSERT INTO recepcion_compra (orden_id, fecha, n_factura_proveedor, area_destino_id, usuario_id, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      d.orden_compra_id,
      d.fecha,
      d.n_factura_proveedor ?? null,
      areaDestinoId,
      session.usuario_id,
      instId
    )
    .run();
  const recepcionId = recIns.meta.last_row_id as number;

  for (const item of d.detalles) {
    // Validar producto y categoria; obtener factor de conversion
    const prod = await c.env.DB.prepare(
      `SELECT p.id, p.es_controlado, p.factor_conversion,
              c.requiere_lote_vencimiento
         FROM producto p JOIN categoria_producto c ON c.id = p.categoria_id AND c.institucion_id = p.institucion_id
        WHERE p.id = ? AND p.institucion_id = ?`
    )
      .bind(item.producto_id, instId)
      .first<{ id: number; es_controlado: number; requiere_lote_vencimiento: number; factor_conversion: number }>();
    if (!prod) return c.json({ error: "producto_no_encontrado", producto_id: item.producto_id }, 400);

    if (prod.requiere_lote_vencimiento && (!item.lote_numero || !item.fecha_vencimiento)) {
      return c.json({ error: "lote_requerido", producto_id: item.producto_id }, 400);
    }

    // Conversion: item.cantidad esta en unidades de compra, convertir a unidades de venta
    const factor = (prod.factor_conversion ?? 1) > 0 ? (prod.factor_conversion ?? 1) : 1;
    const cantidadVenta = item.cantidad * factor;

    // Lote (si aplica)
    let loteId: number | null = null;
    if (prod.requiere_lote_vencimiento) {
      const existingLote = await c.env.DB.prepare(
        `SELECT id FROM lote WHERE producto_id = ? AND numero_lote = ? AND institucion_id = ?`
      )
        .bind(item.producto_id, item.lote_numero, instId)
        .first<{ id: number }>();
      if (existingLote) {
        loteId = existingLote.id;
      } else {
        const li = await c.env.DB.prepare(
          `INSERT INTO lote (producto_id, numero_lote, fecha_vencimiento, institucion_id) VALUES (?, ?, ?, ?)`
        )
          .bind(item.producto_id, item.lote_numero, item.fecha_vencimiento, instId)
          .run();
        loteId = li.meta.last_row_id as number;
      }
    }

    // Detalle recepcion: guarda cantidad en unidades de compra, costo por unidad de compra
    await c.env.DB.prepare(
      `INSERT INTO recepcion_compra_detalle
         (recepcion_id, producto_id, lote_numero, fecha_vencimiento, cantidad, costo_unitario, n_autorizacion_srs, institucion_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        recepcionId,
        item.producto_id,
        item.lote_numero ?? null,
        item.fecha_vencimiento ?? null,
        item.cantidad,
        item.costo_unitario,
        item.n_autorizacion_srs ?? null,
        instId
      )
      .run();

    // CPP en unidades de venta — pasa factor para que cpp.ts calcule costo/unidad_venta
    await recalcCPP(c.env, item.producto_id, item.cantidad, item.costo_unitario, factor, instId);

    // Sumar existencia en unidades de venta (area destino + lote)
    const existRow = await c.env.DB.prepare(
      `SELECT id, cantidad FROM existencia
        WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)
          AND institucion_id = ?`
    )
      .bind(item.producto_id, areaDestinoId, loteId, instId)
      .first<{ id: number; cantidad: number }>();
    if (existRow) {
      await c.env.DB.prepare(
        `UPDATE existencia SET cantidad = cantidad + ? WHERE id = ? AND institucion_id = ?`
      )
        .bind(cantidadVenta, existRow.id, instId)
        .run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO existencia (producto_id, area_id, lote_id, cantidad, institucion_id) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(item.producto_id, areaDestinoId, loteId, cantidadVenta, instId)
        .run();
    }

    // Movimiento en unidades de venta; costo_unitario = por unidad de venta (costo_compra/factor)
    const costoVenta = Math.round((item.costo_unitario / factor) * 1e6) / 1e6;
    await c.env.DB.prepare(
      `INSERT INTO movimiento_inventario
         (tipo, producto_id, lote_id, area_destino_id, cantidad, costo_unitario,
          usuario_id, referencia_tipo, referencia_id, n_autorizacion_srs, institucion_id)
       VALUES ('ingreso_compra', ?, ?, ?, ?, ?, ?, 'orden_compra', ?, ?, ?)`
    )
      .bind(
        item.producto_id,
        loteId,
        areaDestinoId,
        cantidadVenta,
        costoVenta,
        session.usuario_id,
        d.orden_compra_id,
        item.n_autorizacion_srs ?? null,
        instId
      )
      .run();
  }

  // Estado de la OC segun cantidades recibidas acumuladas vs ordenadas
  const pendientes = await c.env.DB.prepare(
    `SELECT
        SUM(MAX(d.cantidad - COALESCE(rcv.recibido, 0), 0)) AS pendiente,
        SUM(COALESCE(rcv.recibido, 0)) AS recibido_total
       FROM orden_compra_detalle d
       LEFT JOIN (
         SELECT rd.producto_id, SUM(rd.cantidad) AS recibido
           FROM recepcion_compra_detalle rd
           JOIN recepcion_compra r ON r.id = rd.recepcion_id AND r.institucion_id = rd.institucion_id
          WHERE r.orden_id = ? AND r.institucion_id = ?
          GROUP BY rd.producto_id
       ) rcv ON rcv.producto_id = d.producto_id
      WHERE d.orden_id = ? AND d.institucion_id = ?`
  )
    .bind(d.orden_compra_id, instId, d.orden_compra_id, instId)
    .first<{ pendiente: number; recibido_total: number }>();
  const nuevoEstado =
    (pendientes?.pendiente ?? 0) <= 0 ? "recibida" :
    (pendientes?.recibido_total ?? 0) > 0 ? "recibida_parcial" : oc.estado;
  await c.env.DB.prepare(
    `UPDATE orden_compra SET estado = ? WHERE id = ? AND institucion_id = ?`
  )
    .bind(nuevoEstado, d.orden_compra_id, instId)
    .run();

  await logAudit(c.env, {
    usuario_id: session.usuario_id,
    accion: "recibir_compra",
    entidad: "recepcion_compra",
    entidad_id: recepcionId,
    payload: { orden_compra_id: d.orden_compra_id, lineas: d.detalles.length },
    ip: c.get("ip"),
    institucion_id: instId,
  });

  return c.json({ id: recepcionId, ok: true });
});

// Subir factura del proveedor (PDF/imagen) a R2 asociado a la recepcion
app.post(
  "/recepciones/:id/factura",
  requireRole("admin", "jefe_farmacia_central"),
  async (c) => {
    const instId = getInstId(c);
    const session = c.get("session")!;
    const id = parseInt(c.req.param("id"), 10);
    const rec = await c.env.DB.prepare(
      `SELECT id FROM recepcion_compra WHERE id = ? AND institucion_id = ?`
    ).bind(id, instId).first();
    if (!rec) return c.json({ error: "recepcion_no_encontrada" }, 404);

    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file") as unknown as
      | { name: string; size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> }
      | null;
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      return c.json({ error: "archivo_requerido" }, 400);
    }
    if (file.size > 10 * 1024 * 1024) return c.json({ error: "archivo_muy_grande_10mb_max" }, 400);

    const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
    const key = `${session.institucion_slug}/recepciones/${id}/${Date.now()}.${ext}`;
    await c.env.DOCS.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    await c.env.DB.prepare(
      `UPDATE recepcion_compra SET doc_r2_key = ? WHERE id = ? AND institucion_id = ?`
    )
      .bind(key, id, instId)
      .run();
    return c.json({ ok: true, key });
  }
);

// Descargar factura del proveedor desde R2
app.get("/recepciones/:id/factura", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const row = await c.env.DB.prepare(
    `SELECT doc_r2_key FROM recepcion_compra WHERE id = ? AND institucion_id = ?`
  )
    .bind(id, instId)
    .first<{ doc_r2_key: string | null }>();
  if (!row?.doc_r2_key) return c.json({ error: "sin_documento" }, 404);
  const obj = await c.env.DOCS.get(row.doc_r2_key);
  if (!obj) return c.json({ error: "no_encontrado_en_r2" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${row.doc_r2_key.split("/").pop()}"`,
    },
  });
});

// Cancelar OC (solo si no tiene recepciones)
app.post("/ordenes/:id/cancelar", requireRole("admin", "jefe_farmacia_central"), async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const r = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM recepcion_compra WHERE orden_id = ? AND institucion_id = ?`
  )
    .bind(id, instId)
    .first<{ n: number }>();
  if ((r?.n ?? 0) > 0) return c.json({ error: "tiene_recepciones_no_se_puede_cancelar" }, 400);
  await c.env.DB.prepare(
    `UPDATE orden_compra SET estado = 'cancelada' WHERE id = ? AND institucion_id = ?`
  )
    .bind(id, instId)
    .run();
  return c.json({ ok: true });
});

export default app;
