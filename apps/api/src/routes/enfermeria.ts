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

// Devolucion de producto no utilizado a la farmacia interna.
// Solo aplica a consumos de productos (no servicios) que aun no estan facturados.
// Reduce la cantidad del consumo y reingresa al stock del area destino con el
// mismo lote (preserva trazabilidad de vencimiento).
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
