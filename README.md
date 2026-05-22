# AIS Management

Sistema piloto de gestión interna hospitalaria sobre Cloudflare (Workers + D1 + R2 + KV + Pages).

Módulos: inventario de medicamentos e insumos médicos con cumplimiento del lineamiento SRS El Salvador `05.01.04.LIN.20250702.01` para controlados, compras con Costo Promedio Ponderado (CPP), pacientes, control de consumos por enfermería, facturación interna, programación de quirófano, profesionales médicos / enfermería / administrativos.

## Stack

- Backend: Hono en Cloudflare Workers (TypeScript)
- DB: Cloudflare D1 (SQLite)
- Sesiones: Cloudflare KV
- Documentos: Cloudflare R2
- Frontend: React 18 + Vite + TypeScript + Tailwind (Cloudflare Pages)

## Estructura

```
apps/
  api/    Hono Worker (API REST /api/*)
  web/    React + Vite SPA
packages/
  shared/ Tipos y esquemas zod compartidos
```

## Desarrollo

```bash
pnpm install
pnpm dev:api     # wrangler dev en http://localhost:8787
pnpm dev:web     # vite dev  en http://localhost:5173
```

### Migraciones D1

```bash
cd apps/api
npx wrangler d1 migrations apply ais_management --local
npx wrangler d1 migrations apply ais_management --remote
```

## Despliegue

```bash
cd apps/api && npx wrangler deploy
cd apps/web && pnpm build && npx wrangler pages deploy dist --project-name ais-web
```
