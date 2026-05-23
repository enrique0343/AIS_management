import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
app.use("*", requireAuth);

app.get("/categorias", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, nombre, descripcion FROM categoria_gasto ORDER BY nombre`
  ).all();
  return c.json({ data: results });
});

app.post("/categorias", requireRole("admin"), async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.nombre) return c.json({ error: "nombre_requerido" }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO categoria_gasto (nombre, descripcion) VALUES (?, ?)`
  )
    .bind(b.nombre, b.descripcion ?? null)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

app.get("/proveedores", async (c) => {
  const q = c.req.query("q") ?? "";
  const { results } = await c.env.DB.prepare(
    `SELECT id, nombre FROM proveedor WHERE activo = 1 AND nombre LIKE ? ORDER BY nombre LIMIT 50`
  ).bind(`%${q}%`).all();
  return c.json({ data: results });
});

app.post("/proveedores", requireRole("admin", "facturacion"), async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.nombre?.trim()) return c.json({ error: "nombre_requerido" }, 400);
  const nombre = b.nombre.trim();
  const existe = await c.env.DB.prepare(
    `SELECT id FROM proveedor WHERE nombre = ? AND activo = 1`
  ).bind(nombre).first<{ id: number }>();
  if (existe) return c.json({ id: existe.id, nombre });
  const r = await c.env.DB.prepare(
    `INSERT INTO proveedor (nombre, nit, contacto, telefono, email, condiciones_pago, activo)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).bind(
    nombre,
    b.nit?.trim() || null,
    b.contacto?.trim() || null,
    b.telefono?.trim() || null,
    b.email?.trim() || null,
    b.condiciones_pago?.trim() || null,
  ).run();
  return c.json({ id: r.meta.last_row_id, nombre });
});

app.get("/", async (c) => {
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const catId = c.req.query("categoria_id");
  const filt: string[] = ["1=1"];
  const binds: unknown[] = [];
  if (desde) { filt.push("date(g.fecha) >= ?"); binds.push(desde); }
  if (hasta) { filt.push("date(g.fecha) <= ?"); binds.push(hasta); }
  if (catId) { filt.push("g.categoria_id = ?"); binds.push(parseInt(catId, 10)); }
  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.fecha, g.categoria_id, c.nombre AS categoria,
            g.proveedor, g.descripcion, g.monto, g.doc_r2_key,
            u.nombre AS usuario
       FROM gasto_operativo g
       JOIN categoria_gasto c ON c.id = g.categoria_id
       LEFT JOIN usuario u ON u.id = g.usuario_id
      WHERE ${filt.join(" AND ")}
      ORDER BY g.fecha DESC, g.id DESC LIMIT 500`
  )
    .bind(...binds)
    .all();
  return c.json({ data: results });
});

app.post("/", requireRole("admin", "facturacion"), async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.categoria_id || !b?.descripcion || b?.monto === undefined) {
    return c.json({ error: "datos_invalidos" }, 400);
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO gasto_operativo (fecha, categoria_id, proveedor, descripcion, monto, usuario_id)
     VALUES (COALESCE(?, date('now')), ?, ?, ?, ?, ?)`
  )
    .bind(
      b.fecha ?? null,
      Number(b.categoria_id),
      b.proveedor ?? null,
      b.descripcion,
      Number(b.monto),
      c.get("session")!.usuario_id
    )
    .run();
  await logAudit(c.env, {
    usuario_id: c.get("session")!.usuario_id,
    accion: "registrar_gasto",
    entidad: "gasto_operativo",
    entidad_id: r.meta.last_row_id as number,
    payload: { categoria_id: b.categoria_id, monto: b.monto, descripcion: b.descripcion },
    ip: c.get("ip"),
  });
  return c.json({ id: r.meta.last_row_id });
});

// Adjuntar soporte (PDF/imagen) del gasto a R2
app.post(
  "/:id/soporte",
  requireRole("admin", "facturacion"),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const g = await c.env.DB.prepare(`SELECT id FROM gasto_operativo WHERE id = ?`).bind(id).first();
    if (!g) return c.json({ error: "no_encontrado" }, 404);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file") as unknown as
      | { name: string; size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> }
      | null;
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      return c.json({ error: "archivo_requerido" }, 400);
    }
    if (file.size > 10 * 1024 * 1024) return c.json({ error: "archivo_muy_grande_10mb_max" }, 400);
    const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
    const key = `gastos/${id}/${Date.now()}.${ext}`;
    await c.env.DOCS.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    await c.env.DB.prepare(`UPDATE gasto_operativo SET doc_r2_key = ? WHERE id = ?`)
      .bind(key, id)
      .run();
    return c.json({ ok: true, key });
  }
);

app.get("/:id/soporte", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const row = await c.env.DB.prepare(`SELECT doc_r2_key FROM gasto_operativo WHERE id = ?`)
    .bind(id)
    .first<{ doc_r2_key: string | null }>();
  if (!row?.doc_r2_key) return c.json({ error: "sin_documento" }, 404);
  const obj = await c.env.DOCS.get(row.doc_r2_key);
  if (!obj) return c.json({ error: "no_encontrado_en_r2" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${row.doc_r2_key.split("/").pop()}"`,
    },
  });
});

export default app;
