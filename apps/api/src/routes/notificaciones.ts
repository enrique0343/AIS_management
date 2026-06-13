import { Hono } from "hono";
import type { Bindings, AppVariables } from "../env";
import { requireAuth, getInstId } from "../middleware/auth";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

app.use("*", requireAuth);

// GET /api/notificaciones?leida=0&limit=50
app.get("/", async (c) => {
  const instId = getInstId(c);
  const leida = c.req.query("leida");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);

  let q = `SELECT id, tipo, titulo, cuerpo, leida, entidad, entidad_id, creado_en
             FROM notificacion
            WHERE institucion_id = ?`;
  const binds: unknown[] = [instId];

  if (leida !== undefined) {
    q += " AND leida = ?";
    binds.push(leida === "1" ? 1 : 0);
  }

  q += " ORDER BY creado_en DESC LIMIT ?";
  binds.push(limit);

  const stmt = c.env.DB.prepare(q);
  const rows = await stmt.bind(...binds).all();
  return c.json(rows.results ?? []);
});

// GET /api/notificaciones/_count_no_leidas
app.get("/_count_no_leidas", async (c) => {
  const instId = getInstId(c);
  const r = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notificacion WHERE institucion_id = ? AND leida = 0"
  )
    .bind(instId)
    .first<{ n: number }>();
  return c.json({ n: r?.n ?? 0 });
});

// POST /api/notificaciones/:id/leer
app.post("/:id/leer", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"));
  await c.env.DB.prepare(
    "UPDATE notificacion SET leida = 1 WHERE id = ? AND institucion_id = ?"
  )
    .bind(id, instId)
    .run();
  return c.json({ ok: true });
});

// POST /api/notificaciones/leer-todas
app.post("/leer-todas", async (c) => {
  const instId = getInstId(c);
  await c.env.DB.prepare(
    "UPDATE notificacion SET leida = 1 WHERE institucion_id = ? AND leida = 0"
  )
    .bind(instId)
    .run();
  return c.json({ ok: true });
});

// DELETE /api/notificaciones/:id
app.delete("/:id", async (c) => {
  const instId = getInstId(c);
  const id = parseInt(c.req.param("id"));
  await c.env.DB.prepare(
    "DELETE FROM notificacion WHERE id = ? AND institucion_id = ?"
  )
    .bind(id, instId)
    .run();
  return c.json({ ok: true });
});

export default app;
