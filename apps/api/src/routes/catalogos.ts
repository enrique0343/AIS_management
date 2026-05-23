import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole } from "../middleware/auth";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

app.use("*", requireAuth);

app.get("/unidades-medida", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, nombre, abreviatura FROM unidad_medida ORDER BY nombre`
  ).all();
  return c.json({ data: results });
});

app.get("/categorias", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, nombre, prefijo, requiere_lote_vencimiento, es_servicio
       FROM categoria_producto ORDER BY nombre`
  ).all();
  return c.json({ data: results });
});

app.post("/categorias", requireRole("admin"), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.nombre || !body?.prefijo) return c.json({ error: "nombre_y_prefijo_requeridos" }, 400);
  const prefijo = String(body.prefijo).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (prefijo.length < 2 || prefijo.length > 5) return c.json({ error: "prefijo_invalido_2_a_5_alfanumerico" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO categoria_producto (nombre, prefijo, requiere_lote_vencimiento, es_servicio)
     VALUES (?, ?, ?, ?)`
  )
    .bind(body.nombre, prefijo, body.requiere_lote_vencimiento ? 1 : 0, body.es_servicio ? 1 : 0)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

app.get("/laboratorios", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, nombre, pais FROM laboratorio_fabricante ORDER BY nombre`
  ).all();
  return c.json({ data: results });
});

app.post("/laboratorios", requireRole("admin", "jefe_farmacia_central"), async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.nombre) return c.json({ error: "nombre_requerido" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO laboratorio_fabricante (nombre, pais) VALUES (?, ?)`
  )
    .bind(b.nombre, b.pais ?? null)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

app.get("/proveedores", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, nombre, nit, contacto, telefono, email, condiciones_pago, activo
       FROM proveedor WHERE activo = 1 ORDER BY nombre`
  ).all();
  return c.json({ data: results });
});

app.post("/proveedores", requireRole("admin", "jefe_farmacia_central"), async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.nombre) return c.json({ error: "nombre_requerido" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO proveedor (nombre, nit, contacto, telefono, email, condiciones_pago)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(b.nombre, b.nit ?? null, b.contacto ?? null, b.telefono ?? null, b.email ?? null, b.condiciones_pago ?? null)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

app.get("/areas", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, nombre, tipo, bajo_llave FROM area ORDER BY nombre`
  ).all();
  return c.json({ data: results });
});

app.get("/lotes-producto", async (c) => {
  const pid = c.req.query("producto_id");
  if (!pid) return c.json({ error: "producto_id_requerido" }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT id, numero_lote, fecha_vencimiento FROM lote WHERE producto_id = ? ORDER BY fecha_vencimiento ASC`
  ).bind(parseInt(pid, 10)).all();
  return c.json({ data: results });
});

app.post("/areas", requireRole("admin"), async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.nombre || !b?.tipo) return c.json({ error: "datos_invalidos" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO area (nombre, tipo, bajo_llave) VALUES (?, ?, ?)`
  )
    .bind(b.nombre, b.tipo, b.bajo_llave ? 1 : 0)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

app.get("/srs", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ data: [] });
  const like = `%${q}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT id, registro_sanitario, nombre_comercial, principio_activo,
            concentracion, forma_farmaceutica, fabricante, pvmp
       FROM catalogo_srs
      WHERE estado = 'A'
        AND (nombre_comercial LIKE ? OR principio_activo LIKE ? OR registro_sanitario LIKE ?)
      LIMIT 20`
  )
    .bind(like, like, like)
    .all();
  return c.json({ data: results });
});

export default app;
