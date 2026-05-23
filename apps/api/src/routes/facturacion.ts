import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole, getInstId } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

/**
 * Genera factura a partir de los consumos no facturados de un episodio
 * + cargos manuales opcionales (servicios, cirugia, etc.).
 *
 * Body: { episodio_id, iva_pct?, cargos_extra?: [{descripcion, cantidad, precio_unitario}] }
 */
app.post("/facturas", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const b = await c.req.json().catch(() => null);
  if (!b?.episodio_id) return c.json({ error: "episodio_id_requerido" }, 400);
  const ivaPct = Number(b.iva_pct ?? 13); // El Salvador default 13%
  const cargosExtra: { descripcion: string; cantidad: number; precio_unitario: number }[] =
    Array.isArray(b.cargos_extra) ? b.cargos_extra : [];

  const ep = await c.env.DB.prepare(
    `SELECT id, paciente_id FROM episodio_atencion WHERE id = ? AND institucion_id = ?`
  )
    .bind(b.episodio_id, instId)
    .first<{ id: number; paciente_id: number }>();
  if (!ep) return c.json({ error: "episodio_no_encontrado" }, 404);

  const consumos = await c.env.DB.prepare(
    `SELECT cp.id, cp.cantidad, cp.precio_venta_snapshot, p.nombre AS producto
       FROM consumo_paciente cp
       JOIN producto p ON p.id = cp.producto_id
      WHERE cp.episodio_id = ? AND cp.factura_detalle_id IS NULL AND cp.institucion_id = ?`
  )
    .bind(ep.id, instId)
    .all<{ id: number; cantidad: number; precio_venta_snapshot: number; producto: string }>();

  // Ocupaciones de habitacion CERRADAS y no facturadas del episodio
  const ocupaciones = await c.env.DB.prepare(
    `SELECT o.id, o.precio_diario_snapshot,
            h.numero AS habitacion, h.tipo AS habitacion_tipo,
            o.fecha_ingreso, o.fecha_egreso,
            MAX(CAST((julianday(o.fecha_egreso) - julianday(o.fecha_ingreso)) AS INTEGER), 1) AS dias
       FROM ocupacion_habitacion o
       JOIN habitacion h ON h.id = o.habitacion_id
      WHERE o.episodio_id = ?
        AND o.factura_detalle_id IS NULL
        AND o.fecha_egreso IS NOT NULL
        AND o.institucion_id = ?`
  )
    .bind(ep.id, instId)
    .all<{
      id: number;
      precio_diario_snapshot: number;
      habitacion: string;
      habitacion_tipo: string;
      dias: number;
      fecha_ingreso: string;
      fecha_egreso: string;
    }>();

  if (!consumos.results?.length && !cargosExtra.length && !ocupaciones.results?.length) {
    return c.json({ error: "nada_para_facturar" }, 400);
  }

  let subtotal = 0;
  for (const c0 of consumos.results ?? []) subtotal += c0.cantidad * c0.precio_venta_snapshot;
  for (const o of ocupaciones.results ?? []) subtotal += o.dias * o.precio_diario_snapshot;
  for (const e of cargosExtra) subtotal += e.cantidad * e.precio_unitario;
  // Prices include IVA — extract base and tax from inclusive total
  const total = +subtotal.toFixed(2);
  const subtotalBase = +(total / (1 + ivaPct / 100)).toFixed(2);
  const iva = +(total - subtotalBase).toFixed(2);
  const numero = `F-${Date.now()}`;

  const f = await c.env.DB.prepare(
    `INSERT INTO factura (numero, paciente_id, episodio_id, subtotal, iva, total, usuario_id, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(numero, ep.paciente_id, ep.id, subtotalBase, iva, total, c.get("session")!.usuario_id, instId)
    .run();
  const facturaId = f.meta.last_row_id as number;

  for (const c0 of consumos.results ?? []) {
    const sub = c0.cantidad * c0.precio_venta_snapshot;
    const ins = await c.env.DB.prepare(
      `INSERT INTO factura_detalle (factura_id, consumo_id, descripcion, cantidad, precio_unitario, subtotal, institucion_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(facturaId, c0.id, c0.producto, c0.cantidad, c0.precio_venta_snapshot, sub, instId)
      .run();
    await c.env.DB.prepare(`UPDATE consumo_paciente SET factura_detalle_id = ? WHERE id = ? AND institucion_id = ?`)
      .bind(ins.meta.last_row_id, c0.id, instId)
      .run();
  }
  for (const o of ocupaciones.results ?? []) {
    const sub = o.dias * o.precio_diario_snapshot;
    const ins = await c.env.DB.prepare(
      `INSERT INTO factura_detalle (factura_id, descripcion, cantidad, precio_unitario, subtotal, institucion_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        facturaId,
        `Habitacion ${o.habitacion} (${o.habitacion_tipo}) - ${o.dias} dia(s)`,
        o.dias,
        o.precio_diario_snapshot,
        sub,
        instId
      )
      .run();
    await c.env.DB.prepare(`UPDATE ocupacion_habitacion SET factura_detalle_id = ? WHERE id = ? AND institucion_id = ?`)
      .bind(ins.meta.last_row_id, o.id, instId)
      .run();
  }
  for (const e of cargosExtra) {
    await c.env.DB.prepare(
      `INSERT INTO factura_detalle (factura_id, descripcion, cantidad, precio_unitario, subtotal, institucion_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(facturaId, e.descripcion, e.cantidad, e.precio_unitario, e.cantidad * e.precio_unitario, instId)
      .run();
  }

  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "emitir_factura",
    entidad: "factura",
    entidad_id: facturaId,
    payload: { numero, total },
    ip: c.get("ip"),
    institucion_id: instId,
  });

  return c.json({ id: facturaId, numero, subtotal: subtotalBase, iva, total });
});

