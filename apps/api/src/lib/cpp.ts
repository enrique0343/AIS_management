import type { Bindings } from "../env";

/**
 * Costo Promedio Ponderado (CPP) — siempre en unidad de VENTA.
 *
 * Cuando el producto tiene unidad de compra diferente a la de venta:
 *   - cantidadCompra: unidades de compra recibidas (ej. 5 cajas)
 *   - costoUnitarioCompra: costo por unidad de compra (ej. $30/caja)
 *   - factorConversion: unidades de venta por unidad de compra (ej. 30 tabletas/caja)
 *
 * El CPP se recalcula en unidades de venta:
 *   cantidadVenta   = cantidadCompra * factorConversion
 *   costoVenta      = costoUnitarioCompra / factorConversion
 *   CPP_nuevo = (existencia_total * CPP_actual + cantidadVenta * costoVenta)
 *               / (existencia_total + cantidadVenta)
 */
export async function recalcCPP(
  env: Bindings,
  productoId: number,
  cantidadCompra: number,
  costoUnitarioCompra: number,
  factorConversion = 1
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

  const factor = factorConversion > 0 ? factorConversion : 1;
  const cantidadVenta = cantidadCompra * factor;
  const costoVenta = costoUnitarioCompra / factor;

  let nuevo: number;
  if (existenciaTotal + cantidadVenta <= 0) {
    nuevo = costoVenta;
  } else if (existenciaTotal <= 0) {
    nuevo = costoVenta;
  } else {
    nuevo =
      (existenciaTotal * (prod.cpp ?? 0) + cantidadVenta * costoVenta) /
      (existenciaTotal + cantidadVenta);
  }
  nuevo = Math.round(nuevo * 1e6) / 1e6;

  await env.DB.prepare(`UPDATE producto SET costo_promedio_ponderado = ? WHERE id = ?`)
    .bind(nuevo, productoId)
    .run();

  return nuevo;
}
