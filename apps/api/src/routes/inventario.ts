import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { planFEFO } from "../lib/fefo";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

// Stock por area (resumen)
app.get("/stock", async (c) => {
  const areaId = c.req.query("area_id");
  const sql = `
    SELECT e.producto_id, p.codigo, p.nombre, p.es_controlado,
           e.area_id, a.nombre AS area, e.lote_id, l.numero_lote, l.fecha_vencimiento,
           e.cantidad
      FROM existencia e
      JOIN producto p ON p.id = e.producto_id
      JOIN area a ON a.id = e.area_id
      LEFT JOIN lote l ON l.id = e.lote_id
     WHERE e.cantidad > 0
       ${areaId ? "AND e.area_id = ?" : ""}
     ORDER BY p.nombre, l.fecha_vencimiento`;
  const stmt = areaId ? c.env.DB.prepare(sql).bind(parseInt(areaId, 10)) : c.env.DB.prepare(sql);
  const { results } = await stmt.all();
  return c.json({ data: results });
});

// Movimientos
app.get("/movimientos", async (c) => {
  const productoId = c.req.query("producto_id");
  const tipo = c.req.query("tipo");
  const filt: string[] = ["1=1"];
  const binds: unknown[] = [];
  if (productoId) {
    filt.push("m.producto_id = ?");
    binds.push(parseInt(productoId, 10));
  }
  if (tipo) {
    filt.push("m.tipo = ?");
    binds.push(tipo);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.fecha, m.tipo, m.producto_id, p.nombre AS producto,
            m.lote_id, l.numero_lote, l.fecha_vencimiento,
            m.area_origen_id, ao.nombre AS area_origen,
            m.area_destino_id, ad.nombre AS area_destino,
            m.cantidad, m.costo_unitario, m.n_autorizacion_srs,
            m.referencia_tipo, m.referencia_id, m.observaciones,
            u.nombre AS usuario
       FROM movimiento_inventario m
       JOIN producto p ON p.id = m.producto_id
       LEFT JOIN lote l ON l.id = m.lote_id
       LEFT JOIN area ao ON ao.id = m.area_origen_id
       LEFT JOIN area ad ON ad.id = m.area_destino_id
       LEFT JOIN usuario u ON u.id = m.usuario_id
      WHERE ${filt.join(" AND ")}
      ORDER BY m.fecha DESC, m.id DESC
      LIMIT 500`
  )
    .bind(...binds)
    .all();
  return c.json({ data: results });
});

// Libro de controlados (SRS §7.4.a / §7.6)
app.get("/libro-controlados", async (c) => {
  const productoId = c.req.query("producto_id");
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const filt: string[] = ["p.es_controlado = 1"];
  const binds: unknown[] = [];
  if (productoId) { filt.push("m.producto_id = ?"); binds.push(parseInt(productoId, 10)); }
  if (desde) { filt.push("date(m.fecha) >= ?"); binds.push(desde); }
  if (hasta) { filt.push("date(m.fecha) <= ?"); binds.push(hasta); }
  const { results } = await c.env.DB.prepare(
    `SELECT m.fecha, m.tipo, p.codigo, p.nombre AS producto,
            l.numero_lote, l.fecha_vencimiento,
            ao.nombre AS area_origen, ad.nombre AS area_destino,
            m.cantidad, m.n_autorizacion_srs, m.referencia_tipo, m.referencia_id,
            u.nombre AS responsable
       FROM movimiento_inventario m
       JOIN producto p ON p.id = m.producto_id
       LEFT JOIN lote l ON l.id = m.lote_id
       LEFT JOIN area ao ON ao.id = m.area_origen_id
       LEFT JOIN area ad ON ad.id = m.area_destino_id
       LEFT JOIN usuario u ON u.id = m.usuario_id
      WHERE ${filt.join(" AND ")}
      ORDER BY p.nombre, m.fecha`
  )
    .bind(...binds)
    .all();
  return c.json({ data: results });
});

// Transferencia entre areas (SRS §7.5)
app.post(
  "/transferencias",
  requireRole("admin", "jefe_farmacia_central", "farmaceutico", "responsable_stock"),
  async (c) => {
    const b = await c.req.json().catch(() => null);
    if (
      !b ||
      !b.producto_id ||
      !b.area_origen_id ||
      !b.area_destino_id ||
      !b.cantidad ||
      b.area_origen_id === b.area_destino_id
    ) {
      return c.json({ error: "datos_invalidos" }, 400);
    }
    const cantidad = Number(b.cantidad);
    const plan = await planFEFO(c.env, b.producto_id, b.area_origen_id, cantidad).catch((e: any) => ({
      error: e.message,
    } as any));
    if ((plan as any).error) return c.json({ error: (plan as any).error }, 400);
    const prod = await c.env.DB.prepare(
      `SELECT es_controlado, costo_promedio_ponderado AS cpp FROM producto WHERE id = ?`
    )
      .bind(b.producto_id)
      .first<{ es_controlado: number; cpp: number }>();
    if (!prod) return c.json({ error: "producto_no_encontrado" }, 400);
    if (prod.es_controlado && !b.n_autorizacion_srs) {
      return c.json({ error: "n_autorizacion_srs_requerido" }, 400);
    }

    for (const step of plan as { lote_id: number | null; tomar: number }[]) {
      // Descontar origen
      await c.env.DB.prepare(
        `UPDATE existencia SET cantidad = cantidad - ?
           WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)`
      )
        .bind(step.tomar, b.producto_id, b.area_origen_id, step.lote_id)
        .run();
      // Sumar destino
      const ex = await c.env.DB.prepare(
        `SELECT id FROM existencia
          WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)`
      )
        .bind(b.producto_id, b.area_destino_id, step.lote_id)
        .first<{ id: number }>();
      if (ex) {
        await c.env.DB.prepare(`UPDATE existencia SET cantidad = cantidad + ? WHERE id = ?`)
          .bind(step.tomar, ex.id)
          .run();
      } else {
        await c.env.DB.prepare(
          `INSERT INTO existencia (producto_id, area_id, lote_id, cantidad) VALUES (?, ?, ?, ?)`
        )
          .bind(b.producto_id, b.area_destino_id, step.lote_id, step.tomar)
          .run();
      }
      // Movimientos par (salida y entrada)
      await c.env.DB.prepare(
        `INSERT INTO movimiento_inventario
           (tipo, producto_id, lote_id, area_origen_id, area_destino_id, cantidad, costo_unitario, usuario_id, referencia_tipo, n_autorizacion_srs, observaciones)
         VALUES ('transferencia_salida', ?, ?, ?, ?, ?, ?, ?, 'transferencia', ?, ?)`
      )
        .bind(
          b.producto_id,
          step.lote_id,
          b.area_origen_id,
          b.area_destino_id,
          step.tomar,
          prod.cpp,
          c.get("session")!.usuario_id,
          b.n_autorizacion_srs ?? null,
          b.observaciones ?? null
        )
        .run();
      await c.env.DB.prepare(
        `INSERT INTO movimiento_inventario
           (tipo, producto_id, lote_id, area_origen_id, area_destino_id, cantidad, costo_unitario, usuario_id, referencia_tipo, n_autorizacion_srs, observaciones)
         VALUES ('transferencia_entrada', ?, ?, ?, ?, ?, ?, ?, 'transferencia', ?, ?)`
      )
        .bind(
          b.producto_id,
          step.lote_id,
          b.area_origen_id,
          b.area_destino_id,
          step.tomar,
          prod.cpp,
          c.get("session")!.usuario_id,
          b.n_autorizacion_srs ?? null,
          b.observaciones ?? null
        )
        .run();
    }

    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "transferencia",
      entidad: "movimiento_inventario",
      payload: b,
      ip: c.get("ip"),
    });
    return c.json({ ok: true });
  }
);

// Descarte (SRS §7.8.2)
app.post("/descartes", requireRole("admin", "jefe_farmacia_central"), async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.producto_id || !b?.area_id || !b?.cantidad || !b?.motivo) {
    return c.json({ error: "datos_invalidos" }, 400);
  }
  const motivosValidos = ["vencido", "deteriorado", "defuncion", "sobrante", "otro"];
  if (!motivosValidos.includes(b.motivo)) return c.json({ error: "motivo_invalido" }, 400);

  const plan = await planFEFO(c.env, b.producto_id, b.area_id, Number(b.cantidad)).catch((e: any) => ({
    error: e.message,
  } as any));
  if ((plan as any).error) return c.json({ error: (plan as any).error }, 400);

  for (const step of plan as { lote_id: number | null; tomar: number }[]) {
    await c.env.DB.prepare(
      `UPDATE existencia SET cantidad = cantidad - ?
         WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)`
    )
      .bind(step.tomar, b.producto_id, b.area_id, step.lote_id)
      .run();
    await c.env.DB.prepare(
      `INSERT INTO movimiento_inventario
         (tipo, producto_id, lote_id, area_origen_id, cantidad, usuario_id, referencia_tipo, observaciones)
       VALUES ('descarte', ?, ?, ?, ?, ?, 'descarte', ?)`
    )
      .bind(
        b.producto_id,
        step.lote_id,
        b.area_id,
        step.tomar,
        c.get("session")!.usuario_id,
        `motivo:${b.motivo}${b.observaciones ? " - " + b.observaciones : ""}`
      )
      .run();
  }

  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "descarte",
    entidad: "movimiento_inventario",
    payload: b,
    ip: c.get("ip"),
  });
  return c.json({ ok: true });
});

// Ajuste manual (con justificacion auditada)
app.post("/ajustes", requireRole("admin", "jefe_farmacia_central"), async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.producto_id || !b?.area_id || b?.cantidad === undefined || !b?.observaciones) {
    return c.json({ error: "datos_invalidos_o_falta_justificacion" }, 400);
  }
  const cantidad = Number(b.cantidad); // puede ser positivo o negativo
  const loteId = b.lote_id ?? null;

  const ex = await c.env.DB.prepare(
    `SELECT id, cantidad FROM existencia
       WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)`
  )
    .bind(b.producto_id, b.area_id, loteId)
    .first<{ id: number; cantidad: number }>();
  if (ex) {
    if (ex.cantidad + cantidad < 0) return c.json({ error: "cantidad_resultante_negativa" }, 400);
    await c.env.DB.prepare(`UPDATE existencia SET cantidad = cantidad + ? WHERE id = ?`)
      .bind(cantidad, ex.id)
      .run();
  } else {
    if (cantidad < 0) return c.json({ error: "no_hay_existencia_para_decrementar" }, 400);
    await c.env.DB.prepare(
      `INSERT INTO existencia (producto_id, area_id, lote_id, cantidad) VALUES (?, ?, ?, ?)`
    )
      .bind(b.producto_id, b.area_id, loteId, cantidad)
      .run();
  }
  await c.env.DB.prepare(
    `INSERT INTO movimiento_inventario
       (tipo, producto_id, lote_id, area_origen_id, area_destino_id, cantidad, usuario_id, referencia_tipo, observaciones)
     VALUES ('ajuste', ?, ?, ?, ?, ?, ?, 'ajuste', ?)`
  )
    .bind(
      b.producto_id,
      loteId,
      cantidad < 0 ? b.area_id : null,
      cantidad >= 0 ? b.area_id : null,
      Math.abs(cantidad),
      c.get("session")!.usuario_id,
      b.observaciones
    )
    .run();

  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "ajuste_inventario",
    entidad: "movimiento_inventario",
    payload: b,
    ip: c.get("ip"),
  });
  return c.json({ ok: true });
});

export default app;