app.get("/facturas", async (c) => {
  const instId = getInstId(c);
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const estado = c.req.query("estado");
  const filt: string[] = ["f.institucion_id = ?"];
  const binds: unknown[] = [instId];
  if (desde) { filt.push("date(f.fecha) >= ?"); binds.push(desde); }
  if (hasta) { filt.push("date(f.fecha) <= ?"); binds.push(hasta); }
  if (estado) { filt.push("f.estado = ?"); binds.push(estado); }
  const { results } = await c.env.DB.prepare(
    `SELECT f.*, p.nombres || ' ' || p.apellidos AS paciente
       FROM factura f
       JOIN paciente p ON p.id = f.paciente_id
      WHERE ${filt.join(" AND ")}
      ORDER BY f.fecha DESC LIMIT 500`
  )
    .bind(...binds)
    .all();
  return c.json({ data: results });
});

app.get("/facturas/:id", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const f = await c.env.DB.prepare(`SELECT * FROM factura WHERE id = ? AND institucion_id = ?`).bind(id, instId).first();
  if (!f) return c.json({ error: "no_encontrado" }, 404);
  const det = await c.env.DB.prepare(`SELECT * FROM factura_detalle WHERE factura_id = ? AND institucion_id = ?`).bind(id, instId).all();
  const pagos = await c.env.DB.prepare(`SELECT * FROM pago WHERE factura_id = ? AND institucion_id = ?`).bind(id, instId).all();
  return c.json({ factura: f, detalles: det.results, pagos: pagos.results });
});

app.post("/facturas/:id/pagos", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => null);
  if (!b?.metodo || !b?.monto) return c.json({ error: "datos_invalidos" }, 400);
  const f = await c.env.DB.prepare(`SELECT id, total, estado FROM factura WHERE id = ? AND institucion_id = ?`)
    .bind(id, instId)
    .first<{ id: number; total: number; estado: string }>();
  if (!f) return c.json({ error: "factura_no_encontrada" }, 404);
  if (f.estado === "anulada") return c.json({ error: "factura_anulada" }, 400);

  await c.env.DB.prepare(
    `INSERT INTO pago (factura_id, metodo, monto, referencia, usuario_id, institucion_id) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, b.metodo, b.monto, b.referencia ?? null, c.get("session")!.usuario_id, instId)
    .run();
  const totPag = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(monto),0) AS s FROM pago WHERE factura_id = ? AND institucion_id = ?`
  )
    .bind(id, instId)
    .first<{ s: number }>();
  if ((totPag?.s ?? 0) >= f.total) {
    await c.env.DB.prepare(`UPDATE factura SET estado='pagada' WHERE id = ? AND institucion_id = ?`).bind(id, instId).run();
  }
  return c.json({ ok: true });
});

app.post("/facturas/:id/anular", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  await c.env.DB.prepare(`UPDATE factura SET estado='anulada' WHERE id = ? AND institucion_id = ?`).bind(id, instId).run();
  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "anular_factura",
    entidad: "factura",
    entidad_id: id,
    ip: c.get("ip"),
    institucion_id: instId,
  });
  return c.json({ ok: true });
});

