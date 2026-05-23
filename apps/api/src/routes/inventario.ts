import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole, getInstId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { planFEFO } from "../lib/fefo";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

// Stock por area (resumen)
app.get("/stock", async (c) => {
  const instId = getInstId(c);
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
       AND e.institucion_id = ?
       ${areaId ? "AND e.area_id = ?" : ""}
     ORDER BY p.nombre, l.fecha_vencimiento`;
  const stmt = areaId
    ? c.env.DB.prepare(sql).bind(instId, parseInt(areaId, 10))
    : c.env.DB.prepare(sql).bind(instId);
  const { results } = await stmt.all();
  return c.json({ data: results });
});

// Valorizacion de inventario (existencia x CPP) por area
app.get("/valorizacion", async (c) => {
  const instId = getInstId(c);
  const areaId = c.req.query("area_id");
  const sql = `
    SELECT p.id AS producto_id, p.codigo, p.nombre, u.abreviatura AS unidad,
           a.id AS area_id, a.nombre AS area,
           SUM(e.cantidad) AS cantidad,
           p.costo_promedio_ponderado AS cpp,
           ROUND(SUM(e.cantidad) * p.costo_promedio_ponderado, 2) AS valor
      FROM existencia e
      JOIN producto p ON p.id = e.producto_id
      JOIN unidad_medida u ON u.id = p.unidad_medida_id
      JOIN area a ON a.id = e.area_id
     WHERE e.cantidad > 0
       AND e.institucion_id = ?
       ${areaId ? "AND e.area_id = ?" : ""}
     GROUP BY p.id, a.id
     ORDER BY a.nombre, p.nombre`;
  const stmt = areaId
    ? c.env.DB.prepare(sql).bind(instId, parseInt(areaId, 10))
    : c.env.DB.prepare(sql).bind(instId);
  const { results } = await stmt.all<{ cantidad: number; valor: number; area: string }>();
  const total = (results ?? []).reduce((s, r) => s + Number(r.valor), 0);
  return c.json({ data: results, total: Math.round(total * 100) / 100 });
});

// Movimientos
app.get("/movimientos", async (c) => {
  const instId = getInstId(c);
  const productoId = c.req.query("producto_id");
  const tipo = c.req.query("tipo");
  const filt: string[] = ["m.institucion_id = ?"];
  const binds: unknown[] = [instId];
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

// Transferencia entre areas
app.post(
  "/transferencias",
  requireRole("admin", "jefe_farmacia_central", "farmaceutico", "responsable_stock"),
  async (c) => {
    const instId = getInstId(c);
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
    const plan = await planFEFO(c.env, b.producto_id, b.area_origen_id, cantidad, instId).catch((e: any) => ({
      error: e.message,
    } as any));
    if ((plan as any).error) return c.json({ error: (plan as any).error }, 400);
    const prod = await c.env.DB.prepare(
      `SELECT es_controlado, costo_promedio_ponderado AS cpp FROM producto WHERE id = ? AND institucion_id = ?`
    )
      .bind(b.producto_id, instId)
      .first<{ es_controlado: number; cpp: number }>();
    if (!prod) return c.json({ error: "producto_no_encontrado" }, 400);

    for (const step of plan as { lote_id: number | null; tomar: number }[]) {
      // Descontar origen
      await c.env.DB.prepare(
        `UPDATE existencia SET cantidad = cantidad - ?
           WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)
             AND institucion_id = ?`
      )
        .bind(step.tomar, b.producto_id, b.area_origen_id, step.lote_id, instId)
        .run();
      // Sumar destino
      const ex = await c.env.DB.prepare(
        `SELECT id FROM existencia
          WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)
            AND institucion_id = ?`
      )
        .bind(b.producto_id, b.area_destino_id, step.lote_id, instId)
        .first<{ id: number }>();
      if (ex) {
        await c.env.DB.prepare(`UPDATE existencia SET cantidad = cantidad + ? WHERE id = ? AND institucion_id = ?`)
          .bind(step.tomar, ex.id, instId)
          .run();
      } else {
        await c.env.DB.prepare(
          `INSERT INTO existencia (producto_id, area_id, lote_id, cantidad, institucion_id) VALUES (?, ?, ?, ?, ?)`
        )
          .bind(b.producto_id, b.area_destino_id, step.lote_id, step.tomar, instId)
          .run();
      }
      // Movimientos par (salida y entrada)
      await c.env.DB.prepare(
        `INSERT INTO movimiento_inventario
           (tipo, producto_id, lote_id, area_origen_id, area_destino_id, cantidad, costo_unitario, usuario_id, referencia_tipo, n_autorizacion_srs, observaciones, institucion_id)
         VALUES ('transferencia_salida', ?, ?, ?, ?, ?, ?, ?, 'transferencia', ?, ?, ?)`
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
          b.observaciones ?? null,
          instId
        )
        .run();
      await c.env.DB.prepare(
        `INSERT INTO movimiento_inventario
           (tipo, producto_id, lote_id, area_origen_id, area_destino_id, cantidad, costo_unitario, usuario_id, referencia_tipo, n_autorizacion_srs, observaciones, institucion_id)
         VALUES ('transferencia_entrada', ?, ?, ?, ?, ?, ?, ?, 'transferencia', ?, ?, ?)`
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
          b.observaciones ?? null,
          instId
        )
        .run();
    }

    await logAudit(c.env, {
      usuario_id: c.get("session")!.usuario_id,
      accion: "transferencia",
      entidad: "movimiento_inventario",
      payload: b,
      ip: c.get("ip"),
      institucion_id: instId,
    });
    return c.json({ ok: true });
  }
);

// Descarte (SRS §7.8.2)
app.post("/descartes", requireRole("admin", "jefe_farmacia_central"), async (c) => {
  const instId = getInstId(c);
  const b = await c.req.json().catch(() => null);
  if (!b?.producto_id || !b?.area_id || !b?.cantidad || !b?.motivo) {
    return c.json({ error: "datos_invalidos" }, 400);
  }
  const motivosValidos = ["vencido", "deteriorado", "defuncion", "sobrante", "otro"];
  if (!motivosValidos.includes(b.motivo)) return c.json({ error: "motivo_invalido" }, 400);

  const plan = await planFEFO(c.env, b.producto_id, b.area_id, Number(b.cantidad), instId).catch((e: any) => ({
    error: e.message,
  } as any));
  if ((plan as any).error) return c.json({ error: (plan as any).error }, 400);

  for (const step of plan as { lote_id: number | null; tomar: number }[]) {
    await c.env.DB.prepare(
      `UPDATE existencia SET cantidad = cantidad - ?
         WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)
           AND institucion_id = ?`
    )
      .bind(step.tomar, b.producto_id, b.area_id, step.lote_id, instId)
      .run();
    await c.env.DB.prepare(
      `INSERT INTO movimiento_inventario
         (tipo, producto_id, lote_id, area_origen_id, cantidad, usuario_id, referencia_tipo, observaciones, institucion_id)
       VALUES ('descarte', ?, ?, ?, ?, ?, 'descarte', ?, ?)`
    )
      .bind(
        b.producto_id,
        step.lote_id,
        b.area_id,
        step.tomar,
        c.get("session")!.usuario_id,
        `motivo:${b.motivo}${b.observaciones ? " - " + b.observaciones : ""}`,
        instId
      )
      .run();
  }

  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "descarte",
    entidad: "movimiento_inventario",
    payload: b,
    ip: c.get("ip"),
    institucion_id: instId,
  });
  return c.json({ ok: true });
});

// Ajuste manual (con justificacion auditada).
// Para categorias con requiere_lote_vencimiento=1 exige lote:
//   - Ajuste positivo: lote_id existente, O bien lote_numero + fecha_vencimiento (crea lote)
//   - Ajuste negativo: lote_id existente obligatorio
app.post("/ajustes", requireRole("admin", "jefe_farmacia_central"), async (c) => {
  const instId = getInstId(c);
  const b = await c.req.json().catch(() => null);
  if (!b?.producto_id || !b?.area_id || b?.cantidad === undefined || !b?.observaciones) {
    return c.json({ error: "datos_invalidos_o_falta_justificacion" }, 400);
  }
  const cantidad = Number(b.cantidad); // puede ser positivo o negativo

  // Verificar si la categoria del producto requiere lote/vencimiento
  const prod = await c.env.DB.prepare(
    `SELECT p.id, cat.requiere_lote_vencimiento, cat.nombre AS categoria
       FROM producto p JOIN categoria_producto cat ON cat.id = p.categoria_id
      WHERE p.id = ? AND p.institucion_id = ?`
  )
    .bind(b.producto_id, instId)
    .first<{ id: number; requiere_lote_vencimiento: number; categoria: string }>();
  if (!prod) return c.json({ error: "producto_no_encontrado" }, 400);

  let loteId: number | null = b.lote_id ?? null;

  if (prod.requiere_lote_vencimiento === 1) {
    if (cantidad < 0) {
      if (!loteId) {
        return c.json({
          error: "lote_requerido_para_decrementar",
          detalle: `La categoria "${prod.categoria}" exige especificar el lote al reducir stock.`,
        }, 400);
      }
    } else if (cantidad > 0) {
      // Permitir lote_id existente o crear uno nuevo con numero + vencimiento
      if (!loteId) {
        if (!b.lote_numero || !b.fecha_vencimiento) {
          return c.json({
            error: "lote_y_vencimiento_requeridos",
            detalle: `La categoria "${prod.categoria}" exige numero de lote y fecha de vencimiento.`,
          }, 400);
        }
        // Reutilizar si ya existe ese numero_lote para el producto
        const existingLote = await c.env.DB.prepare(
          `SELECT id FROM lote WHERE producto_id = ? AND numero_lote = ? AND institucion_id = ?`
        )
          .bind(b.producto_id, b.lote_numero, instId)
          .first<{ id: number }>();
        if (existingLote) {
          loteId = existingLote.id;
        } else {
          const ins = await c.env.DB.prepare(
            `INSERT INTO lote (producto_id, numero_lote, fecha_vencimiento, institucion_id) VALUES (?, ?, ?, ?)`
          )
            .bind(b.producto_id, b.lote_numero, b.fecha_vencimiento, instId)
            .run();
          loteId = ins.meta.last_row_id as number;
        }
      }
    }
  }

  const ex = await c.env.DB.prepare(
    `SELECT id, cantidad FROM existencia
       WHERE producto_id = ? AND area_id = ? AND COALESCE(lote_id, 0) = COALESCE(?, 0)
         AND institucion_id = ?`
  )
    .bind(b.producto_id, b.area_id, loteId, instId)
    .first<{ id: number; cantidad: number }>();
  if (ex) {
    if (ex.cantidad + cantidad < 0) return c.json({ error: "cantidad_resultante_negativa" }, 400);
    await c.env.DB.prepare(`UPDATE existencia SET cantidad = cantidad + ? WHERE id = ? AND institucion_id = ?`)
      .bind(cantidad, ex.id, instId)
      .run();
  } else {
    if (cantidad < 0) return c.json({ error: "no_hay_existencia_para_decrementar" }, 400);
    await c.env.DB.prepare(
      `INSERT INTO existencia (producto_id, area_id, lote_id, cantidad, institucion_id) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(b.producto_id, b.area_id, loteId, cantidad, instId)
      .run();
  }
  await c.env.DB.prepare(
    `INSERT INTO movimiento_inventario
       (tipo, producto_id, lote_id, area_origen_id, area_destino_id, cantidad, usuario_id, referencia_tipo, observaciones, institucion_id)
     VALUES ('ajuste', ?, ?, ?, ?, ?, ?, 'ajuste', ?, ?)`
  )
    .bind(
      b.producto_id,
      loteId,
      cantidad < 0 ? b.area_id : null,
      cantidad >= 0 ? b.area_id : null,
      Math.abs(cantidad),
      c.get("session")!.usuario_id,
      b.observaciones,
      instId
    )
    .run();

  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "ajuste_inventario",
    entidad: "movimiento_inventario",
    payload: b,
    ip: c.get("ip"),
    institucion_id: instId,
  });
  return c.json({ ok: true });
});

export default app;
