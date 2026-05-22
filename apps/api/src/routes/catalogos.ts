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
    `SELECT id, nombre, requiere_lote_vencimiento, es_servicio
       FROM categoria_producto ORDER BY nombre`
  ).all();
  return c.json({ data: results });
});

app.post("/categorias", requireRole("admin"), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.nombre) return c.json({ error: "nombre_requerido" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO categoria_producto (nombre, requiere_lote_vencimiento, es_servicio)
     VALUES (?, ?, ?)`
  )
    .bind(body.nombre, body.requiere_lote_vencimiento ? 1 : 0, body.es_servicio ? 1 : 0)
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

export default app;
