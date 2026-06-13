import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole, getInstId } from "../middleware/auth";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

// ──────────────── CUENTAS POR PAGAR ────────────────

app.get("/cuentas-pagar", async (c) => {
  const instId = getInstId(c);
  const estado  = c.req.query("estado");
  const provId  = c.req.query("proveedor_id");
  let q = `SELECT cp.*, pr.nombre AS proveedor_nombre,
                  CASE
                    WHEN cp.estado = 'pendiente' AND cp.fecha_vencimiento < date('now') THEN 'vencida'
                    ELSE cp.estado
                  END AS estado_real,
                  CAST(julianday('now') - julianday(cp.fecha_vencimiento) AS INTEGER) AS dias_vencido
             FROM cuenta_pagar cp
             JOIN proveedor pr ON pr.id = cp.proveedor_id
            WHERE cp.institucion_id = ?`;
  const binds: unknown[] = [instId];
  if (estado) { q += " AND cp.estado = ?"; binds.push(estado); }
  if (provId) { q += " AND cp.proveedor_id = ?"; binds.push(parseInt(provId)); }
  q += " ORDER BY cp.fecha_vencimiento";
  const rows = await c.env.DB.prepare(q).bind(...binds).all();
  return c.json(rows.results ?? []);
});

app.post("/cuentas-pagar", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const session = c.get("session")!;
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!b.proveedor_id || !b.concepto || !b.monto) {
    return c.json({ error: "proveedor_concepto_monto_requeridos" }, 400);
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO cuenta_pagar (proveedor_id, orden_compra_id, concepto, monto, fecha_emision, fecha_vencimiento, notas, creado_por, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    b.proveedor_id, b.orden_compra_id ?? null, b.concepto, b.monto,
    b.fecha_emision ?? new Date().toISOString().slice(0, 10),
    b.fecha_vencimiento ?? null, b.notas ?? null, session.usuario_id, instId
  ).run();
  return c.json({ id: r.meta.last_row_id });
});

app.post("/cuentas-pagar/:id/pagar", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"));
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  await c.env.DB.prepare(
    `UPDATE cuenta_pagar SET estado = 'pagada', referencia_pago = ?, fecha_pago = date('now')
      WHERE id = ? AND institucion_id = ?`
  ).bind(b.referencia ?? null, id, instId).run();
  return c.json({ ok: true });
});

// Aging summary
app.get("/cuentas-pagar/_aging", async (c) => {
  const instId = getInstId(c);
  const row = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN julianday('now') - julianday(fecha_vencimiento) <= 0    THEN monto ELSE 0 END) AS corriente,
       SUM(CASE WHEN julianday('now') - julianday(fecha_vencimiento) BETWEEN 1 AND 30 THEN monto ELSE 0 END) AS d0_30,
       SUM(CASE WHEN julianday('now') - julianday(fecha_vencimiento) BETWEEN 31 AND 60 THEN monto ELSE 0 END) AS d31_60,
       SUM(CASE WHEN julianday('now') - julianday(fecha_vencimiento) BETWEEN 61 AND 90 THEN monto ELSE 0 END) AS d61_90,
       SUM(CASE WHEN julianday('now') - julianday(fecha_vencimiento) > 90             THEN monto ELSE 0 END) AS mas90,
       SUM(monto) AS total
     FROM cuenta_pagar
     WHERE institucion_id = ? AND estado = 'pendiente'`
  ).bind(instId).first();
  return c.json(row ?? {});
});

// ──────────────── DEPÓSITOS DE PACIENTES ────────────────

app.get("/depositos", async (c) => {
  const instId = getInstId(c);
  const pacId = c.req.query("paciente_id");
  let q = `SELECT d.*, pac.nombres || ' ' || pac.apellidos AS paciente_nombre, pac.expediente
             FROM deposito_paciente d
             JOIN paciente pac ON pac.id = d.paciente_id
            WHERE d.institucion_id = ?`;
  const binds: unknown[] = [instId];
  if (pacId) { q += " AND d.paciente_id = ?"; binds.push(parseInt(pacId)); }
  q += " ORDER BY d.fecha DESC";
  const rows = await c.env.DB.prepare(q).bind(...binds).all();
  return c.json(rows.results ?? []);
});

app.post("/depositos", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const session = c.get("session")!;
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!b.paciente_id || !b.monto) return c.json({ error: "paciente_monto_requeridos" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO deposito_paciente (paciente_id, episodio_id, monto, fecha, concepto, creado_por, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    b.paciente_id, b.episodio_id ?? null, b.monto,
    b.fecha ?? new Date().toISOString().slice(0, 10),
    b.concepto ?? null, session.usuario_id, instId
  ).run();
  return c.json({ id: r.meta.last_row_id });
});

app.post("/depositos/:id/aplicar", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"));
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  await c.env.DB.prepare(
    "UPDATE deposito_paciente SET aplicado = 1, factura_id = ? WHERE id = ? AND institucion_id = ?"
  ).bind(b.factura_id ?? null, id, instId).run();
  return c.json({ ok: true });
});

// ──────────────── NOTAS DE CRÉDITO ────────────────

app.get("/notas-credito", async (c) => {
  const instId = getInstId(c);
  const rows = await c.env.DB.prepare(
    `SELECT nc.*, f.numero AS factura_numero, u.nombre AS creado_por_nombre
       FROM nota_credito nc
       JOIN factura f ON f.id = nc.factura_id
       LEFT JOIN usuario u ON u.id = nc.creado_por
      WHERE nc.institucion_id = ?
      ORDER BY nc.creado_en DESC LIMIT 200`
  ).bind(instId).all();
  return c.json(rows.results ?? []);
});

app.post("/notas-credito", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const session = c.get("session")!;
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!b.factura_id || !b.monto || !b.motivo) {
    return c.json({ error: "factura_monto_motivo_requeridos" }, 400);
  }
  const numero = `NC-${Date.now()}`;
  const r = await c.env.DB.prepare(
    `INSERT INTO nota_credito (factura_id, numero, monto, motivo, creado_por, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(b.factura_id, numero, b.monto, b.motivo, session.usuario_id, instId).run();
  return c.json({ id: r.meta.last_row_id, numero });
});

