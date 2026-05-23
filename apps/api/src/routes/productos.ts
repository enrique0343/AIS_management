import { Hono } from "hono";
import { ProductoInput } from "@ais/shared";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

app.get("/", async (c) => {
  const q = c.req.query("q") ?? "";
  const controlado = c.req.query("controlado");
  const filtros: string[] = ["1=1"];
  const binds: (string | number)[] = [];
  if (q) {
    filtros.push("(p.nombre LIKE ? OR p.codigo LIKE ? OR p.principio_activo LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (controlado === "1") filtros.push("p.es_controlado = 1");
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.codigo, p.nombre, p.principio_activo, p.es_controlado,
            p.requiere_receta_especial, p.precio_venta, p.costo_promedio_ponderado,
            p.punto_reorden, p.stock_minimo, p.stock_maximo, p.registro_sanitario,
            c.nombre AS categoria, c.requiere_lote_vencimiento,
            u.abreviatura AS unidad,
            (SELECT COALESCE(SUM(cantidad), 0) FROM existencia WHERE producto_id = p.id) AS existencia_total
       FROM producto p
       JOIN categoria_producto c ON c.id = p.categoria_id
       JOIN unidad_medida u ON u.id = p.unidad_medida_id
      WHERE ${filtros.join(" AND ")}
      ORDER BY p.nombre
      LIMIT 500`
  )
    .bind(...binds)
    .all();
  return c.json({ data: results });
});

app.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const p = await c.env.DB.prepare(`SELECT * FROM producto WHERE id = ?`).bind(id).first();
  if (!p) return c.json({ error: "no_encontrado" }, 404);
  const lotes = await c.env.DB.prepare(
    `SELECT id, numero_lote, fecha_vencimiento, fecha_ingreso FROM lote WHERE producto_id = ? ORDER BY fecha_vencimiento`
  )
    .bind(id)
    .all();
  const existencias = await c.env.DB.prepare(
    `SELECT e.id, e.area_id, a.nombre AS area, e.lote_id, l.numero_lote, l.fecha_vencimiento, e.cantidad
       FROM existencia e
       JOIN area a ON a.id = e.area_id
       LEFT JOIN lote l ON l.id = e.lote_id
      WHERE e.producto_id = ? AND e.cantidad > 0
      ORDER BY a.nombre, l.fecha_vencimiento`
  )
    .bind(id)
    .all();
  return c.json({ producto: p, lotes: lotes.results, existencias: existencias.results });
});

// Sugiere el siguiente codigo para una categoria: PREFIJO-####
app.get("/_siguiente-codigo", async (c) => {
  const catId = parseInt(c.req.query("categoria_id") ?? "0", 10);
  if (!catId) return c.json({ error: "categoria_id_requerida" }, 400);
  const cat = await c.env.DB.prepare(`SELECT prefijo FROM categoria_producto WHERE id = ?`)
    .bind(catId)
    .first<{ prefijo: string }>();
  if (!cat?.prefijo) return c.json({ error: "categoria_sin_prefijo" }, 400);
  const max = await c.env.DB.prepare(
    `SELECT codigo FROM producto WHERE codigo LIKE ? ORDER BY codigo DESC LIMIT 1`
  )
    .bind(`${cat.prefijo}-%`)
    .first<{ codigo: string }>();
  let next = 1;
  if (max?.codigo) {
    const m = max.codigo.match(/-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return c.json({
    prefijo: cat.prefijo,
    siguiente: `${cat.prefijo}-${String(next).padStart(4, "0")}`,
  });
});

app.post("/", requireRole("admin", "jefe_farmacia_central", "farmaceutico"), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ProductoInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "datos_invalidos", detalle: parsed.error.flatten() }, 400);
  const d = parsed.data;

  // Validar que el codigo coincida con el prefijo de la categoria
  const cat = await c.env.DB.prepare(`SELECT prefijo FROM categoria_producto WHERE id = ?`)
    .bind(d.categoria_id)
    .first<{ prefijo: string }>();
  if (!cat) return c.json({ error: "categoria_no_encontrada" }, 400);
  if (cat.prefijo && !d.codigo.toUpperCase().startsWith(`${cat.prefijo}-`)) {
    return c.json({
      error: "codigo_no_coincide_con_categoria",
      esperado: `${cat.prefijo}-####`,
      recibido: d.codigo,
    }, 400);
  }

  const r = await c.env.DB.prepare(
    `INSERT INTO producto (codigo, nombre, principio_activo, categoria_id, unidad_medida_id,
       laboratorio_id, registro_sanitario, es_controlado, requiere_receta_especial,
       condiciones_almacenamiento, precio_venta, punto_reorden, stock_minimo, stock_maximo, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      d.codigo,
      d.nombre,
      d.principio_activo ?? null,
      d.categoria_id,
      d.unidad_medida_id,
      d.laboratorio_id ?? null,
      d.registro_sanitario ?? null,
      d.es_controlado ? 1 : 0,
      d.requiere_receta_especial ? 1 : 0,
      d.condiciones_almacenamiento ?? null,
      d.precio_venta,
      d.punto_reorden,
      d.stock_minimo,
      d.stock_maximo,
      d.activo ? 1 : 0
    )
    .run();
  const id = r.meta.last_row_id as number;
  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "crear",
    entidad: "producto",
    entidad_id: id,
    payload: d,
    ip: c.get("ip"),
  });
  return c.json({ id });
});

app.put("/:id", requireRole("admin", "jefe_farmacia_central", "farmaceutico"), async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json().catch(() => null);
  const parsed = ProductoInput.partial().safeParse(body);
  if (!parsed.success) return c.json({ error: "datos_invalidos" }, 400);

  // Si cambia codigo o categoria, revalidar prefijo
  if (parsed.data.codigo !== undefined || parsed.data.categoria_id !== undefined) {
    const actual = await c.env.DB.prepare(`SELECT codigo, categoria_id FROM producto WHERE id = ?`)
      .bind(id)
      .first<{ codigo: string; categoria_id: number }>();
    if (!actual) return c.json({ error: "no_encontrado" }, 404);
    const nuevoCodigo = parsed.data.codigo ?? actual.codigo;
    const nuevaCatId = parsed.data.categoria_id ?? actual.categoria_id;
    const cat = await c.env.DB.prepare(`SELECT prefijo FROM categoria_producto WHERE id = ?`)
      .bind(nuevaCatId)
      .first<{ prefijo: string }>();
    if (cat?.prefijo && !nuevoCodigo.toUpperCase().startsWith(`${cat.prefijo}-`)) {
      return c.json({
        error: "codigo_no_coincide_con_categoria",
        esperado: `${cat.prefijo}-####`,
        recibido: nuevoCodigo,
      }, 400);
    }
  }

  const fields: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    binds.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
  }
  if (!fields.length) return c.json({ ok: true });
  binds.push(id);
  await c.env.DB.prepare(`UPDATE producto SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "actualizar",
    entidad: "producto",
    entidad_id: id,
    payload: parsed.data,
    ip: c.get("ip"),
  });
  return c.json({ ok: true });
});

// Alertas: productos bajo punto de reorden
app.get("/_alertas/reorden", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.codigo, p.nombre, p.punto_reorden,
            (SELECT COALESCE(SUM(cantidad), 0) FROM existencia WHERE producto_id = p.id) AS existencia_total,
            p.proveedor_preferente_id
       FROM producto p
      WHERE p.activo = 1 AND p.punto_reorden > 0
        AND (SELECT COALESCE(SUM(cantidad), 0) FROM existencia WHERE producto_id = p.id) < p.punto_reorden
      ORDER BY p.nombre`
  ).all();
  return c.json({ data: results });
});

// Alertas: lotes proximos a vencer
app.get("/_alertas/vencimiento", async (c) => {
  const dias = parseInt(c.req.query("dias") ?? "90", 10);
  const { results } = await c.env.DB.prepare(
    `SELECT l.id AS lote_id, l.numero_lote, l.fecha_vencimiento,
            p.id AS producto_id, p.codigo, p.nombre,
            (SELECT COALESCE(SUM(cantidad), 0) FROM existencia WHERE lote_id = l.id) AS cantidad
       FROM lote l
       JOIN producto p ON p.id = l.producto_id
      WHERE date(l.fecha_vencimiento) <= date('now', '+' || ? || ' days')
        AND (SELECT COALESCE(SUM(cantidad), 0) FROM existencia WHERE lote_id = l.id) > 0
      ORDER BY l.fecha_vencimiento`
  )
    .bind(dias)
    .all();
  return c.json({ data: results });
});

export default app;
