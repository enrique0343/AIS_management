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

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

app.use("*", sessionMiddleware);

app.get("/api/health", (c) =>
  c.json({ ok: true, env: c.env.APP_ENV, ts: new Date().toISOString() })
);

app.get("/api/dashboard", async (c) => {
  const queries = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM producto WHERE activo = 1`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM paciente`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM episodio_atencion WHERE estado = 'activo'`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM cirugia WHERE date(fecha_programada) >= date('now') AND estado IN ('programada','en_curso')`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS t FROM factura WHERE estado = 'pendiente'`).first<{ n: number; t: number }>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(monto), 0) AS t FROM pago WHERE date(fecha) = date('now')`).first<{ t: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT e.id FROM episodio_atencion e
          WHERE EXISTS (SELECT 1 FROM consumo_paciente cp WHERE cp.episodio_id = e.id AND cp.factura_detalle_id IS NULL)
       )`
    ).first<{ n: number }>(),
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

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal", message: err.message }, 500);
});

// API: 404 explicito si no matchea ninguna ruta /api/*
app.all("/api/*", (c) => c.json({ error: "not_found", path: c.req.path }, 404));

// Cualquier otra ruta -> servir SPA (Workers Assets con SPA fallback).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
