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
 * Si el producto es controlado y requiere_receta_especial, exige
 * receta_especial_id valida (SRS §7.6, cadena de custodia).
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
    `SELECT id, es_controlado, requiere_receta_especial, costo_promedio_ponderado AS cpp, precio_venta
       FROM producto WHERE id = ?`
  )
    .bind(b.producto_id)
    .first<{
      id: number;
      es_controlado: number;
      requiere_receta_especial: number;
      cpp: number;
      precio_venta: number;
    }>();
  if (!prod) return c.json({ error: "producto_no_encontrado" }, 404);

  if (prod.es_controlado || prod.requiere_receta_especial) {
    if (!b.receta_especial_id) {
      return c.json({ error: "receta_especial_requerida" }, 400);
    }
    const receta = await c.env.DB.prepare(
      `SELECT id, estado, paciente_id FROM receta_especial_retenida WHERE id = ?`
    )
      .bind(b.receta_especial_id)
      .first<{ id: number; estado: string; paciente_id: number }>();
    if (!receta || receta.estado === "anulada") return c.json({ error: "receta_invalida" }, 400);
    if (receta.paciente_id !== ep.paciente_id) return c.json({ error: "receta_paciente_mismatch" }, 400);
  }

  let plan;
  try {
    plan = await planFEFO(c.env, b.producto_id, b.area_id, cantidad);
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }

  const insertedIds: number[] = [];
  for (const step of plan) {
    // Descontar existencia
    await c.env.DB.prepare(
      `UPDATE existencia SET cantidad = cantidad - ?
         WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id,0) = COALESCE(?,0)`
    )
      .bind(step.tomar, b.producto_id, b.area_id, step.lote_id)
      .run();
    // Movimiento
    await c.env.DB.prepare(
      `INSERT INTO movimiento_inventario
         (tipo, producto_id, lote_id, area_origen_id, cantidad, costo_unitario, usuario_id, referencia_tipo, referencia_id)
       VALUES ('consumo_paciente', ?, ?, ?, ?, ?, ?, 'consumo', ?)`
    )
      .bind(b.producto_id, step.lote_id, b.area_id, step.tomar, prod.cpp, c.get("session")!.usuario_id, ep.id)
      .run();
    // Consumo
    const r = await c.env.DB.prepare(
      `INSERT INTO consumo_paciente
         (episodio_id, producto_id, lote_id, area_id, cantidad, costo_unitario_snapshot, precio_venta_snapshot, usuario_id, receta_especial_id, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        b.receta_especial_id ?? null,
        b.observaciones ?? null
      )
      .run();
    insertedIds.push(r.meta.last_row_id as number);
  }

  // Si esta es la dispensacion de la receta, marcar sello DISPENSADA
  if (b.receta_especial_id) {
    await c.env.DB.prepare(
      `UPDATE receta_especial_retenida
          SET estado = 'dispensada', sello_dispensada_fecha = COALESCE(sello_dispensada_fecha, datetime('now'))
        WHERE id = ?`
    )
      .bind(b.receta_especial_id)
      .run();
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

// === Recetas especiales retenidas ===
app.post("/recetas", requireRole("admin", "medico"), async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.paciente_id || !b?.medico_id) return c.json({ error: "datos_invalidos" }, 400);
  const numero_serie = b.numero_serie ?? `RR-${Date.now()}`;
  const r = await c.env.DB.prepare(
    `INSERT INTO receta_especial_retenida
       (numero_serie, episodio_id, paciente_id, medico_id, fecha, observaciones)
     VALUES (?, ?, ?, ?, COALESCE(?, date('now')), ?)`
  )
    .bind(numero_serie, b.episodio_id ?? null, b.paciente_id, b.medico_id, b.fecha ?? null, b.observaciones ?? null)
    .run();
  return c.json({ id: r.meta.last_row_id, numero_serie });
});

app.get("/recetas", async (c) => {
  const pacienteId = c.req.query("paciente_id");
  const estado = c.req.query("estado");
  const filt: string[] = ["1=1"];
  const binds: unknown[] = [];
  if (pacienteId) { filt.push("r.paciente_id = ?"); binds.push(parseInt(pacienteId, 10)); }
  if (estado) { filt.push("r.estado = ?"); binds.push(estado); }
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, p.nombres || ' ' || p.apellidos AS paciente,
            m.nombres || ' ' || m.apellidos AS medico
       FROM receta_especial_retenida r
       JOIN paciente p ON p.id = r.paciente_id
       JOIN profesional_medico m ON m.id = r.medico_id
      WHERE ${filt.join(" AND ")}
      ORDER BY r.fecha DESC LIMIT 200`
  )
    .bind(...binds)
    .all();
  return c.json({ data: results });
});

app.post("/recetas/:id/anular", requireRole("admin", "medico"), async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await c.env.DB.prepare(`UPDATE receta_especial_retenida SET estado='anulada' WHERE id = ?`)
    .bind(id)
    .run();
  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "anular_receta",
    entidad: "receta_especial_retenida",
    entidad_id: id,
    ip: c.get("ip"),
  });
  return c.json({ ok: true });
});

export default app;
