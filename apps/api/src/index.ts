import { Hono } from "hono";
import type { Bindings, AppVariables } from "./env";
import { sessionMiddleware } from "./middleware/auth";

import auth from "./routes/auth";
import catalogos from "./routes/catalogos";
import productos from "./routes/productos";
import compras from "./routes/compras";
import inventario from "./routes/inventario";
import pacientes from "./routes/pacientes";
import enfermeria from "./routes/enfermeria";
import facturacion from "./routes/facturacion";
import quirofano from "./routes/quirofano";
import profesionales from "./routes/profesionales";
import usuarios from "./routes/usuarios";
import habitaciones from "./routes/habitaciones";
import gastos from "./routes/gastos";
import reportes from "./routes/reportes";
import requisiciones from "./routes/requisiciones";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

app.use("*", sessionMiddleware);

app.get("/api/health", (c) =>
  c.json({ ok: true, env: c.env.APP_ENV, ts: new Date().toISOString() })
);

app.get("/api/dashboard", async (c) => {
  const session = c.get("session");
  const instId = session?.institucion_id ?? 0;
  const queries = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM producto WHERE activo = 1 AND institucion_id = ?`).bind(instId).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM paciente WHERE institucion_id = ?`).bind(instId).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM episodio_atencion WHERE estado = 'activo' AND institucion_id = ?`).bind(instId).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM cirugia WHERE date(fecha_programada) >= date('now') AND estado IN ('programada','en_curso') AND institucion_id = ?`).bind(instId).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS t FROM factura WHERE estado = 'pendiente' AND institucion_id = ?`).bind(instId).first<{ n: number; t: number }>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(monto), 0) AS t FROM pago WHERE date(fecha) = date('now') AND institucion_id = ?`).bind(instId).first<{ t: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT e.id FROM episodio_atencion e
          WHERE e.institucion_id = ?
            AND EXISTS (SELECT 1 FROM consumo_paciente cp WHERE cp.episodio_id = e.id AND cp.factura_detalle_id IS NULL)
       )`
    ).bind(instId).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT ROUND(
         COALESCE((
           SELECT SUM(cp.precio_venta_snapshot * cp.cantidad)
             FROM consumo_paciente cp
             JOIN episodio_atencion e ON e.id = cp.episodio_id
            WHERE e.estado = 'activo' AND cp.factura_detalle_id IS NULL AND e.institucion_id = ?
         ), 0) +
         COALESCE((
           SELECT SUM(
             MAX(CAST((julianday(COALESCE(oh.fecha_egreso, datetime('now'))) - julianday(oh.fecha_ingreso)) AS INTEGER), 1)
             * oh.precio_diario_snapshot
           )
             FROM ocupacion_habitacion oh
             JOIN episodio_atencion e2 ON e2.id = oh.episodio_id
            WHERE e2.estado = 'activo' AND oh.factura_detalle_id IS NULL AND e2.institucion_id = ?
         ), 0), 2) AS t`
    ).bind(instId, instId).first<{ t: number }>(),
  ]);
  return c.json({
    productos: queries[0]?.n ?? 0,
    pacientes: queries[1]?.n ?? 0,
    episodios_activos: queries[2]?.n ?? 0,
    cirugias_futuras: queries[3]?.n ?? 0,
    facturas_pendientes: queries[4]?.n ?? 0,
    monto_pendiente: queries[4]?.t ?? 0,
    ingresos_hoy: queries[5]?.t ?? 0,
    episodios_por_facturar: queries[6]?.n ?? 0,
    total_por_facturar: queries[7]?.t ?? 0,
  });
});

app.route("/api/auth", auth);
app.route("/api/catalogos", catalogos);
app.route("/api/productos", productos);
app.route("/api/compras", compras);
app.route("/api/inventario", inventario);
app.route("/api/pacientes", pacientes);
app.route("/api/enfermeria", enfermeria);
app.route("/api/facturacion", facturacion);
app.route("/api/quirofano", quirofano);
app.route("/api/profesionales", profesionales);
app.route("/api/usuarios", usuarios);
app.route("/api/habitaciones", habitaciones);
app.route("/api/gastos", gastos);
app.route("/api/reportes", reportes);
app.route("/api/requisiciones", requisiciones);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal", message: err.message }, 500);
});

// API: 404 explicito si no matchea ninguna ruta /api/*
app.all("/api/*", (c) => c.json({ error: "not_found", path: c.req.path }, 404));

// Cualquier otra ruta -> servir SPA (Workers Assets con SPA fallback).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
