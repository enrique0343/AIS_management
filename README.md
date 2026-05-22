# AIS Management

Sistema piloto de gestion interna hospitalaria sobre Cloudflare (Workers + D1 + R2 + KV + Pages).

## Modulos

- **Inventario**: medicamentos e insumos medicos con lote/vencimiento por categoria,
  CPP automatico, FEFO, alertas de reorden y vencimiento, valorizacion por area,
  transferencias entre areas, descartes con motivo, ajustes con justificacion.
- **Compras**: ordenes con CPP automatico al recibir, recepcion parcial, sugerencias
  por reorden, upload de factura del proveedor a R2.
- **Pacientes**: registro basico con expediente, episodios de atencion, vista detalle
  con historial de episodios.
- **Enfermeria**: registro de consumos por paciente con descarga FEFO de stock.
- **Facturacion**: factura interna con IVA configurable, cargos extra (servicios,
  quirofano), pagos por metodo, reporte de ingresos con exportacion CSV,
  impresion / PDF via navegador.
- **Quirofano**: programacion de cirugias con vista calendario semanal y tabla,
  asociacion posterior de paciente, consumos intra-cirugia con FEFO, volcado
  automatico a consumo del paciente al cerrar (estado=realizada).
- **Profesionales**: medicos, enfermeria, administrativos.
- **Usuarios y roles**: granulares (admin, jefe_farmacia_central, farmaceutico,
  responsable_stock, medico, enfermeria, facturacion, programador_quirofano),
  bitacora de auditoria inmutable.
- **Catalogos**: proveedores, laboratorios, areas, categorias, unidades.
- **Dashboard**: KPIs y alertas (reorden, vencimiento).

> Nota normativa: el control fisico exigido por la SRS para medicamentos controlados
> (libro autorizado, receta especial retenida original/duplicado/triplicado, sello
> DISPENSADA) se maneja FUERA del sistema. El sistema solo conserva trazabilidad
> de movimientos de inventario.

## Stack

- Backend: Hono en Cloudflare Workers (TypeScript)
- DB: Cloudflare D1 (SQLite) - migraciones gestionadas por wrangler
- Sesiones: Cloudflare KV (Argon2id, cookie HttpOnly)
- Documentos: Cloudflare R2 (facturas de proveedor)
- Frontend: React 18 + Vite + TypeScript + Tailwind (Cloudflare Pages)

## Estructura

```
apps/
  api/    Hono Worker (API REST /api/*)
  web/    React + Vite SPA
packages/
  shared/ Tipos y esquemas zod compartidos
```

## Setup

```bash
pnpm install
```

### Aprovisionar Cloudflare

```bash
cd apps/api
npx wrangler d1 create ais_management         # copiar database_id a wrangler.toml
npx wrangler kv namespace create SESSIONS     # copiar id a wrangler.toml
npx wrangler r2 bucket create ais-docs
```

### Migraciones y seed

```bash
pnpm --filter @ais/api db:migrate:local
pnpm --filter @ais/api db:seed:local
# y/o remote
pnpm --filter @ais/api db:migrate:remote
pnpm --filter @ais/api db:seed:remote
```

### Desarrollo

```bash
pnpm dev:api    # wrangler dev en http://localhost:8787
pnpm dev:web    # vite dev en http://localhost:5173
```

Crear admin inicial via API (sin auth porque aun no hay usuarios):

```bash
curl -X POST http://localhost:5173/api/auth/bootstrap \
  -H 'content-type: application/json' \
  -d '{"email":"admin@ais.local","password":"admin123","nombre":"Admin"}'
```

## Despliegue

```bash
cd apps/api && npx wrangler deploy
cd apps/web && pnpm build && npx wrangler pages deploy dist --project-name ais-web
```

## Flujo end-to-end de prueba

1. Login como admin -> Catalogos -> agregar Proveedor.
2. Productos -> Nuevo (categoria Medicamento + unidad).
3. Compras -> Nueva OC -> agregar lineas y guardar.
4. Compras -> Recibir -> elegir area destino, capturar lote/vencimiento,
   adjuntar factura proveedor (opcional). Verifica CPP en Productos.
5. Pacientes -> Nuevo -> Ver -> Nuevo episodio.
6. Enfermeria -> seleccionar paciente -> episodio -> registrar consumos.
7. Pacientes -> Ver -> Cerrar episodio.
8. Facturacion -> seleccionar episodio -> Emitir -> Ver -> Imprimir / PDF.
9. Quirofano -> Programar cirugia (con o sin paciente) -> Calendario.
10. Dashboard refleja KPIs e ingresos del dia.
```
