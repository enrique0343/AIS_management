import type { Bindings } from "../env";

export async function logAudit(
  env: Bindings,
  opts: {
    usuario_id: number | null;
    accion: string;
    entidad: string;
    entidad_id?: number | null;
    payload?: unknown;
    ip?: string | null;
    institucion_id?: number | null;
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, payload, ip, institucion_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      opts.usuario_id,
      opts.accion,
      opts.entidad,
      opts.entidad_id ?? null,
      opts.payload ? JSON.stringify(opts.payload) : null,
      opts.ip ?? null,
      opts.institucion_id ?? null
    )
    .run();
}
