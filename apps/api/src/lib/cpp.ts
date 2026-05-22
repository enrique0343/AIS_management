import type { Bindings } from "../env";

/**
 * Costo Promedio Ponderado (CPP).
 *
 *   CPP_nuevo = (existencia_total * CPP_actual + cantidad_recibida * costo_unitario)
 *               / (existencia_total + cantidad_recibida)
 *
 * Se invoca al confirmar una recepcion de compra, una linea por vez.
 * Si la existencia total es 0, el CPP queda igual al costo unitario recibido.
 */
export async function recalcCPP(
  env: Bindings,
  productoId: number,
  cantidadRecibida: number,
  costoUnitario: number
): Promise<number> {
  const prod = await env.DB.prepare(
    `SELECT costo_promedio_ponderado AS cpp FROM producto WHERE id = ?`
  )
    .bind(productoId)
    .first<{ cpp: number }>();
  if (!prod) throw new Error("producto no encontrado");

  const existRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(cantidad), 0) AS total FROM existencia WHERE producto_id = ?`
  )
    .bind(productoId)
    .first<{ total: number }>();
  const existenciaTotal = existRow?.total ?? 0;

  let nuevo: number;
  if (existenciaTotal + cantidadRecibida <= 0) {
    nuevo = costoUnitario;
  } else if (existenciaTotal <= 0) {
    nuevo = costoUnitario;
  } else {
    nuevo =
      (existenciaTotal * (prod.cpp ?? 0) + cantidadRecibida * costoUnitario) /
      (existenciaTotal + cantidadRecibida);
  }
  // Redondeo a 6 decimales para estabilidad numerica.
  nuevo = Math.round(nuevo * 1e6) / 1e6;

  await env.DB.prepare(`UPDATE producto SET costo_promedio_ponderado = ? WHERE id = ?`)
    .bind(nuevo, productoId)
    .run();

  return nuevo;
}
