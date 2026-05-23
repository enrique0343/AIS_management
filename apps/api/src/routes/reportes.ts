import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, getInstId } from "../middleware/auth";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

function defaultRange(c: any) {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return { desde: c.req.query("desde") ?? hace30, hasta: c.req.query("hasta") ?? hoy };
}

// Ocupacion por habitacion: dias ocupados / dias del periodo
app.get("/ocupacion", async (c) => {
  const instId = getInstId(c);
  const { desde, hasta } = defaultRange(c);
  const periodo = await c.env.DB.prepare(
    `SELECT MAX(CAST((julianday(?) - julianday(?)) AS INTEGER) + 1, 1) AS dias`
  )
    .bind(hasta, desde)
    .first<{ dias: number }>();
  const dias_periodo = periodo?.dias ?? 1;

  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.numero, h.tipo, h.capacidad,
            COALESCE(SUM(
              MAX(
                CAST((julianday(MIN(COALESCE(o.fecha_egreso, ?), ? || ' 23:59:59'))
                      - julianday(MAX(o.fecha_ingreso, ? || ' 00:00:00'))) AS INTEGER),
                0
              )
            ), 0) AS dias_ocupados
       FROM habitacion h
       LEFT JOIN ocupacion_habitacion o ON o.habitacion_id = h.id
            AND date(o.fecha_ingreso) <= ?
            AND (o.fecha_egreso IS NULL OR date(o.fecha_egreso) >= ?)
            AND o.institucion_id = ?
      WHERE h.institucion_id = ?
      GROUP BY h.id
      ORDER BY h.numero`
  )
    .bind(hasta, hasta, desde, hasta, desde, instId, instId)
    .all<{ id: number; numero: string; tipo: string; capacidad: number; dias_ocupados: number }>();

  const data = (results ?? []).map((r) => ({
    ...r,
    dias_disponibles: dias_periodo * r.capacidad,
    porcentaje_ocupacion: r.capacidad > 0
      ? Math.round((r.dias_ocupados / (dias_periodo * r.capacidad)) * 1000) / 10
      : 0,
  }));
  const totDisp = data.reduce((s, r) => s + r.dias_disponibles, 0);
  const totOcup = data.reduce((s, r) => s + r.dias_ocupados, 0);
  return c.json({
    desde, hasta, dias_periodo, data,
    porcentaje_ocupacion_global: totDisp > 0 ? Math.round((totOcup / totDisp) * 1000) / 10 : 0,
  });
});

// Rotacion: numero de pacientes egresados / numero de camas
app.get("/rotacion", async (c) => {
  const instId = getInstId(c);
  const { desde, hasta } = defaultRange(c);
  const egresos = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT paciente_id) AS n FROM ocupacion_habitacion
      WHERE date(fecha_egreso) BETWEEN ? AND ? AND institucion_id = ?`
  )
    .bind(desde, hasta, instId)
    .first<{ n: number }>();
  const camas = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(capacidad), 0) AS n FROM habitacion WHERE activa = 1 AND institucion_id = ?`
  ).bind(instId).first<{ n: number }>();
  const indice = camas?.n ? (egresos?.n ?? 0) / camas.n : 0;
  return c.json({
    desde, hasta,
    egresos: egresos?.n ?? 0,
    camas: camas?.n ?? 0,
    indice_rotacion: Math.round(indice * 100) / 100,
  });
});

// Dias de inventario: existencia / consumo_promedio_diario
app.get("/dias-inventario", async (c) => {
  const instId = getInstId(c);
  const dias = parseInt(c.req.query("ventana_dias") ?? "30", 10);
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.codigo, p.nombre, u.abreviatura AS unidad,
            (SELECT COALESCE(SUM(cantidad), 0) FROM existencia WHERE producto_id = p.id AND institucion_id = ?) AS stock,
            COALESCE((
              SELECT SUM(m.cantidad)
                FROM movimiento_inventario m
               WHERE m.producto_id = p.id
                 AND m.tipo IN ('consumo_paciente','descarte')
                 AND date(m.fecha) >= date('now', '-' || ? || ' days')
                 AND m.institucion_id = ?
            ), 0) AS consumido_ventana
       FROM producto p
       JOIN unidad_medida u ON u.id = p.unidad_medida_id
       JOIN categoria_producto cat ON cat.id = p.categoria_id
      WHERE p.activo = 1 AND cat.es_servicio = 0 AND p.institucion_id = ?
      ORDER BY p.nombre`
  )
    .bind(instId, dias, instId, instId)
    .all<{ id: number; codigo: string; nombre: string; unidad: string; stock: number; consumido_ventana: number }>();

  const data = (results ?? []).map((r) => {
    const consumo_diario = r.consumido_ventana / dias;
    const dias_cobertura = consumo_diario > 0 ? r.stock / consumo_diario : null;
    return {
      ...r,
      consumo_diario: Math.round(consumo_diario * 100) / 100,
      dias_cobertura: dias_cobertura === null ? null : Math.round(dias_cobertura * 10) / 10,
    };
  });
  return c.json({ ventana_dias: dias, data });
});

