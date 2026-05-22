import { Hono } from "hono";
import { cors } from "hono/cors";
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

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

app.use("*", sessionMiddleware);

app.get("/api/health", (c) =>
  c.json({ ok: true, env: c.env.APP_ENV, ts: new Date().toISOString() })
);

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

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal", message: err.message }, 500);
});

export default app;