// Retorna episodios con alta solicitada pendientes de revision/facturacion
app.get("/pendientes-alta", async (c) => {
  const instId = getInstId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT e.id AS episodio_id, e.fecha_inicio, e.alta_solicitada_en,
            p.id AS paciente_id, p.expediente, p.nombres, p.apellidos,
            cur_hab.numero AS habitacion, cur_hab.tipo AS habitacion_tipo,
            pm.nombres || ' ' || pm.apellidos AS medico_cabecera,
            ROUND(COALESCE((
              SELECT SUM(cp2.precio_venta_snapshot * cp2.cantidad)
              FROM consumo_paciente cp2
              WHERE cp2.episodio_id = e.id AND cp2.factura_detalle_id IS NULL AND cp2.institucion_id = ?
            ), 0), 2) AS cargos_consumos,
            ROUND(COALESCE((
              SELECT SUM(
                MAX(CAST((julianday(COALESCE(oh2.fecha_egreso, datetime('now'))) - julianday(oh2.fecha_ingreso)) AS INTEGER), 1)
                * oh2.precio_diario_snapshot
              )
              FROM ocupacion_habitacion oh2
              WHERE oh2.episodio_id = e.id AND oh2.factura_detalle_id IS NULL AND oh2.institucion_id = ?
            ), 0), 2) AS cargos_habitacion,
            (SELECT COUNT(*) FROM devolucion_pendiente dp
               JOIN consumo_paciente cp3 ON cp3.id = dp.consumo_id
              WHERE cp3.episodio_id = e.id AND dp.estado = 'pendiente' AND dp.institucion_id = ?) AS devoluciones_pendientes,
            (SELECT COUNT(*) FROM requisicion r2
              WHERE r2.episodio_id = e.id AND r2.estado IN ('pendiente', 'despachada_parcial') AND r2.institucion_id = ?) AS requisiciones_activas
       FROM episodio_atencion e
       JOIN paciente p ON p.id = e.paciente_id
       LEFT JOIN ocupacion_habitacion cur_occ ON cur_occ.paciente_id = p.id AND cur_occ.fecha_egreso IS NULL AND cur_occ.institucion_id = ?
       LEFT JOIN habitacion cur_hab ON cur_hab.id = cur_occ.habitacion_id AND cur_hab.institucion_id = ?
       LEFT JOIN profesional_medico pm ON pm.id = e.medico_id AND pm.institucion_id = ?
      WHERE e.alta_solicitada_en IS NOT NULL AND e.estado = 'activo' AND e.institucion_id = ?
      ORDER BY e.alta_solicitada_en ASC`
  ).bind(instId, instId, instId, instId, instId, instId, instId, instId).all();
  return c.json({ data: results });
});

// Resumen de cuenta por categoria para el modal de revision antes de facturar
app.get("/episodios/:id/resumen-cuenta", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const epInfo = await c.env.DB.prepare(
    `SELECT e.id, e.fecha_inicio, e.alta_solicitada_en,
            p.id AS paciente_id, p.nombres, p.apellidos, p.expediente,
            p.documento_tipo, p.documento_numero,
            pm.nombres || ' ' || pm.apellidos AS medico
       FROM episodio_atencion e
       JOIN paciente p ON p.id = e.paciente_id
       LEFT JOIN profesional_medico pm ON pm.id = e.medico_id
      WHERE e.id = ? AND e.institucion_id = ?`
  ).bind(id, instId).first();

  // Product lines consolidated by (producto_id, precio) per category
  const { results: lineas } = await c.env.DB.prepare(
    `SELECT cat.id AS categoria_id, cat.nombre AS categoria,
            cp.producto_id, p.nombre AS producto, p.codigo,
            cp.precio_venta_snapshot AS precio_unitario,
            SUM(cp.cantidad) AS cantidad,
            ROUND(SUM(cp.cantidad * cp.precio_venta_snapshot), 2) AS subtotal
       FROM consumo_paciente cp
       JOIN producto p ON p.id = cp.producto_id
       JOIN categoria_producto cat ON cat.id = p.categoria_id
      WHERE cp.episodio_id = ? AND cp.factura_detalle_id IS NULL AND cp.institucion_id = ?
      GROUP BY cat.id, cat.nombre, cp.producto_id, cp.precio_venta_snapshot
      ORDER BY cat.nombre, p.nombre`
  ).bind(id, instId).all<{
    categoria_id: number; categoria: string;
    producto_id: number; producto: string; codigo: string;
    precio_unitario: number; cantidad: number; subtotal: number;
  }>();

  type ProductoLinea = {
    producto_id: number | null; producto: string; codigo: string;
    cantidad: number; precio_unitario: number; subtotal: number;
  };
  type CatEntry = {
    categoria_id: number; categoria: string; subtotal: number;
    items: number; productos: ProductoLinea[];
  };
  const catMap = new Map<number, CatEntry>();
  for (const linea of lineas ?? []) {
    const prev: CatEntry = catMap.get(linea.categoria_id) ?? {
      categoria_id: linea.categoria_id, categoria: linea.categoria,
      subtotal: 0, items: 0, productos: [],
    };
    prev.subtotal = +(prev.subtotal + Number(linea.subtotal)).toFixed(2);
    prev.items += 1;
    prev.productos.push({
      producto_id: linea.producto_id, producto: linea.producto, codigo: linea.codigo,
      cantidad: Number(linea.cantidad), precio_unitario: Number(linea.precio_unitario),
      subtotal: Number(linea.subtotal),
    });
    catMap.set(linea.categoria_id, prev);
  }

  // Habitacion lines
  const { results: habLineas } = await c.env.DB.prepare(
    `SELECT h.numero AS habitacion, h.tipo AS habitacion_tipo,
            o.precio_diario_snapshot,
            MAX(CAST((julianday(COALESCE(o.fecha_egreso,datetime('now')))-julianday(o.fecha_ingreso)) AS INTEGER),1) AS dias
       FROM ocupacion_habitacion o
       JOIN habitacion h ON h.id = o.habitacion_id
      WHERE o.episodio_id = ? AND o.factura_detalle_id IS NULL AND o.institucion_id = ?
      ORDER BY o.fecha_ingreso`
  ).bind(id, instId).all<{ habitacion: string; habitacion_tipo: string; precio_diario_snapshot: number; dias: number }>();

  let habitacionSubtotal = 0;
  const habProductos: ProductoLinea[] = [];
  for (const o of habLineas ?? []) {
    const sub = +(o.dias * o.precio_diario_snapshot).toFixed(2);
    habitacionSubtotal += sub;
    habProductos.push({
      producto_id: null,
      producto: `Habitacion ${o.habitacion} (${o.habitacion_tipo})`,
      codigo: "",
      cantidad: Number(o.dias),
      precio_unitario: Number(o.precio_diario_snapshot),
      subtotal: sub,
    });
  }

  const categorias = [...catMap.values()].sort((a, b) => a.categoria.localeCompare(b.categoria));
  if (habitacionSubtotal > 0) {
    categorias.push({
      categoria_id: -1, categoria: "Habitacion",
      subtotal: +habitacionSubtotal.toFixed(2),
      items: habProductos.length, productos: habProductos,
    });
  }

  const subtotalConsumos = categorias.filter((c) => c.categoria_id !== -1).reduce((s, c) => s + c.subtotal, 0);
  return c.json({
    episodio: epInfo,
    categorias,
    subtotal_consumos: +subtotalConsumos.toFixed(2),
    subtotal_total: +(subtotalConsumos + habitacionSubtotal).toFixed(2),
  });
});

// Conteo ligero para badge en menu
app.get("/_alta_count", async (c) => {
  const instId = getInstId(c);
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM episodio_atencion WHERE alta_solicitada_en IS NOT NULL AND estado = 'activo' AND institucion_id = ?`
  ).bind(instId).first<{ n: number }>();
  return c.json({ n: row?.n ?? 0 });
});

