import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole } from "../middleware/auth";
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
  const b = await c.req.json().catch(() => null);
  if (!b?.episodio_id) return c.json({ error: "episodio_id_requerido" }, 400);
  const ivaPct = Number(b.iva_pct ?? 13); // El Salvador default 13%
  const cargosExtra: { descripcion: string; cantidad: number; precio_unitario: number }[] =
    Array.isArray(b.cargos_extra) ? b.cargos_extra : [];

  const ep = await c.env.DB.prepare(
    `SELECT id, paciente_id FROM episodio_atencion WHERE id = ?`
  )
    .bind(b.episodio_id)
    .first<{ id: number; paciente_id: number }>();
  if (!ep) return c.json({ error: "episodio_no_encontrado" }, 404);

  const consumos = await c.env.DB.prepare(
    `SELECT cp.id, cp.cantidad, cp.precio_venta_snapshot, p.nombre AS producto
       FROM consumo_paciente cp
       JOIN producto p ON p.id = cp.producto_id
      WHERE cp.episodio_id = ? AND cp.factura_detalle_id IS NULL`
  )
    .bind(ep.id)
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
        AND o.fecha_egreso IS NOT NULL`
  )
    .bind(ep.id)
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
  const iva = +(subtotal * (ivaPct / 100)).toFixed(2);
  const total = +(subtotal + iva).toFixed(2);
  const numero = `F-${Date.now()}`;

  const f = await c.env.DB.prepare(
    `INSERT INTO factura (numero, paciente_id, episodio_id, subtotal, iva, total, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(numero, ep.paciente_id, ep.id, subtotal, iva, total, c.get("session")!.usuario_id)
    .run();
  const facturaId = f.meta.last_row_id as number;

  for (const c0 of consumos.results ?? []) {
    const sub = c0.cantidad * c0.precio_venta_snapshot;
    const ins = await c.env.DB.prepare(
      `INSERT INTO factura_detalle (factura_id, consumo_id, descripcion, cantidad, precio_unitario, subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(facturaId, c0.id, c0.producto, c0.cantidad, c0.precio_venta_snapshot, sub)
      .run();
    await c.env.DB.prepare(`UPDATE consumo_paciente SET factura_detalle_id = ? WHERE id = ?`)
      .bind(ins.meta.last_row_id, c0.id)
      .run();
  }
  for (const o of ocupaciones.results ?? []) {
    const sub = o.dias * o.precio_diario_snapshot;
    const ins = await c.env.DB.prepare(
      `INSERT INTO factura_detalle (factura_id, descripcion, cantidad, precio_unitario, subtotal)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        facturaId,
        `Habitacion ${o.habitacion} (${o.habitacion_tipo}) - ${o.dias} dia(s)`,
        o.dias,
        o.precio_diario_snapshot,
        sub
      )
      .run();
    await c.env.DB.prepare(`UPDATE ocupacion_habitacion SET factura_detalle_id = ? WHERE id = ?`)
      .bind(ins.meta.last_row_id, o.id)
      .run();
  }
  for (const e of cargosExtra) {
    await c.env.DB.prepare(
      `INSERT INTO factura_detalle (factura_id, descripcion, cantidad, precio_unitario, subtotal)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(facturaId, e.descripcion, e.cantidad, e.precio_unitario, e.cantidad * e.precio_unitario)
      .run();
  }

  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "emitir_factura",
    entidad: "factura",
    entidad_id: facturaId,
    payload: { numero, total },
    ip: c.get("ip"),
  });

  return c.json({ id: facturaId, numero, subtotal, iva, total });
});

app.get("/facturas", async (c) => {
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const estado = c.req.query("estado");
  const filt: string[] = ["1=1"];
  const binds: unknown[] = [];
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
  const id = parseInt(c.req.param("id"), 10);
  const f = await c.env.DB.prepare(`SELECT * FROM factura WHERE id = ?`).bind(id).first();
  if (!f) return c.json({ error: "no_encontrado" }, 404);
  const det = await c.env.DB.prepare(`SELECT * FROM factura_detalle WHERE factura_id = ?`).bind(id).all();
  const pagos = await c.env.DB.prepare(`SELECT * FROM pago WHERE factura_id = ?`).bind(id).all();
  return c.json({ factura: f, detalles: det.results, pagos: pagos.results });
});

app.post("/facturas/:id/pagos", requireRole("admin", "facturacion"), async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const b = await c.req.json().catch(() => null);
  if (!b?.metodo || !b?.monto) return c.json({ error: "datos_invalidos" }, 400);
  const f = await c.env.DB.prepare(`SELECT id, total, estado FROM factura WHERE id = ?`)
    .bind(id)
    .first<{ id: number; total: number; estado: string }>();
  if (!f) return c.json({ error: "factura_no_encontrada" }, 404);
  if (f.estado === "anulada") return c.json({ error: "factura_anulada" }, 400);

  await c.env.DB.prepare(
    `INSERT INTO pago (factura_id, metodo, monto, referencia, usuario_id) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, b.metodo, b.monto, b.referencia ?? null, c.get("session")!.usuario_id)
    .run();
  const totPag = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(monto),0) AS s FROM pago WHERE factura_id = ?`
  )
    .bind(id)
    .first<{ s: number }>();
  if ((totPag?.s ?? 0) >= f.total) {
    await c.env.DB.prepare(`UPDATE factura SET estado='pagada' WHERE id = ?`).bind(id).run();
  }
  return c.json({ ok: true });
});

app.post("/facturas/:id/anular", requireRole("admin", "facturacion"), async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await c.env.DB.prepare(`UPDATE factura SET estado='anulada' WHERE id = ?`).bind(id).run();
  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "anular_factura",
    entidad: "factura",
    entidad_id: id,
    ip: c.get("ip"),
  });
  return c.json({ ok: true });
});

// Cierra y factura: egresa habitacion activa del episodio, genera la factura,
// cierra el episodio. Documento interno (sin valor fiscal).
app.post(
  "/episodios/:id/cerrar-y-facturar",
  requireRole("admin", "facturacion"),
  async (c) => {
    const epId = parseInt(c.req.param("id"), 10);
    const body = await c.req.json().catch(() => ({}));
    const ivaPct = Number(body.iva_pct ?? 13);
    const cargosExtra: { descripcion: string; cantidad: number; precio_unitario: number }[] =
      Array.isArray(body.cargos_extra) ? body.cargos_extra : [];

    const ep = await c.env.DB.prepare(
      `SELECT id, paciente_id, estado FROM episodio_atencion WHERE id = ?`
    )
      .bind(epId)
      .first<{ id: number; paciente_id: number; estado: string }>();
    if (!ep) return c.json({ error: "episodio_no_encontrado" }, 404);
    if (ep.estado !== "activo") return c.json({ error: "episodio_no_activo" }, 400);

    // Egresar habitacion activa del paciente (libera cama y la vuelve facturable)
    await c.env.DB.prepare(
      `UPDATE ocupacion_habitacion
          SET fecha_egreso = datetime('now')
        WHERE paciente_id = ? AND fecha_egreso IS NULL`
    )
      .bind(ep.paciente_id)
      .run();

    // Asociar ocupaciones que no tengan episodio_id pero pertenezcan a este paciente
    // y esten cerradas sin factura, al episodio actual (cubre flujo viejo).
    await c.env.DB.prepare(
      `UPDATE ocupacion_habitacion
          SET episodio_id = ?
        WHERE paciente_id = ? AND episodio_id IS NULL AND factura_detalle_id IS NULL`
    )
      .bind(ep.id, ep.paciente_id)
      .run();

    // Cargos no facturados
    const consumos = await c.env.DB.prepare(
      `SELECT cp.id, cp.cantidad, cp.precio_venta_snapshot, p.nombre AS producto
         FROM consumo_paciente cp
         JOIN producto p ON p.id = cp.producto_id
        WHERE cp.episodio_id = ? AND cp.factura_detalle_id IS NULL`
    )
      .bind(ep.id)
      .all<{ id: number; cantidad: number; precio_venta_snapshot: number; producto: string }>();

    const ocupaciones = await c.env.DB.prepare(
      `SELECT o.id, o.precio_diario_snapshot, h.numero AS habitacion, h.tipo AS habitacion_tipo,
              o.fecha_ingreso, o.fecha_egreso,
              MAX(CAST((julianday(o.fecha_egreso) - julianday(o.fecha_ingreso)) AS INTEGER), 1) AS dias
         FROM ocupacion_habitacion o
         JOIN habitacion h ON h.id = o.habitacion_id
        WHERE o.episodio_id = ? AND o.factura_detalle_id IS NULL AND o.fecha_egreso IS NOT NULL`
    )
      .bind(ep.id)
      .all<{
        id: number; precio_diario_snapshot: number; habitacion: string; habitacion_tipo: string;
        fecha_ingreso: string; fecha_egreso: string; dias: number;
      }>();

    let subtotal = 0;
    for (const c0 of consumos.results ?? []) subtotal += c0.cantidad * c0.precio_venta_snapshot;
    for (const o of ocupaciones.results ?? []) subtotal += o.dias * o.precio_diario_snapshot;
    for (const e of cargosExtra) subtotal += e.cantidad * e.precio_unitario;

    // Permitir cierre sin cargos (factura $0) si admin lo confirma
    if (subtotal === 0 && !body.permitir_cero) {
      return c.json({ error: "nada_para_facturar", hint: "use permitir_cero=true para cerrar sin cargos" }, 400);
    }

    const iva = +(subtotal * (ivaPct / 100)).toFixed(2);
    const total = +(subtotal + iva).toFixed(2);
    const numero = `F-${Date.now()}`;

    const f = await c.env.DB.prepare(
      `INSERT INTO factura (numero, paciente_id, episodio_id, subtotal, iva, total, usuario_id, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Cierre de cuenta - alta')`
    )
      .bind(numero, ep.paciente_id, ep.id, subtotal, iva, total, c.get("session")!.usuario_id)
      .run();
    const facturaId = f.meta.last_row_id as number;

    for (const c0 of consumos.results ?? []) {
      const sub = c0.cantidad * c0.precio_venta_snapshot;
      const ins = await c.env.DB.prepare(
        `INSERT INTO factura_detalle (factura_id, consumo_id, descripcion, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(facturaId, c0.id, c0.producto, c0.cantidad, c0.precio_venta_snapshot, sub)
        .run();
      await c.env.DB.prepare(`UPDATE consumo_paciente SET factura_detalle_id = ? WHERE id = ?`)
        .bind(ins.meta.last_row_id, c0.id)
        .run();
    }
    for (const o of ocupaciones.results ?? []) {
      const sub = o.dias * o.precio_diario_snapshot;
      const ins = await c.env.DB.prepare(
        `INSERT INTO factura_detalle (factura_id, descripcion, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(
          facturaId,
          `Habitacion ${o.habitacion} (${o.habitacion_tipo}) - ${o.dias} dia(s)`,
          o.dias,
          o.precio_diario_snapshot,
          sub
        )
        .run();
      await c.env.DB.prepare(`UPDATE ocupacion_habitacion SET factura_detalle_id = ? WHERE id = ?`)
        .bind(ins.meta.last_row_id, o.id)
        .run();
    }
    for (const e of cargosExtra) {
      await c.env.DB.prepare(
        `INSERT INTO factura_detalle (factura_id, descripcion, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(facturaId, e.descripcion, e.cantidad, e.precio_unitario, e.cantidad * e.precio_unitario)
        .run();
    }

    await c.env.DB.prepare(
      `UPDATE episodio_atencion SET estado='cerrado', fecha_fin=datetime('now') WHERE id = ?`
    )
      .bind(ep.id)
      .run();

    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "cerrar_y_facturar",
      entidad: "episodio_atencion",
      entidad_id: ep.id,
      payload: { factura_id: facturaId, total },
      ip: c.get("ip"),
    });

    return c.json({ ok: true, factura_id: facturaId, numero, subtotal, iva, total });
  }
);

// Reporte de ingresos
app.get("/reporte-ingresos", async (c) => {
  const desde = c.req.query("desde") ?? new Date().toISOString().slice(0, 10);
  const hasta = c.req.query("hasta") ?? new Date().toISOString().slice(0, 10);
  const por = await c.env.DB.prepare(
    `SELECT date(p.fecha) AS dia, p.metodo,
            COUNT(*) AS cantidad, SUM(p.monto) AS total
       FROM pago p
       JOIN factura f ON f.id = p.factura_id
      WHERE date(p.fecha) BETWEEN ? AND ? AND f.estado != 'anulada'
      GROUP BY date(p.fecha), p.metodo
      ORDER BY dia, p.metodo`
  )
    .bind(desde, hasta)
    .all();
  return c.json({ desde, hasta, data: por.results });
});

export default app;
