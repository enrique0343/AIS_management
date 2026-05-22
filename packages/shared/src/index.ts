import { z } from "zod";

export const RoleCode = z.enum([
  "admin",
  "jefe_farmacia_central",
  "farmaceutico",
  "responsable_stock",
  "medico",
  "enfermeria",
  "facturacion",
  "programador_quirofano",
]);
export type RoleCode = z.infer<typeof RoleCode>;

export const AreaTipo = z.enum([
  "farmacia_central",
  "farmacia_periferica",
  "quirofano",
  "servicio",
  "consulta_externa",
  "emergencia",
  "almacen",
]);
export type AreaTipo = z.infer<typeof AreaTipo>;

export const MovimientoTipo = z.enum([
  "ingreso_compra",
  "transferencia_entrada",
  "transferencia_salida",
  "consumo_paciente",
  "devolucion",
  "descarte",
  "ajuste",
]);
export type MovimientoTipo = z.infer<typeof MovimientoTipo>;

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const ProductoInput = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  principio_activo: z.string().optional().nullable(),
  categoria_id: z.number().int().positive(),
  unidad_medida_id: z.number().int().positive(),
  laboratorio_id: z.number().int().positive().optional().nullable(),
  registro_sanitario: z.string().optional().nullable(),
  es_controlado: z.boolean().default(false),
  requiere_receta_especial: z.boolean().default(false),
  condiciones_almacenamiento: z.string().optional().nullable(),
  precio_venta: z.number().nonnegative().default(0),
  punto_reorden: z.number().nonnegative().default(0),
  stock_minimo: z.number().nonnegative().default(0),
  stock_maximo: z.number().nonnegative().default(0),
  activo: z.boolean().default(true),
});
export type ProductoInput = z.infer<typeof ProductoInput>;

export const RecepcionCompraInput = z.object({
  orden_compra_id: z.number().int().positive(),
  n_factura_proveedor: z.string().optional().nullable(),
  fecha: z.string(),
  detalles: z
    .array(
      z.object({
        producto_id: z.number().int().positive(),
        cantidad: z.number().positive(),
        costo_unitario: z.number().nonnegative(),
        lote_numero: z.string().optional().nullable(),
        fecha_vencimiento: z.string().optional().nullable(),
        n_autorizacion_srs: z.string().optional().nullable(),
      })
    )
    .min(1),
});
export type RecepcionCompraInput = z.infer<typeof RecepcionCompraInput>;