// Cierra y factura: egresa habitacion activa del episodio, genera la factura,
// cierra el episodio. Documento interno (sin valor fiscal).
app.post(
  "/episodios/:id/cerrar-y-facturar",
  requireRole("admin", "facturacion"),
  async (c) => {
    const instId = getInstId(c);
    const epId = parseInt(c.req.param("id"), 10);
    const body = await c.req.json().catch(() => ({}));
    const ivaPct = Number(body.iva_pct ?? 13);
    const cargosExtra: { descripcion: string; cantidad: number; precio_unitario: number }[] =
      Array.isArray(body.cargos_extra) ? body.cargos_extra : [];

    const ep = await c.env.DB.prepare(
      `SELECT id, paciente_id, estado, alta_solicitada_en FROM episodio_atencion WHERE id = ? AND institucion_id = ?`
    )
      .bind(epId, instId)
      .first<{ id: number; paciente_id: number; estado: string; alta_solicitada_en: string | null }>();
    if (!ep) return c.json({ error: "episodio_no_encontrado" }, 404);
    if (ep.estado !== "activo") return c.json({ error: "episodio_no_activo" }, 400);
    if (!ep.alta_solicitada_en) return c.json({ error: "alta_no_solicitada", mensaje: "Enfermeria debe solicitar el alta antes de facturar" }, 400);

    // Bloquear si hay devoluciones pendientes o requisiciones activas
    const devRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM devolucion_pendiente dp
         JOIN consumo_paciente cp ON cp.id = dp.consumo_id
        WHERE cp.episodio_id = ? AND dp.estado = 'pendiente' AND dp.institucion_id = ?`
    ).bind(epId, instId).first<{ n: number }>();
    if ((devRow?.n ?? 0) > 0) {
      return c.json({ error: "devoluciones_pendientes", mensaje: `Hay ${devRow!.n} devolucion(es) pendiente(s) de procesar en farmacia` }, 400);
    }
    const reqRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM requisicion
        WHERE episodio_id = ? AND estado IN ('pendiente', 'despachada_parcial') AND institucion_id = ?`
    ).bind(epId, instId).first<{ n: number }>();
    if ((reqRow?.n ?? 0) > 0) {
      return c.json({ error: "requisiciones_activas", mensaje: `Hay ${reqRow!.n} requisicion(es) activa(s) sin completar` }, 400);
    }

    // Egresar habitacion activa del paciente (libera cama y la vuelve facturable)
    await c.env.DB.prepare(
      `UPDATE ocupacion_habitacion
          SET fecha_egreso = datetime('now')
        WHERE paciente_id = ? AND fecha_egreso IS NULL AND institucion_id = ?`
    )
      .bind(ep.paciente_id, instId)
      .run();

    // Asociar ocupaciones que no tengan episodio_id pero pertenezcan a este paciente
    // y esten cerradas sin factura, al episodio actual (cubre flujo viejo).
    await c.env.DB.prepare(
      `UPDATE ocupacion_habitacion
          SET episodio_id = ?
        WHERE paciente_id = ? AND episodio_id IS NULL AND factura_detalle_id IS NULL AND institucion_id = ?`
    )
      .bind(ep.id, ep.paciente_id, instId)
      .run();

    // Cargos no facturados (con categoria para aplicar descuentos)
    const consumos = await c.env.DB.prepare(
      `SELECT cp.id, cp.cantidad, cp.precio_venta_snapshot, p.nombre AS producto,
              cat.nombre AS categoria
         FROM consumo_paciente cp
         JOIN producto p ON p.id = cp.producto_id
         JOIN categoria_producto cat ON cat.id = p.categoria_id
        WHERE cp.episodio_id = ? AND cp.factura_detalle_id IS NULL AND cp.institucion_id = ?`
    )
      .bind(ep.id, instId)
      .all<{ id: number; cantidad: number; precio_venta_snapshot: number; producto: string; categoria: string }>();

    const ocupaciones = await c.env.DB.prepare(
      `SELECT o.id, o.precio_diario_snapshot, h.numero AS habitacion, h.tipo AS habitacion_tipo,
              o.fecha_ingreso, o.fecha_egreso,
              MAX(CAST((julianday(o.fecha_egreso) - julianday(o.fecha_ingreso)) AS INTEGER), 1) AS dias
         FROM ocupacion_habitacion o
         JOIN habitacion h ON h.id = o.habitacion_id
        WHERE o.episodio_id = ? AND o.factura_detalle_id IS NULL AND o.fecha_egreso IS NOT NULL AND o.institucion_id = ?`
    )
      .bind(ep.id, instId)
      .all<{
        id: number; precio_diario_snapshot: number; habitacion: string; habitacion_tipo: string;
        fecha_ingreso: string; fecha_egreso: string; dias: number;
      }>();

    // Subtotales brutos por categoria
    const catSubtotals = new Map<string, number>();
    for (const c0 of consumos.results ?? []) {
      catSubtotals.set(c0.categoria, +((catSubtotals.get(c0.categoria) ?? 0) + c0.cantidad * c0.precio_venta_snapshot));
    }
    let habitacionSubtotal = 0;
    for (const o of ocupaciones.results ?? []) habitacionSubtotal += o.dias * o.precio_diario_snapshot;
    if (habitacionSubtotal > 0) catSubtotals.set("Habitacion", +habitacionSubtotal.toFixed(2));
    let subtotalBruto = 0;
    for (const [, sub] of catSubtotals) subtotalBruto += sub;
    for (const e of cargosExtra) subtotalBruto += e.cantidad * e.precio_unitario;

    // Descuentos
    type DescIn = { tipo: string; valor: number };
    const calcDescMonto = (base: number, d: DescIn) =>
      d.tipo === "pct" ? +(base * d.valor / 100).toFixed(2) : +Math.min(d.valor, base).toFixed(2);

    const descGlobal: DescIn | null =
      body.descuento_global && Number(body.descuento_global.valor) > 0 ? body.descuento_global : null;
    const descCatArr: Array<{ categoria: string; tipo: string; valor: number }> =
      Array.isArray(body.descuentos_categoria)
        ? body.descuentos_categoria.filter((d: any) => Number(d.valor) > 0)
        : [];

    const catDescuentoMap = new Map<string, { label: string; monto: number }>();
    for (const dc of descCatArr) {
      const catSub = catSubtotals.get(dc.categoria) ?? 0;
      if (!catSub) continue;
      const monto = calcDescMonto(catSub, dc);
      if (!monto) continue;
      catDescuentoMap.set(dc.categoria, {
        label: `Descuento ${dc.categoria} (${dc.tipo === "pct" ? dc.valor + "%" : "$" + monto.toFixed(2)})`,
        monto,
      });
    }
    const totalDescCat = [...catDescuentoMap.values()].reduce((s, d) => s + d.monto, 0);
    const subtotalAfterCat = +(subtotalBruto - totalDescCat).toFixed(2);

    let globalDescMonto = 0;
    let globalDescLabel = "";
    if (descGlobal) {
      globalDescMonto = calcDescMonto(subtotalAfterCat, descGlobal);
      if (globalDescMonto > 0)
        globalDescLabel = `Descuento general (${descGlobal.tipo === "pct" ? descGlobal.valor + "%" : "$" + globalDescMonto.toFixed(2)})`;
    }

    const subtotalNeto = +(subtotalAfterCat - globalDescMonto).toFixed(2);

    if (subtotalNeto === 0 && !body.permitir_cero) {
      return c.json({ error: "nada_para_facturar", hint: "use permitir_cero=true para cerrar sin cargos" }, 400);
    }

    // Prices include IVA — extract base and tax from inclusive total
    const total = +subtotalNeto.toFixed(2);
    const subtotalBase = +(total / (1 + ivaPct / 100)).toFixed(2);
    const iva = +(total - subtotalBase).toFixed(2);
    const numero = `F-${Date.now()}`;

    const f = await c.env.DB.prepare(
      `INSERT INTO factura (numero, paciente_id, episodio_id, subtotal, iva, total, usuario_id, observaciones, institucion_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Cierre de cuenta - alta', ?)`
    )
      .bind(numero, ep.paciente_id, ep.id, subtotalBase, iva, total, c.get("session")!.usuario_id, instId)
      .run();
    const facturaId = f.meta.last_row_id as number;

    for (const c0 of consumos.results ?? []) {
      const sub = c0.cantidad * c0.precio_venta_snapshot;
      const ins = await c.env.DB.prepare(
        `INSERT INTO factura_detalle (factura_id, consumo_id, descripcion, cantidad, precio_unitario, subtotal, institucion_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(facturaId, c0.id, c0.producto, c0.cantidad, c0.precio_venta_snapshot, sub, instId)
        .run();
      await c.env.DB.prepare(`UPDATE consumo_paciente SET factura_detalle_id = ? WHERE id = ? AND institucion_id = ?`)
        .bind(ins.meta.last_row_id, c0.id, instId)
        .run();
    }
    for (const o of ocupaciones.results ?? []) {
      const sub = o.dias * o.precio_diario_snapshot;
      const ins = await c.env.DB.prepare(
        `INSERT INTO factura_detalle (factura_id, descripcion, cantidad, precio_unitario, subtotal, institucion_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(
          facturaId,
          `Habitacion ${o.habitacion} (${o.habitacion_tipo}) - ${o.dias} dia(s)`,
          o.dias,
          o.precio_diario_snapshot,
          sub,
          instId
        )
        .run();
      await c.env.DB.prepare(`UPDATE ocupacion_habitacion SET factura_detalle_id = ? WHERE id = ? AND institucion_id = ?`)
        .bind(ins.meta.last_row_id, o.id, instId)
        .run();
    }
    for (const e of cargosExtra) {
      await c.env.DB.prepare(
        `INSERT INTO factura_detalle (factura_id, descripcion, cantidad, precio_unitario, subtotal, institucion_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(facturaId, e.descripcion, e.cantidad, e.precio_unitario, e.cantidad * e.precio_unitario, instId)
        .run();
    }
    // Descuentos por categoria
    for (const [, desc] of catDescuentoMap) {
      await c.env.DB.prepare(
        `INSERT INTO factura_detalle (factura_id, descripcion, cantidad, precio_unitario, subtotal, institucion_id)
         VALUES (?, ?, 1, ?, ?, ?)`
      ).bind(facturaId, desc.label, -desc.monto, -desc.monto, instId).run();
    }
    // Descuento global
    if (globalDescMonto > 0) {
      await c.env.DB.prepare(
        `INSERT INTO factura_detalle (factura_id, descripcion, cantidad, precio_unitario, subtotal, institucion_id)
         VALUES (?, ?, 1, ?, ?, ?)`
      ).bind(facturaId, globalDescLabel, -globalDescMonto, -globalDescMonto, instId).run();
    }

    await c.env.DB.prepare(
      `UPDATE episodio_atencion SET estado='cerrado', fecha_fin=datetime('now') WHERE id = ? AND institucion_id = ?`
    )
      .bind(ep.id, instId)
      .run();

    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "cerrar_y_facturar",
      entidad: "episodio_atencion",
      entidad_id: ep.id,
      payload: { factura_id: facturaId, total, descuentos: totalDescCat + globalDescMonto },
      ip: c.get("ip"),
      institucion_id: instId,
    });

    return c.json({ ok: true, factura_id: facturaId, numero, subtotal: subtotalBase, iva, total });
  }
);

// Lista de consumos no facturados de un episodio (para edicion en cola de alta)
app.get("/episodios/:id/consumos-pendientes", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const { results } = await c.env.DB.prepare(
    `SELECT cp.id, cp.producto_id, cp.cantidad, cp.precio_venta_snapshot,
            cp.lote_id, cp.area_id,
            p.nombre AS producto, p.codigo,
            l.numero_lote, l.fecha_vencimiento AS lote_vencimiento,
            cat.requiere_lote_vencimiento, cat.es_servicio
       FROM consumo_paciente cp
       JOIN producto p ON p.id = cp.producto_id
       JOIN categoria_producto cat ON cat.id = p.categoria_id
       LEFT JOIN lote l ON l.id = cp.lote_id
      WHERE cp.episodio_id = ? AND cp.factura_detalle_id IS NULL AND cp.institucion_id = ?
      ORDER BY cp.fecha ASC`
  ).bind(id, instId).all();
  return c.json({ data: results });
});

// Lotes del producto de un consumo (para selector al editar)
app.get("/consumos/:id/lotes-producto", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const cp = await c.env.DB.prepare(
    `SELECT producto_id, lote_id FROM consumo_paciente WHERE id = ? AND institucion_id = ?`
  ).bind(id, instId).first<{ producto_id: number; lote_id: number | null }>();
  if (!cp) return c.json({ error: "no_encontrado" }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.numero_lote, l.fecha_vencimiento,
            ROUND(COALESCE(SUM(e.cantidad), 0), 4) AS stock_total
       FROM lote l
       LEFT JOIN existencia e ON e.lote_id = l.id AND e.institucion_id = ?
      WHERE l.producto_id = ? AND l.institucion_id = ?
      GROUP BY l.id
      ORDER BY l.fecha_vencimiento ASC`
  ).bind(instId, cp.producto_id, instId).all();
  return c.json({ data: results, lote_actual_id: cp.lote_id });
});

// Editar cantidad y/o precio de un consumo pendiente de facturar
app.put("/consumos/:id", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json().catch(() => ({}));

  const cp = await c.env.DB.prepare(
    `SELECT cp.id, cp.cantidad, cp.precio_venta_snapshot, cp.lote_id, cp.area_id,
            cp.factura_detalle_id, cp.episodio_id, cp.producto_id, cp.costo_unitario_snapshot,
            cat.requiere_lote_vencimiento
       FROM consumo_paciente cp
       JOIN producto p ON p.id = cp.producto_id
       JOIN categoria_producto cat ON cat.id = p.categoria_id
      WHERE cp.id = ? AND cp.institucion_id = ?`
  ).bind(id, instId).first<{
    id: number; cantidad: number; precio_venta_snapshot: number;
    lote_id: number | null; area_id: number; factura_detalle_id: number | null;
    episodio_id: number; producto_id: number; costo_unitario_snapshot: number;
    requiere_lote_vencimiento: number;
  }>();
  if (!cp) return c.json({ error: "no_encontrado" }, 404);
  if (cp.factura_detalle_id) return c.json({ error: "ya_facturado" }, 400);

  const nuevaCantidad = Number(body.nueva_cantidad);
  if (!nuevaCantidad || nuevaCantidad <= 0) return c.json({ error: "cantidad_invalida" }, 400);

  if (cp.requiere_lote_vencimiento) {
    const justificacion = String(body.justificacion ?? "").trim();
    if (justificacion.length < 15)
      return c.json({ error: "La justificacion debe tener al menos 15 caracteres" }, 400);
    const ajusteLoteId = body.ajuste_lote_id ? Number(body.ajuste_lote_id) : cp.lote_id;
    if (!ajusteLoteId) return c.json({ error: "lote_requerido" }, 400);

    const delta = nuevaCantidad - cp.cantidad;
    if (delta !== 0) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO existencia (producto_id, area_id, lote_id, cantidad, institucion_id) VALUES (?, ?, ?, 0, ?)`
      ).bind(cp.producto_id, cp.area_id, ajusteLoteId, instId).run();
      // -delta: si delta<0 (reducimos), devolvemos stock (+); si delta>0 (aumentamos), sacamos stock (-)
      await c.env.DB.prepare(
        `UPDATE existencia SET cantidad = cantidad + ? WHERE producto_id = ? AND area_id = ? AND lote_id = ? AND institucion_id = ?`
      ).bind(-delta, cp.producto_id, cp.area_id, ajusteLoteId, instId).run();
      await c.env.DB.prepare(
        `INSERT INTO movimiento_inventario
           (tipo, producto_id, lote_id, area_origen_id, area_destino_id,
            cantidad, costo_unitario, usuario_id, referencia_tipo, referencia_id, observaciones, institucion_id)
         VALUES ('ajuste', ?, ?, ?, ?, ?, ?, ?, 'consumo', ?, ?, ?)`
      ).bind(
        cp.producto_id, ajusteLoteId,
        delta > 0 ? cp.area_id : null,
        delta < 0 ? cp.area_id : null,
        Math.abs(delta), cp.costo_unitario_snapshot,
        c.get("session")!.usuario_id, id,
        `Ajuste facturacion: ${justificacion}`,
        instId
      ).run();
    }
  }

  const nuevoPrecio = body.nuevo_precio !== undefined ? Number(body.nuevo_precio) : cp.precio_venta_snapshot;
  await c.env.DB.prepare(
    `UPDATE consumo_paciente SET cantidad = ?, precio_venta_snapshot = ? WHERE id = ? AND institucion_id = ?`
  ).bind(nuevaCantidad, nuevoPrecio, id, instId).run();

  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "editar_consumo_facturacion",
    entidad: "consumo_paciente",
    entidad_id: id,
    payload: {
      cantidad_anterior: cp.cantidad, nueva_cantidad: nuevaCantidad,
      precio_anterior: cp.precio_venta_snapshot, nuevo_precio: nuevoPrecio,
    },
    ip: c.get("ip"),
    institucion_id: instId,
  });
  return c.json({ ok: true });
});

// Datos completos de una factura para impresion (detalle y resumen por categoria)
app.get("/facturas/:id/para-print", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"), 10);
  const f = await c.env.DB.prepare(
    `SELECT f.*,
            p.nombres, p.apellidos, p.expediente, p.documento_tipo, p.documento_numero,
            e.fecha_inicio, e.fecha_fin,
            pm.nombres || ' ' || pm.apellidos AS medico_nombre
       FROM factura f
       JOIN paciente p ON p.id = f.paciente_id
       LEFT JOIN episodio_atencion e ON e.id = f.episodio_id
       LEFT JOIN profesional_medico pm ON pm.id = e.medico_id
      WHERE f.id = ? AND f.institucion_id = ?`
  ).bind(id, instId).first();
  if (!f) return c.json({ error: "no_encontrado" }, 404);
  const { results: detalles } = await c.env.DB.prepare(
    `SELECT fd.*,
            CASE
              WHEN fd.subtotal < 0 THEN '__descuento__'
              WHEN fd.consumo_id IS NOT NULL THEN COALESCE(cat.nombre, 'Otros')
              WHEN fd.descripcion LIKE 'Habitacion%' THEN 'Habitacion'
              ELSE 'Cargos adicionales'
            END AS categoria
       FROM factura_detalle fd
       LEFT JOIN consumo_paciente cp ON cp.id = fd.consumo_id
       LEFT JOIN producto p ON p.id = cp.producto_id
       LEFT JOIN categoria_producto cat ON cat.id = p.categoria_id
      WHERE fd.factura_id = ? AND fd.institucion_id = ?
      ORDER BY categoria, fd.id`
  ).bind(id, instId).all();
  const pagos = await c.env.DB.prepare(
    `SELECT * FROM pago WHERE factura_id = ? AND institucion_id = ? ORDER BY fecha`
  ).bind(id, instId).all();
  return c.json({ factura: f, detalles: detalles, pagos: pagos.results });
});

// Reporte de ingresos
app.get("/reporte-ingresos", async (c) => {
  const instId = getInstId(c);
  const desde = c.req.query("desde") ?? new Date().toISOString().slice(0, 10);
  const hasta = c.req.query("hasta") ?? new Date().toISOString().slice(0, 10);
  const por = await c.env.DB.prepare(
    `SELECT date(p.fecha) AS dia, p.metodo,
            COUNT(*) AS cantidad, SUM(p.monto) AS total
       FROM pago p
       JOIN factura f ON f.id = p.factura_id
      WHERE date(p.fecha) BETWEEN ? AND ? AND f.estado != 'anulada'
        AND p.institucion_id = ?
      GROUP BY date(p.fecha), p.metodo
      ORDER BY dia, p.metodo`
  )
    .bind(desde, hasta, instId)
    .all();
  return c.json({ desde, hasta, data: por.results });
});

export default app;
