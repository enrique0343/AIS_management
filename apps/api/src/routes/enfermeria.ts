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
    `SELECT id, costo_promedio_ponderado AS cpp, precio_venta FROM producto WHERE id = ?`
  )
    .bind(b.producto_id)
    .first<{ id: number; cpp: number; precio_venta: number }>();
  if (!prod) return c.json({ error: "producto_no_encontrado" }, 404);

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