// Financiero: ingresos vs gastos vs COGS por mes
app.get("/financiero", async (c) => {
  const instId = getInstId(c);
  const desdeDef = (() => { const d = new Date(); d.setMonth(d.getMonth() - 5, 1); return d.toISOString().slice(0, 10); })();
  const desde = c.req.query("desde") ?? desdeDef;
  const hasta = c.req.query("hasta") ?? new Date().toISOString().slice(0, 10);

  const ingresos = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m', p.fecha) AS mes, SUM(p.monto) AS total
       FROM pago p JOIN factura f ON f.id = p.factura_id
      WHERE date(p.fecha) BETWEEN ? AND ? AND f.estado != 'anulada' AND p.institucion_id = ?
      GROUP BY mes ORDER BY mes`
  ).bind(desde, hasta, instId).all<{ mes: string; total: number }>();

  const gastos = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m', fecha) AS mes, SUM(monto) AS total
       FROM gasto_operativo
      WHERE date(fecha) BETWEEN ? AND ? AND institucion_id = ?
      GROUP BY mes ORDER BY mes`
  ).bind(desde, hasta, instId).all<{ mes: string; total: number }>();

  const cogs = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m', fecha) AS mes, SUM(cantidad * costo_unitario_snapshot) AS total
       FROM consumo_paciente
      WHERE date(fecha) BETWEEN ? AND ? AND institucion_id = ?
      GROUP BY mes ORDER BY mes`
  ).bind(desde, hasta, instId).all<{ mes: string; total: number }>();

  const gastosPorCat = await c.env.DB.prepare(
    `SELECT c.nombre AS categoria, SUM(g.monto) AS total
       FROM gasto_operativo g JOIN categoria_gasto c ON c.id = g.categoria_id
      WHERE date(g.fecha) BETWEEN ? AND ? AND g.institucion_id = ?
      GROUP BY c.id ORDER BY total DESC`
  ).bind(desde, hasta, instId).all<{ categoria: string; total: number }>();

  // Merge meses
  const meses = new Map<string, { mes: string; ingresos: number; gastos: number; cogs: number; neto: number }>();
  const ensure = (m: string) => {
    if (!meses.has(m)) meses.set(m, { mes: m, ingresos: 0, gastos: 0, cogs: 0, neto: 0 });
    return meses.get(m)!;
  };
  for (const r of ingresos.results ?? []) ensure(r.mes).ingresos = Number(r.total);
  for (const r of gastos.results ?? []) ensure(r.mes).gastos = Number(r.total);
  for (const r of cogs.results ?? []) ensure(r.mes).cogs = Number(r.total);
  const mensual = Array.from(meses.values())
    .map((m) => ({ ...m, neto: +(m.ingresos - m.gastos - m.cogs).toFixed(2) }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const total = mensual.reduce(
    (acc, m) => ({
      ingresos: acc.ingresos + m.ingresos,
      gastos: acc.gastos + m.gastos,
      cogs: acc.cogs + m.cogs,
      neto: acc.neto + m.neto,
    }),
    { ingresos: 0, gastos: 0, cogs: 0, neto: 0 }
  );

  return c.json({
    desde, hasta,
    mensual,
    total: {
      ingresos: Math.round(total.ingresos * 100) / 100,
      gastos: Math.round(total.gastos * 100) / 100,
      cogs: Math.round(total.cogs * 100) / 100,
      neto: Math.round(total.neto * 100) / 100,
    },
    gastos_por_categoria: gastosPorCat.results ?? [],
  });
});

// Resumen inventario: existencias y valoracion globales
app.get("/inventario-resumen", async (c) => {
  const instId = getInstId(c);
  const totales = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT p.id) AS productos_activos,
            COALESCE(SUM(e.cantidad), 0) AS unidades_totales,
            COALESCE(SUM(e.cantidad * p.costo_promedio_ponderado), 0) AS valor_total
       FROM producto p
       LEFT JOIN existencia e ON e.producto_id = p.id AND e.institucion_id = ?
       JOIN categoria_producto cat ON cat.id = p.categoria_id
      WHERE p.activo = 1 AND cat.es_servicio = 0 AND p.institucion_id = ?`
  ).bind(instId, instId).first<{ productos_activos: number; unidades_totales: number; valor_total: number }>();

  const porCat = await c.env.DB.prepare(
    `SELECT cat.nombre AS categoria, cat.prefijo,
            COUNT(DISTINCT p.id) AS productos,
            COALESCE(SUM(e.cantidad), 0) AS unidades,
            ROUND(COALESCE(SUM(e.cantidad * p.costo_promedio_ponderado), 0), 2) AS valor
       FROM categoria_producto cat
       LEFT JOIN producto p ON p.categoria_id = cat.id AND p.activo = 1 AND p.institucion_id = ?
       LEFT JOIN existencia e ON e.producto_id = p.id AND e.institucion_id = ?
      WHERE cat.es_servicio = 0
      GROUP BY cat.id ORDER BY cat.nombre`
  ).bind(instId, instId).all();

  return c.json({
    totales: {
      productos_activos: totales?.productos_activos ?? 0,
      unidades_totales: totales?.unidades_totales ?? 0,
      valor_total: Math.round((totales?.valor_total ?? 0) * 100) / 100,
    },
    por_categoria: porCat.results ?? [],
  });
});

export default app;
