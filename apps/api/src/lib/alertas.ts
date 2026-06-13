import type { Bindings } from "../env";
import { sendEmail } from "./email";

type InstRow = { id: number; nombre: string; email_admin?: string };

async function getInstituciones(db: D1Database): Promise<InstRow[]> {
  const r = await db.prepare("SELECT id, nombre FROM institucion WHERE activo = 1").all<InstRow>();
  return r.results ?? [];
}

async function crearNotificacion(
  db: D1Database,
  instId: number,
  tipo: string,
  titulo: string,
  cuerpo: string,
  entidad?: string,
  entidadId?: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notificacion (tipo, titulo, cuerpo, entidad, entidad_id, institucion_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(tipo, titulo, cuerpo, entidad ?? null, entidadId ?? null, instId)
    .run();
}

export async function runAlertasStockBajo(env: Bindings): Promise<void> {
  const insts = await getInstituciones(env.DB);
  for (const inst of insts) {
    const rows = await env.DB.prepare(
      `SELECT p.id, p.nombre, p.punto_reorden, COALESCE(SUM(s.cantidad),0) AS total
         FROM producto p
         LEFT JOIN stock s ON s.producto_id = p.id AND s.institucion_id = ?
        WHERE p.activo = 1 AND p.institucion_id = ? AND p.punto_reorden > 0
        GROUP BY p.id, p.nombre, p.punto_reorden
       HAVING total <= p.punto_reorden`
    )
      .bind(inst.id, inst.id)
      .all<{ id: number; nombre: string; punto_reorden: number; total: number }>();

    for (const row of rows.results ?? []) {
      const titulo = `Stock bajo: ${row.nombre}`;
      const cuerpo = `Stock actual: ${row.total} unidades. Punto de reorden: ${row.punto_reorden}.`;
      await crearNotificacion(env.DB, inst.id, "stock_bajo", titulo, cuerpo, "producto", row.id);
    }
  }
}

export async function runAlertasLotesPorVencer(env: Bindings): Promise<void> {
  const insts = await getInstituciones(env.DB);
  const umbrales = [30, 60, 90];
  for (const inst of insts) {
    for (const dias of umbrales) {
      const rows = await env.DB.prepare(
        `SELECT l.id, p.nombre AS producto, l.numero_lote, l.fecha_vencimiento,
                s.cantidad
           FROM lote l
           JOIN producto p ON p.id = l.producto_id
           JOIN stock s ON s.lote_id = l.id AND s.institucion_id = ?
          WHERE l.activo = 1
            AND l.institucion_id = ?
            AND l.fecha_vencimiento IS NOT NULL
            AND date(l.fecha_vencimiento) BETWEEN date('now') AND date('now', '+' || ? || ' days')
            AND s.cantidad > 0`
      )
        .bind(inst.id, inst.id, dias)
        .all<{ id: number; producto: string; numero_lote: string; fecha_vencimiento: string; cantidad: number }>();

      for (const row of rows.results ?? []) {
        const titulo = `Lote por vencer (${dias}d): ${row.producto}`;
        const cuerpo = `Lote ${row.numero_lote} vence el ${row.fecha_vencimiento}. Stock: ${row.cantidad} unidades.`;
        await crearNotificacion(env.DB, inst.id, "lote_por_vencer", titulo, cuerpo, "lote", row.id);
      }
    }
  }
}

export async function runAlertasSeguros(env: Bindings): Promise<void> {
  const insts = await getInstituciones(env.DB);
  for (const inst of insts) {
    const rows = await env.DB.prepare(
      `SELECT f.id, f.numero_factura, a.nombre AS aseguradora, f.total, f.fecha_envio_seguro
         FROM factura f
         JOIN aseguradora a ON a.id = f.aseguradora_id
        WHERE f.institucion_id = ?
          AND f.estado_seguro = 'enviada'
          AND f.fecha_envio_seguro IS NOT NULL
          AND julianday('now') - julianday(f.fecha_envio_seguro) > 30`
    )
      .bind(inst.id)
      .all<{ id: number; numero_factura: string; aseguradora: string; total: number; fecha_envio_seguro: string }>();

    for (const row of rows.results ?? []) {
      const titulo = `Cobro pendiente de seguro: ${row.numero_factura}`;
      const cuerpo = `Factura enviada a ${row.aseguradora} el ${row.fecha_envio_seguro} (>30 días sin cobrar). Monto: $${row.total.toFixed(2)}.`;
      await crearNotificacion(env.DB, inst.id, "seguro_sin_cobro", titulo, cuerpo, "factura", row.id);
    }
  }
}

export async function runAlertasHonorarios(env: Bindings): Promise<void> {
  const insts = await getInstituciones(env.DB);
  for (const inst of insts) {
    const rows = await env.DB.prepare(
      `SELECT h.id, pr.nombre AS medico, h.monto, h.fecha_cobro
         FROM honorario_medico h
         JOIN profesional pr ON pr.id = h.profesional_id
        WHERE h.institucion_id = ?
          AND h.estado = 'cobrado'
          AND h.fecha_cobro IS NOT NULL
          AND julianday('now') - julianday(h.fecha_cobro) > 15`
    )
      .bind(inst.id)
      .all<{ id: number; medico: string; monto: number; fecha_cobro: string }>();

    for (const row of rows.results ?? []) {
      const titulo = `Honorario cobrado sin liquidar: ${row.medico}`;
      const cuerpo = `Honorario de $${row.monto.toFixed(2)} cobrado el ${row.fecha_cobro} lleva más de 15 días sin ser entregado al médico.`;
      await crearNotificacion(env.DB, inst.id, "honorario_pendiente_entrega", titulo, cuerpo, "honorario_medico", row.id);
    }
  }
}

export async function runDailyCierre(env: Bindings): Promise<void> {
  await Promise.all([
    runAlertasLotesPorVencer(env),
    runAlertasSeguros(env),
    runAlertasHonorarios(env),
  ]);
}

export async function runFrequentAlerts(env: Bindings): Promise<void> {
  await runAlertasStockBajo(env);
}

export async function notificarAdmins(
  env: Bindings,
  instId: number,
  subject: string,
  html: string
): Promise<void> {
  const admins = await env.DB.prepare(
    `SELECT u.email FROM usuario u
      JOIN usuario_rol ur ON ur.usuario_id = u.id
      JOIN rol r ON r.id = ur.rol_id
      JOIN usuario_institucion ui ON ui.usuario_id = u.id
     WHERE ui.institucion_id = ? AND r.codigo IN ('admin','super_admin') AND u.activo = 1`
  )
    .bind(instId)
    .all<{ email: string }>();

  for (const a of admins.results ?? []) {
    await sendEmail(env, a.email, subject, html);
  }
}