// ──────────────── ARQUEO DE CAJA ────────────────

app.get("/cierre-caja", async (c) => {
  const instId = getInstId(c);
  const rows = await c.env.DB.prepare(
    `SELECT cc.*, u.nombre AS usuario_nombre
       FROM cierre_caja cc
       JOIN usuario u ON u.id = cc.usuario_id
      WHERE cc.institucion_id = ?
      ORDER BY cc.fecha_fin DESC LIMIT 50`
  ).bind(instId).all();
  return c.json(rows.results ?? []);
});

app.post("/cierre-caja", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const session = c.get("session")!;
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  // Calcula total cobrado en el período del turno
  const desde = b.fecha_inicio as string ?? new Date(Date.now() - 8*3600*1000).toISOString();
  const hasta = new Date().toISOString();
  const cobrado = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(monto), 0) AS t FROM pago
      WHERE institucion_id = ? AND fecha >= ? AND fecha <= ?`
  ).bind(instId, desde, hasta).first<{ t: number }>();
  const totalCobrado = cobrado?.t ?? 0;

  const r = await c.env.DB.prepare(
    `INSERT INTO cierre_caja (usuario_id, fecha_inicio, fecha_fin, efectivo_apertura, efectivo_cierre, total_cobrado, observaciones, institucion_id)
     VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?)`
  ).bind(
    session.usuario_id, desde,
    b.efectivo_apertura ?? 0, b.efectivo_cierre ?? 0,
    totalCobrado, b.observaciones ?? null, instId
  ).run();
  return c.json({ id: r.meta.last_row_id, total_cobrado: totalCobrado });
});

// ──────────────── ESTADO DE RESULTADOS ────────────────

app.get("/estado-resultados", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const desde = c.req.query("desde") ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const hasta = c.req.query("hasta") ?? new Date().toISOString().slice(0, 10);

  const [ingresos, cogs, gastos, honorariosCobrados] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(p.monto), 0) AS t FROM pago p
        JOIN factura f ON f.id = p.factura_id
       WHERE p.institucion_id = ? AND date(p.fecha) BETWEEN ? AND ?
         AND f.tipo IN ('normal','paciente','aseguradora')`
    ).bind(instId, desde, hasta).first<{ t: number }>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(cp.costo_unitario_snapshot * cp.cantidad), 0) AS t
         FROM consumo_paciente cp
        WHERE cp.institucion_id = ? AND date(cp.creado_en) BETWEEN ? AND ?`
    ).bind(instId, desde, hasta).first<{ t: number }>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(monto), 0) AS t FROM gasto
        WHERE institucion_id = ? AND date(fecha) BETWEEN ? AND ?`
    ).bind(instId, desde, hasta).first<{ t: number }>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(monto), 0) AS t FROM honorario_medico
        WHERE institucion_id = ? AND estado IN ('cobrado','entregado') AND date(creado_en) BETWEEN ? AND ?`
    ).bind(instId, desde, hasta).first<{ t: number }>(),
  ]);

  const totalIngresos    = +(ingresos?.t ?? 0).toFixed(2);
  const totalCogs        = +(cogs?.t ?? 0).toFixed(2);
  const totalGastos      = +(gastos?.t ?? 0).toFixed(2);
  const honorariosPaso   = +(honorariosCobrados?.t ?? 0).toFixed(2);
  const utilidadBruta    = +(totalIngresos - totalCogs).toFixed(2);
  const utilidadOperativa = +(utilidadBruta - totalGastos).toFixed(2);

  return c.json({
    periodo: { desde, hasta },
    ingresos: totalIngresos,
    cogs: totalCogs,
    utilidad_bruta: utilidadBruta,
    gastos_operativos: totalGastos,
    utilidad_operativa: utilidadOperativa,
    honorarios_paso: honorariosPaso,
    nota: "Los honorarios médicos son pasivo de paso y NO afectan la utilidad operativa.",
  });
});

// Reporte fiscal de honorarios por médico
app.get("/honorarios-fiscal", requireRole("admin", "facturacion"), async (c) => {
  const instId = getInstId(c);
  const desde = c.req.query("desde") ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const hasta = c.req.query("hasta") ?? new Date().toISOString().slice(0, 10);
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.nombres || ' ' || p.apellidos AS medico, p.numero_junta,
            COUNT(h.id) AS registros,
            SUM(h.monto) AS total_cobrado,
            SUM(CASE WHEN h.estado = 'entregado' THEN h.monto ELSE 0 END) AS total_entregado,
            SUM(CASE WHEN h.estado = 'cobrado'   THEN h.monto ELSE 0 END) AS pendiente_entrega
       FROM honorario_medico h
       JOIN profesional p ON p.id = h.profesional_id
      WHERE h.institucion_id = ?
        AND h.estado IN ('cobrado','entregado')
        AND date(h.creado_en) BETWEEN ? AND ?
      GROUP BY p.id, p.nombres, p.apellidos, p.numero_junta
      ORDER BY total_cobrado DESC`
  ).bind(instId, desde, hasta).all();
  return c.json({ periodo: { desde, hasta }, medicos: rows.results ?? [] });
});

export default app;
