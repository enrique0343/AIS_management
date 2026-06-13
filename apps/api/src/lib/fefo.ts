import type { Bindings } from "../env";

export type LoteDisponible = {
  lote_id: number | null;
  numero_lote: string | null;
  fecha_vencimiento: string | null;
  cantidad: number;
};

/**
 * Sugiere lotes (FEFO) para descargar una cantidad de un producto en un area.
 * Retorna un plan de descarga ordenado por vencimiento ascendente (NULL al final).
 *
 * Lanza si no hay existencia suficiente.
 */
export async function planFEFO(
  env: Bindings,
  productoId: number,
  areaId: number,
  cantidad: number,
  institucionId = 1
): Promise<{ lote_id: number | null; tomar: number }[]> {
  const rows = await env.DB.prepare(
    `SELECT e.lote_id, l.numero_lote, l.fecha_vencimiento, e.cantidad
       FROM existencia e
       LEFT JOIN lote l ON l.id = e.lote_id
      WHERE e.producto_id = ? AND e.area_id = ? AND e.cantidad > 0
        AND e.institucion_id = ?
      ORDER BY (l.fecha_vencimiento IS NULL) ASC, l.fecha_vencimiento ASC, e.lote_id ASC`
  )
    .bind(productoId, areaId, institucionId)
    .all<LoteDisponible>();

  let restante = cantidad;
  const plan: { lote_id: number | null; tomar: number }[] = [];
  for (const r of rows.results ?? []) {
    if (restante <= 0) break;
    const tomar = Math.min(restante, r.cantidad);
    plan.push({ lote_id: r.lote_id, tomar });
    restante -= tomar;
  }
  if (restante > 1e-9) {
    throw new Error(
      `Existencia insuficiente: faltan ${restante.toFixed(4)} unidades para producto ${productoId} en area ${areaId}`
    );
  }
  return plan;
}
