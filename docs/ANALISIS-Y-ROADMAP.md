# AIS Management — Análisis Completo y Roadmap de Mejoras

> **Fecha de documento:** 2026-06-11  
> **Rama activa:** `claude/continuation-0dqtd`  
> **Repositorio:** `enrique0343/AIS_management`

---

## Tabla de contenidos

1. [Arquitectura del sistema](#1-arquitectura-del-sistema)
2. [Historial de migraciones](#2-historial-de-migraciones)
3. [Módulos funcionales actuales](#3-módulos-funcionales-actuales)
4. [Control de acceso (RBAC)](#4-control-de-acceso-rbac)
5. [Cronología de hitos](#5-cronología-de-hitos)
6. [Roadmap de mejoras — 4 fases](#6-roadmap-de-mejoras--4-fases)
7. [Diferenciadores innovadores](#7-diferenciadores-innovadores)
8. [Tabla resumen del roadmap](#8-tabla-resumen-del-roadmap)

---

## 1. Arquitectura del sistema

### Stack tecnológico

| Capa | Tecnología | Detalle |
|---|---|---|
| Runtime API | Cloudflare Workers | Hono framework, TypeScript estricto |
| Base de datos | Cloudflare D1 | SQLite edge, ID `cbc5a57a-cafa-4f26-b8c2-8e535c433e48` |
| Sesiones | Cloudflare KV | Token UUID → JSON de usuario, TTL 8 h |
| Archivos | Cloudflare R2 | Facturas de compra PDF, documentos clínicos |
| Frontend | Workers Assets | SPA React 18, Vite, TailwindCSS |
| Monorepo | pnpm workspaces | `apps/api`, `apps/web`, `packages/shared` |
| CI/CD | GitHub Actions | TypeScript check + `wrangler deploy` en push a `main` |

### Multi-tenancy

- Todas las tablas de datos de negocio llevan `institucion_id INTEGER NOT NULL DEFAULT 1`.
- El helper `getInstId(c)` en el middleware del API resuelve el slug del subdominio a un `institucion_id`.
- Lógica de resolución de slug: si el hostname tiene ≥ 4 partes es un slug de cliente; 3 partes, `workers.dev` o `localhost` usan `"principal"`.
- Actualmente hay dos instituciones activas: **principal** (`ais.worke.net`) y **psi** (`psi.ais.worke.net` — PSI Plastic Surgery Center).

### Dominio de datos

34 tablas tenant (llevan `institucion_id`):

```
paciente, episodio, diagnostico, nota_enfermeria, consumo_paciente,
cirugia, cirugia_equipo_medico, cirugia_consumo,
requisicion, requisicion_item, devolucion_farmacia, devolucion_item,
factura, factura_detalle, pago,
honorario_medico, entrega_honorario,
aseguradora, poliza_paciente,
gasto,
inventario_lote, movimiento_inventario, transferencia_stock, descarte_srs, ajuste_inventario,
orden_compra, orden_compra_item, recepcion_compra, recepcion_item,
habitacion, habitacion_historial,
area, proveedor, profesional,
usuario_institucion
```

Tablas globales (sin `institucion_id`):
```
usuario, rol, usuario_rol, audit_log,
unidad_medida, categoria_producto, laboratorio_fabricante,
producto, producto_proveedor,
catalogo_srs, catalogo_srs_item,
institucion
```

---

## 2. Historial de migraciones

### `0001_init.sql` — Esquema inicial

Crea la base completa del sistema: `usuario`, `rol`, `usuario_rol`, `audit_log`, catálogos base (`unidad_medida`, `categoria_producto`, `laboratorio_fabricante`, `proveedor`, `area`), `producto` con campos de control SRS El Salvador (05.01.04.LIN.20250702.01: `requiere_lote_vencimiento`, `requiere_receta`, `es_controlado`), `inventario_lote`, `movimiento_inventario`, `paciente`, `episodio`, `diagnostico`, `nota_enfermeria`, `consumo_paciente` (con `costo_unitario_snapshot` y `precio_venta_snapshot`), `cirugia`, `cirugia_equipo_medico`, `cirugia_consumo`, `requisicion` / `requisicion_item`, `orden_compra` / `orden_compra_item`, `recepcion_compra` / `recepcion_item`.

### `0002_remove_physical_controls.sql` — Limpieza de controles físicos

Elimina columnas de control físico que resultaron redundantes con el sistema de lotes.

### `0003_cirugia_consumo_area.sql` — Áreas en cirugías

Agrega `area_id` a `cirugia_consumo` para registrar desde qué área se tomaron los insumos durante una cirugía.

### `0004_habitaciones.sql` — Módulo de habitaciones

Crea `habitacion` (número, tipo: individual/doble/suite/UCI, costo_dia, activo) y `habitacion_historial` (asignación de paciente → habitación por episodio, con fechas y tarifa_dia capturada).

### `0005_categoria_prefijo.sql` — Prefijos de categoría

Agrega `prefijo` a `categoria_producto` para generar códigos automáticos de producto con formato `{PREFIJO}-{n}`.

### `0006_alta_y_gastos.sql` — Cola de alta y gastos

Agrega `pendiente_alta INTEGER DEFAULT 0` a `episodio` (cola de facturación) y crea la tabla `gasto` (descripción, monto, fecha, categoría, comprobante_url, creado_por).

### `0007_cirugia_datetime.sql` — Fecha/hora en cirugías

Convierte los campos de cirugía de `DATE` a `TEXT` para soportar formato `datetime` completo. Agrega campos de hora inicio/fin reales vs. programados.

### `0008_requisiciones.sql` — Sistema de requisiciones de farmacia

Agrega el campo `estado` a `requisicion` (pendiente → aprobada → despachada → rechazada), `despachado_por`, `fecha_despacho`. Crea índices para la cola de pendientes.

### `0009_devoluciones_pendientes.sql` — Devoluciones a farmacia

Crea `devolucion_farmacia` y `devolucion_item` para registrar devoluciones de medicamentos desde enfermería hacia farmacia, con reversión automática al inventario (FEFO).

### `0010_producto_unidades_compra_srs.sql` — Unidades de compra y catálogo SRS

Agrega `unidad_compra_id` y `factor_conversion` a `producto` (comprar por caja, dispensar por unidad). Crea `catalogo_srs` y `catalogo_srs_item` para el catálogo oficial de medicamentos SRS El Salvador, con `producto_id` de enlace para conciliar stock.

### `0011_multitenancy.sql` — Multi-tenancy completo

La migración más grande. Agrega `institucion_id` a todas las tablas tenant. Crea la tabla `institucion` (nombre, slug, dominio, logo_url, activo). Crea `usuario_institucion` para vincular usuarios a instituciones con rol específico. Recrea índices únicos con `(campo, institucion_id)` donde aplica. Agrega `proveedor` como tabla tenant (mueve de global a por-institución). Agrega `factura`, `factura_detalle`, `pago` con soporte completo de facturación: descuentos por línea, IVA incluido, estado (pendiente/pagada/anulada), método de pago, correlativo por institución.

### `0012_fix_unique_constraints.sql` — Corrección de constraints únicos

Corrige constraints únicos que no consideraban `institucion_id`, causando colisiones entre instituciones diferentes. Afecta principalmente `paciente.expediente`, `area.nombre`, `habitacion.numero`.

### `0013_area_activo.sql` — Estado activo en áreas

```sql
ALTER TABLE area ADD COLUMN activo INTEGER NOT NULL DEFAULT 1;
```

Permite desactivar áreas sin eliminarlas, manteniendo integridad referencial con consumos históricos.

### `0014_seguro_medico.sql` — Seguros médicos

```sql
CREATE TABLE aseguradora (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL, nit TEXT, contacto TEXT,
  telefono TEXT, email TEXT, activo INTEGER NOT NULL DEFAULT 1,
  institucion_id INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE poliza_paciente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES paciente(id),
  aseguradora_id INTEGER NOT NULL REFERENCES aseguradora(id),
  numero_poliza TEXT NOT NULL, titular TEXT,
  cobertura_pct REAL NOT NULL DEFAULT 100,
  fecha_vence TEXT, activo INTEGER NOT NULL DEFAULT 1,
  institucion_id INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- En tabla factura se agregan:
-- tipo TEXT DEFAULT 'normal'  ('normal' | 'paciente' | 'aseguradora')
-- aseguradora_id INTEGER REFERENCES aseguradora(id)
-- poliza_id INTEGER REFERENCES poliza_paciente(id)
-- estado_seguro TEXT  (NULL | 'pendiente' | 'enviada' | 'cobrada')
-- fecha_envio_seguro TEXT
-- referencia_cobro_seguro TEXT
```

### `0015_honorarios.sql` — Honorarios médicos (fondo de paso)

```sql
CREATE TABLE honorario_medico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episodio_id INTEGER REFERENCES episodio(id),
  cirugia_id INTEGER REFERENCES cirugia(id),
  profesional_id INTEGER NOT NULL REFERENCES profesional(id),
  concepto TEXT NOT NULL,
  monto REAL NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | cobrado | entregado
  fecha_cobro TEXT,
  entrega_id INTEGER REFERENCES entrega_honorario(id),
  notas TEXT,
  creado_por INTEGER REFERENCES usuario(id),
  institucion_id INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE entrega_honorario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profesional_id INTEGER NOT NULL REFERENCES profesional(id),
  fecha TEXT NOT NULL,
  monto_total REAL NOT NULL,
  comprobante TEXT,
  notas TEXT,
  creado_por INTEGER REFERENCES usuario(id),
  institucion_id INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 3. Módulos funcionales actuales

### 3.1 Pacientes y Episodios

- Alta de paciente: expediente, datos demográficos, tipo de sangre, alergias.
- Episodio de hospitalización: fecha ingreso/egreso, motivo, estado (activo/cerrado).
- Vista detallada con historial de consumos, diagnósticos y notas de enfermería por episodio.
- **Seguros médicos**: agregar/editar/desactivar pólizas por paciente (aseguradora, número de póliza, titular, cobertura %, fecha de vencimiento).

### 3.2 Atención / Hospitalización

- Cola de alta: marca episodios `pendiente_alta=1` para que Facturación los procese.
- Asignación y cambio de habitación con tarifa capturada al momento de asignación.
- Vista de camas ocupadas/disponibles por tipo.

### 3.3 Enfermería

- Registro de consumos de medicamentos e insumos por paciente/episodio.
- Despacho FEFO: el sistema selecciona automáticamente el lote con fecha de vencimiento más próxima.
- Devoluciones a farmacia: reversa al inventario con restitución del lote original.
- Notas de enfermería con timestamp y usuario.

### 3.4 Quirófano

- Programación de cirugías con validación anti-traslape por quirófano (área tipo quirófano).
- Equipo médico por cirugía: cirujano principal, anestesiólogo, instrumentista, etc.
- Consumos intra-quirúrgicos registrados con `costo_unitario_snapshot`.
- Historial de cirugías por paciente/episodio.

### 3.5 Farmacia y Requisiciones

- Cola de requisiciones pendientes con badge numérico en el menú.
- Flujo: enfermería solicita → farmacia aprueba/rechaza → farmacia despacha.
- Despacho descuenta inventario FEFO automáticamente.
- Vista de devoluciones pendientes de procesar.

### 3.6 Inventario

- **FEFO** para todos los despachos (consumos, requisiciones, cirugías).
- **CPP (Costo Promedio Ponderado)**: recalculado automáticamente en cada recepción de compra.
  - Fórmula: `(stock_actual × costo_actual + cantidad_nueva × costo_nuevo) / (stock_actual + cantidad_nueva)`
- Transferencias entre áreas (de stock de área a área).
- **Descartes SRS**: registro de merma con motivo, fecha de vencimiento, vinculado al catálogo SRS oficial.
- Ajustes de inventario (entrada/salida manual con justificación).
- Alertas de stock (campos `punto_reorden` y `stock_minimo` ya existen en `inventario_lote`).

### 3.7 Compras

- Órdenes de compra con estado (borrador/enviada/recibida/cancelada).
- Recepción parcial o total de OC.
- Carga de factura de proveedor en PDF a R2 (`{slug}/compras/{id}/factura.pdf`).
- Recepción actualiza CPP automáticamente.
- Condiciones de pago por proveedor.

### 3.8 Facturación

- **Cola de alta**: lista de episodios con `pendiente_alta=1` listos para facturar.
- Cierre y facturación: genera `factura` + `factura_detalle` desde consumos del episodio.
  - Descuentos por línea y descuento global.
  - IVA incluido en precio de venta.
- **Seguros médicos en facturación**:
  - Si el paciente tiene póliza activa, seleccionar al cerrar.
  - Cobertura < 100%: crea dos facturas — `tipo='paciente'` (copago) y `tipo='aseguradora'` (parte cubierta).
  - Cobertura 100%: una sola factura `tipo='aseguradora'`.
  - Las líneas de detalle se prorratean proporcionalmente entre ambas facturas.
- **Cuentas por cobrar a aseguradoras** (tab "Cuentas Seguro"):
  - Estado: `pendiente → enviada → cobrada`.
  - Acción "Enviar a seguro": registra `fecha_envio_seguro`.
  - Acción "Registrar cobro": almacena `referencia_cobro_seguro`, marca factura como pagada.
- Badge de alta pendiente en el menú (naranja).
- PDF de factura: `FacturaPrint` (detallado), `FacturaPrintDetalle`, `FacturaPrintResumen`.

### 3.9 Honorarios Médicos (fondo de paso)

Principio contable: los honorarios **no son ingresos de la institución**. Se reciben como pasivo y se liquidan íntegramente al médico.

Flujo:
1. **Pendiente**: se registra el honorario (puede estar ligado a un episodio o cirugía).
2. **Cobrado**: el paciente pagó al médico a través de la institución (`POST /honorarios/:id/cobrar`).
3. **Entregado**: la institución liquida al médico mediante `entrega_honorario` (batch por profesional).

Vista "Pendientes de entrega": agrupa honorarios `cobrado` por médico con total acumulado → botón "Liquidar" abre modal para registrar comprobante de pago.

Vista "Historial de entregas": registro de todas las liquidaciones con monto, fecha y comprobante.

### 3.10 Gastos

- Registro de gastos operativos (no inventariables): monto, categoría, fecha, descripción, comprobante.
- Disponibles en reportes como salida de caja.

### 3.11 Reportes

- Reporte de ingresos por período (facturas pagadas, excluyendo honorarios).
- Reporte de consumos por paciente/episodio.
- Exportable a CSV/impresión.

### 3.12 Habitaciones

- Catálogo de habitaciones con número, tipo y costo por día.
- Historial de ocupación por episodio con tarifa capturada.

### 3.13 Profesionales

- Catálogo de médicos, anestesiólogos, etc. con especialidad y número de licencia.
- Vinculado a cirugías, consumos y honorarios.

### 3.14 Usuarios y Auditoría

- Gestión completa de usuarios con asignación de roles por institución.
- `audit_log`: registro de cada acción (entidad, entidad_id, payload, IP, usuario).
- Contraseña hasheada con bcrypt.
- Sesión via KV con TTL de 8 horas.

### 3.15 Catálogos

Módulo de configuración con los siguientes sub-catálogos gestionables en UI:

| Sub-catálogo | Funcionalidad |
|---|---|
| Áreas | Nombre, tipo (sala/quirófano/UCI/farmacia), bajo llave, **activar/desactivar** |
| Unidades de medida | Nombre y abreviatura |
| Categorías | Nombre, prefijo, requiere lote/vencimiento, es servicio |
| Laboratorios / Fabricantes | Nombre y país |
| Proveedores | Datos completos + condiciones de pago, **activar/desactivar** |
| **Aseguradoras** | Nombre, NIT, contacto, teléfono, email, **activar/desactivar** |
| Habitaciones | Tipo, costo/día |

### 3.16 Catálogo SRS

- Importación y consulta del catálogo oficial de medicamentos SRS El Salvador.
- Vinculación producto interno ↔ código SRS para reportes de descartes normativos.

---

## 4. Control de acceso (RBAC)

| Rol | Acceso principal |
|---|---|
| `admin` | Todo |
| `super_admin` | Gestión de instituciones (multi-tenant) |
| `medico` | Pacientes, Atención, Enfermería, Quirófano |
| `enfermeria` | Enfermería, Atención, Quirófano, Farmacia (consulta) |
| `facturacion` | Facturación, Honorarios, Gastos, Reportes, Pacientes |
| `farmaceutico` | Farmacia, Inventario, Productos, Catálogo SRS |
| `jefe_farmacia_central` | Todo de farmacia + Compras, Inventario completo, Catálogos |
| `responsable_stock` | Inventario, Farmacia, Catálogo SRS |
| `programador_quirofano` | Quirófano, Pacientes |

---

## 5. Cronología de hitos

| Hito | Descripción |
|---|---|
| Esquema inicial | 34 tablas, FEFO, CPP, RBAC, SPA React con TailwindCSS |
| Habitaciones | Módulo de camas con tarifa histórica |
| Multi-tenancy | `institucion_id` en todas las tablas, slug de subdominio, PSI añadido |
| Dominios | `ais.worke.net` principal + `psi.ais.worke.net` para PSI |
| Requisiciones | Cola farmacia con badge en menú |
| Devoluciones | Reversión FEFO a inventario |
| Catálogo SRS | Importación + vinculación producto↔SRS |
| Facturación PDF | Tres vistas de impresión (detallada, resumen, encabezado) |
| Gastos | Registro de egresos operativos |
| Reportes | Consolidado de ingresos y consumos |
| Áreas editables | `PUT /areas/:id`, desactivar/activar sin eliminar (migración 0013) |
| Proveedores editables | Datos + condiciones de pago editables desde Catálogos |
| Seguros médicos | Aseguradoras, pólizas, factura dual copago/seguro, cuentas por cobrar (migraciones 0014) |
| Honorarios médicos | Fondo de paso pendiente→cobrado→entregado, liquidación batch (migración 0015) |

---

## 6. Roadmap de mejoras — 4 fases

Las fases están ordenadas por dependencias: la Fase 1 (infraestructura de alertas) es prerequisito para las notificaciones de las fases siguientes.

---

### Fase 1 — Automatización y Alertas

**Duración estimada:** 2–3 semanas  
**Prerequisito:** Ninguno — base para todas las demás fases.

#### 1.1 Cron Triggers de Cloudflare

Agregar en `wrangler.toml`:

```toml
[triggers]
crons = ["0 7 * * *"]   # 7:00 AM diario
```

Implementar el handler `scheduled(event, env, ctx)` en `apps/api/src/index.ts`. Ejecuta el pipeline de alertas para todas las instituciones activas en paralelo.

#### 1.2 Tabla `notificacion`

```sql
CREATE TABLE notificacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  institucion_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,              -- 'lote_por_vencer' | 'stock_bajo' | 'seguro_pendiente' | 'honorario_pendiente'
  titulo TEXT NOT NULL,
  cuerpo TEXT,
  entidad TEXT,                    -- 'inventario_lote' | 'factura' | 'honorario_medico'
  entidad_id INTEGER,
  leida INTEGER NOT NULL DEFAULT 0,
  creada_en TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Centro de notificaciones en Layout: campana con badge numérico, panel deslizable con lista de alertas no leídas, acción "marcar como leída".

#### 1.3 Alertas automáticas (cron diario)

| Alerta | Condición | Destinatario |
|---|---|---|
| Lote por vencer | `fecha_vencimiento ≤ hoy + 30/60/90 días` | Jefe farmacia |
| Stock bajo punto de reorden | `cantidad_actual ≤ punto_reorden` (campo ya existe) | Jefe farmacia |
| Factura seguro sin cobro | `estado_seguro = 'enviada'` y `fecha_envio_seguro ≤ hoy - 30 días` | Facturación |
| Honorario cobrado sin liquidar | `estado = 'cobrado'` y `fecha_cobro ≤ hoy - 15 días` | Admin |

#### 1.4 Email saliente

- Integración con **Resend API** (secret `RESEND_API_KEY` en Cloudflare).
- Template HTML para cada tipo de alerta.
- Envío a los usuarios con rol correspondiente en la institución.

#### 1.5 Snapshot diario

- Cron genera `snapshot_caja` por institución: ingresos del día, gastos del día, honorarios cobrados pendientes de entrega.
- Sirve como base para el arqueo de caja (Fase 4).

**Archivos a crear/modificar:**
- `apps/api/wrangler.toml` — agregar `[triggers]`
- `apps/api/src/index.ts` — handler `scheduled`
- `apps/api/src/jobs/alertas.ts` — lógica de cada alerta
- `apps/api/src/jobs/email.ts` — wrapper Resend
- `apps/api/migrations/0016_notificaciones.sql`
- `apps/web/src/components/Layout.tsx` — campana de notificaciones
- `apps/web/src/components/NotificacionPanel.tsx` — panel

---

### Fase 2 — Expediente Clínico Electrónico (ECE)

**Duración estimada:** 4–6 semanas  
**Dependencias:** Fase 1 (alertas para valores críticos de signos vitales).

#### 2.1 Signos Vitales

```sql
CREATE TABLE signo_vital (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episodio_id INTEGER NOT NULL REFERENCES episodio(id),
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  fc INTEGER,          -- frecuencia cardiaca (lpm)
  pas INTEGER,         -- presión arterial sistólica
  pad INTEGER,         -- presión arterial diastólica
  spo2 REAL,           -- saturación O2 (%)
  temperatura REAL,    -- °C
  fr INTEGER,          -- frecuencia respiratoria
  glucosa REAL,        -- mg/dL
  peso REAL,           -- kg (opcional)
  registrado_por INTEGER REFERENCES usuario(id),
  institucion_id INTEGER NOT NULL DEFAULT 1
);
```

Vista gráfica de tendencia (gráfica de líneas por parámetro) en la pantalla de Atención. Alerta automática (Fase 1) para valores fuera de rango crítico.

#### 2.2 Notas Clínicas

```sql
CREATE TABLE nota_clinica (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episodio_id INTEGER NOT NULL REFERENCES episodio(id),
  tipo TEXT NOT NULL,   -- 'ingreso' | 'evolucion' | 'interconsulta' | 'egreso'
  contenido TEXT NOT NULL,
  firmada INTEGER NOT NULL DEFAULT 0,
  firmada_en TEXT,
  firmada_por INTEGER REFERENCES usuario(id),  -- médico
  creado_por INTEGER REFERENCES usuario(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  institucion_id INTEGER NOT NULL DEFAULT 1
);
```

**Inmutabilidad**: una vez firmada, la nota no puede editarse ni eliminarse (constraint a nivel de API y UI).

#### 2.3 Diagnósticos con CIE-10

```sql
CREATE TABLE catalogo_cie10 (
  codigo TEXT PRIMARY KEY,
  descripcion TEXT NOT NULL,
  categoria TEXT
);  -- tabla global, ~70,000 registros, carga única

CREATE TABLE diagnostico_episodio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episodio_id INTEGER NOT NULL REFERENCES episodio(id),
  cie10_codigo TEXT REFERENCES catalogo_cie10(codigo),
  descripcion_libre TEXT,
  tipo TEXT DEFAULT 'principal',  -- 'principal' | 'secundario' | 'complicacion'
  activo INTEGER NOT NULL DEFAULT 1,
  creado_por INTEGER REFERENCES usuario(id),
  institucion_id INTEGER NOT NULL DEFAULT 1
);
```

Búsqueda typeahead en UI (debounce 300 ms → `GET /api/cie10?q=`).

#### 2.4 Prescripciones y ciclo prescripción→dispensación→administración

```sql
CREATE TABLE prescripcion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episodio_id INTEGER NOT NULL REFERENCES episodio(id),
  producto_id INTEGER NOT NULL REFERENCES producto(id),
  dosis TEXT NOT NULL,
  via TEXT,              -- 'oral' | 'IV' | 'IM' | 'SC' | 'topica'
  frecuencia TEXT,       -- '8h' | '12h' | '24h'
  fecha_inicio TEXT,
  fecha_fin TEXT,
  estado TEXT DEFAULT 'activa',  -- 'activa' | 'suspendida' | 'completada'
  prescrito_por INTEGER REFERENCES usuario(id),
  requisicion_id INTEGER REFERENCES requisicion(id),  -- generada automáticamente
  institucion_id INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE mar (  -- Medication Administration Record
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prescripcion_id INTEGER NOT NULL REFERENCES prescripcion(id),
  fecha_programada TEXT NOT NULL,
  fecha_real TEXT,
  estado TEXT DEFAULT 'pendiente',  -- 'pendiente' | 'administrado' | 'omitido'
  administrado_por INTEGER REFERENCES usuario(id),
  notas TEXT,
  institucion_id INTEGER NOT NULL DEFAULT 1
);
```

Flujo completo: médico prescribe → sistema genera requisición a farmacia automáticamente → farmacia despacha → MAR de enfermería registra administración. Cierra el circuito de medicación.

#### 2.5 Documentos clínicos en R2

Ruta: `{slug}/pacientes/{paciente_id}/episodios/{episodio_id}/{tipo}/{filename}`.

Tipos: laboratorios, imágenes diagnósticas, interconsultas externas.

#### 2.6 Resumen de egreso imprimible

Reutilizar el patrón `FacturaPrint`: ruta `/episodios/:id/resumen-egreso` que renderiza una página imprimible con: datos del paciente, diagnósticos CIE-10, notas clínicas de egreso, medicamentos prescritos y consumidos, cirugías realizadas, días de hospitalización.

#### 2.7 Workers AI — asistente clínico

- **Borrador de nota de egreso**: `POST /api/episodios/:id/borrador-egreso` → llama a Workers AI con el contexto del episodio → devuelve texto borrador para que el médico lo edite y firme.
- **Sugerencia CIE-10**: dado el texto libre de un diagnóstico, sugerir los 3 códigos más probables.
- Modelo sugerido: `@cf/meta/llama-3.1-8b-instruct` (disponible en Workers AI sin costo adicional a nivel starter).

**Archivos a crear/modificar:**
- `apps/api/migrations/0017_signos_vitales.sql`
- `apps/api/migrations/0018_nota_clinica.sql`
- `apps/api/migrations/0019_prescripcion_mar.sql`
- `apps/api/migrations/0020_catalogo_cie10.sql`
- `apps/api/src/routes/expediente.ts` — signos vitales, notas, diagnósticos
- `apps/api/src/routes/prescripciones.ts`
- `apps/api/src/routes/mar.ts`
- `apps/web/src/pages/Atencion.tsx` — agregar tabs: Signos Vitales, Notas, Diagnósticos, Prescripciones
- `apps/web/src/pages/Enfermeria.tsx` — agregar MAR

---

### Fase 3 — Citas, Agenda y Portal del Paciente

**Duración estimada:** 4–5 semanas  
**Dependencias:** Fase 1 (recordatorios por email/WhatsApp), Fase 2 (ECE para consulta externa).

#### 3.1 Agenda médica y citas

```sql
CREATE TABLE agenda_medico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profesional_id INTEGER NOT NULL REFERENCES profesional(id),
  dia_semana INTEGER,        -- 0=lunes … 6=domingo (horario recurrente)
  fecha_especifica TEXT,     -- para bloques de una sola vez
  hora_inicio TEXT NOT NULL, -- 'HH:MM'
  hora_fin TEXT NOT NULL,
  duracion_cita_min INTEGER NOT NULL DEFAULT 30,
  activo INTEGER NOT NULL DEFAULT 1,
  institucion_id INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE cita (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profesional_id INTEGER NOT NULL REFERENCES profesional(id),
  paciente_id INTEGER NOT NULL REFERENCES paciente(id),
  fecha TEXT NOT NULL,
  hora_inicio TEXT NOT NULL,
  hora_fin TEXT NOT NULL,
  motivo TEXT,
  estado TEXT NOT NULL DEFAULT 'agendada',
    -- 'agendada' | 'confirmada' | 'en_espera' | 'atendida' | 'no_show' | 'cancelada'
  episodio_id INTEGER REFERENCES episodio(id),  -- ligado al llegar
  notas TEXT,
  creado_por INTEGER REFERENCES usuario(id),
  institucion_id INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Vista calendario semanal en frontend (tabla CSS grid, sin dependencias externas).

#### 3.2 Recordatorios automáticos

- Cron (Fase 1): día anterior a la cita → email al paciente con datos y ubicación.
- **WhatsApp Business API**: diferenciador clave para El Salvador. Mensaje de confirmación 24h antes + recordatorio 2h antes. Requiere aprobación de Meta y número dedicado, pero el costo por mensaje es bajo (~$0.005 USD).
- Template: "Recordatorio de cita con Dr. {nombre} mañana {fecha} a las {hora} en {institucion}. Responda SI para confirmar o NO para cancelar."
- Respuesta "SI/NO" procesada via webhook de WhatsApp.

#### 3.3 Portal del Paciente

Ruta separada `/portal` (sin Layout del sistema):

```
/portal/login          — autenticación por expediente + OTP vía email
/portal/citas          — próximas citas del paciente
/portal/historial      — episodios anteriores
/portal/facturas       — facturas propias con estado de pago
/portal/estado-cuenta  — balance con aseguradora (si aplica)
```

Autenticación: el paciente ingresa su número de expediente → el sistema envía OTP de 6 dígitos al email registrado → acceso de solo lectura durante 4 horas.

**Archivos a crear/modificar:**
- `apps/api/migrations/0021_agenda_citas.sql`
- `apps/api/src/routes/citas.ts`
- `apps/api/src/routes/portal.ts`
- `apps/web/src/pages/Agenda.tsx`
- `apps/web/src/pages/portal/PortalLogin.tsx`
- `apps/web/src/pages/portal/PortalHome.tsx`
- `apps/api/src/jobs/recordatorios.ts` — cron diario

---

### Fase 4 — Financiero / Contable

**Duración estimada:** 5–6 semanas  
**Dependencias:** Fase 1 (snapshot de caja), Fase 3 (cuentas por cobrar de citas).

#### 4.1 Cuentas por Pagar

```sql
CREATE TABLE cuenta_pagar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orden_compra_id INTEGER REFERENCES orden_compra(id),
  proveedor_id INTEGER NOT NULL REFERENCES proveedor(id),
  numero_factura_proveedor TEXT,
  monto REAL NOT NULL,
  fecha_factura TEXT NOT NULL,
  fecha_vence TEXT,              -- calculada de condiciones_pago del proveedor
  estado TEXT DEFAULT 'pendiente',  -- 'pendiente' | 'pagada' | 'vencida'
  fecha_pago TEXT,
  referencia_pago TEXT,
  notas TEXT,
  institucion_id INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Vista de aging de proveedores (0-30 días, 31-60, 61-90, >90).

#### 4.2 Anticipos de Pacientes

```sql
CREATE TABLE anticipo_paciente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES paciente(id),
  episodio_id INTEGER REFERENCES episodio(id),
  monto REAL NOT NULL,
  fecha TEXT NOT NULL,
  metodo_pago TEXT,
  aplicado INTEGER NOT NULL DEFAULT 0,  -- 1 cuando se aplica en facturación
  factura_id INTEGER REFERENCES factura(id),
  creado_por INTEGER REFERENCES usuario(id),
  institucion_id INTEGER NOT NULL DEFAULT 1
);
```

Al cerrar episodio, si el paciente tiene anticipos → se descuentan automáticamente del total a facturar.

#### 4.3 Notas de Crédito

```sql
CREATE TABLE nota_credito (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id INTEGER NOT NULL REFERENCES factura(id),
  motivo TEXT NOT NULL,
  monto REAL NOT NULL,
  estado TEXT DEFAULT 'pendiente',  -- 'pendiente' | 'aplicada' | 'anulada'
  aprobada_por INTEGER REFERENCES usuario(id),
  creado_por INTEGER REFERENCES usuario(id),
  institucion_id INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Flujo: solicitud de nota de crédito → aprobación por admin → se resta del saldo del paciente o se emite cheque.

#### 4.4 Conciliación de Aseguradoras

Ampliación del módulo de Cuentas por Cobrar (Seguros) actual:

- Lotes de reclamos por aseguradora (agrupar facturas para envío conjunto).
- Tracking de respuestas: monto aprobado vs. reclamado (puede haber ajustes).
- Aging de cuentas por cobrar a seguros: 0-30 / 31-60 / 61-90 / >90 días.
- Reporte por aseguradora: monto total reclamado, cobrado, pendiente, en disputa.

#### 4.5 Arqueo y Cierre de Caja

```sql
CREATE TABLE cierre_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuario(id),
  ingresos_efectivo REAL DEFAULT 0,
  ingresos_tarjeta REAL DEFAULT 0,
  ingresos_transferencia REAL DEFAULT 0,
  ingresos_seguro REAL DEFAULT 0,
  total_ingresos REAL DEFAULT 0,
  total_gastos REAL DEFAULT 0,
  honorarios_cobrados REAL DEFAULT 0,  -- pasivo, no es ingreso
  saldo_caja REAL DEFAULT 0,
  notas TEXT,
  institucion_id INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- El cron diario (Fase 1) genera el cierre automático a medianoche.
- El usuario de facturación puede generar el cierre manual durante el día.
- Exportable a PDF/CSV.

#### 4.6 Estado de Resultados

Reporte dinámico (sin tabla adicional, calculado en tiempo real):

```
Ingresos por servicios (facturas pagadas, tipo != 'honorario')
  − Costo de Ventas (CPP de consumos en facturas)
  = Utilidad Bruta
  − Gastos Operativos
  = Resultado Operativo
```

Nota: los honorarios médicos están excluidos por diseño (son un pasivo transitorio).

#### 4.7 Constancias de Retención de Honorarios

Reporte fiscal anual por médico:
- Total honorarios cobrados en el período.
- Total honorarios entregados.
- Diferencia pendiente.
- Exportable a PDF para declaración de impuestos (El Salvador: retención 10% ISR para honorarios).

**Archivos a crear/modificar:**
- `apps/api/migrations/0022_cuentas_pagar.sql`
- `apps/api/migrations/0023_anticipos.sql`
- `apps/api/migrations/0024_notas_credito.sql`
- `apps/api/migrations/0025_cierre_caja.sql`
- `apps/api/src/routes/cuentas_pagar.ts`
- `apps/api/src/routes/anticipos.ts`
- `apps/web/src/pages/Facturacion.tsx` — agregar tabs Cuentas Pagar, Anticipos, Cierres
- `apps/web/src/pages/Reportes.tsx` — agregar Estado de Resultados, Constancias honorarios

---

## 7. Diferenciadores innovadores

### Workers AI — Asistente Clínico

Cloudflare Workers AI está disponible directamente en el runtime sin cold starts adicionales:

```typescript
const ai = env.AI;  // binding en wrangler.toml: [[ai]]
const response = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
  messages: [{ role: "user", content: prompt }]
});
```

Casos de uso concretos:
- **Borrador de nota de egreso**: alimentar el modelo con consumos, diagnósticos y procedimientos del episodio.
- **Codificación asistida CIE-10**: el médico escribe diagnóstico en texto libre → el modelo sugiere los 3 códigos más probables.
- **Detección de anomalías de consumo**: comparar consumos del episodio actual contra el promedio histórico para el mismo tipo de episodio; alertar si hay desviaciones > 2σ.
- **Resumen de historia farmacológica**: dada la lista de prescripciones del paciente, generar un resumen de interacciones relevantes.

### WhatsApp Business API

Diferenciador clave para El Salvador y Centroamérica: la mayoría de los pacientes prefieren WhatsApp sobre email. El flujo de confirmación de citas con respuesta SI/NO reduce el no-show en ~30% (datos de industria).

Implementación sugerida:
- Proveedor: **360dialog** o **Twilio** (ambos tienen API REST compatible).
- Webhook en `/api/whatsapp/webhook` para procesar respuestas.
- Templates pre-aprobados por Meta: recordatorio de cita, resultado de laboratorio listo, estado de factura.

### Dashboard BI por Institución

Los datos ya existen en el sistema para construir un dashboard analítico:

| Métrica | Fuente |
|---|---|
| Ocupación de camas (%) | `habitacion_historial` |
| Rotación de inventario | `movimiento_inventario` |
| Días promedio de cobro a seguros | `factura.fecha_envio_seguro` → `fecha_cobro` |
| Top 10 medicamentos consumidos | `consumo_paciente JOIN producto` |
| Ingresos por médico | `cirugia_equipo_medico JOIN factura` |
| Costo promedio por tipo de episodio | `consumo_paciente GROUP BY` |

Implementación sugerida: Cloudflare Analytics Engine (eventos de métricas) + gráficas con la librería `recharts` (ya disponible en el bundle de React).

### Modo Offline-First (PWA)

Para enfermería en zonas con conectividad intermitente:

- Service Worker con `workbox` para cachear la SPA.
- IndexedDB para cola de operaciones offline (signos vitales, consumos).
- Sincronización automática al recuperar conexión.
- El API de Cloudflare Workers es naturalmente tolerante: D1 tiene replicación edge.

### API FHIR-lite

Para interoperabilidad futura con laboratorios externos, sistemas de referencia y sistemas nacionales de salud:

```
GET /fhir/Patient/:id          → recurso FHIR Patient
GET /fhir/Encounter/:id        → recurso FHIR Encounter (episodio)
GET /fhir/MedicationRequest/:id → recurso FHIR (prescripción)
```

Implementación mínima viable: transformar las entidades existentes al formato FHIR R4 JSON sin cambiar el modelo de datos interno. La autenticación sería via OAuth2 con scopes SMART on FHIR.

---

## 8. Tabla resumen del roadmap

| Fase | Módulo | Tablas nuevas | Esfuerzo est. | Dependencias |
|---|---|---|---|---|
| **1 — Automatización** | Cron Triggers | — | 3 días | — |
| **1** | Notificaciones in-app | `notificacion` | 3 días | — |
| **1** | Email (Resend) | — | 2 días | — |
| **1** | Alertas stock/lotes/seguros/honorarios | — | 4 días | Notificaciones |
| **1** | Snapshot de caja | `snapshot_caja` | 3 días | Cron |
| **2 — ECE** | Signos vitales + gráfica | `signo_vital` | 4 días | — |
| **2** | Notas clínicas firmadas | `nota_clinica` | 3 días | — |
| **2** | Diagnósticos CIE-10 | `catalogo_cie10`, `diagnostico_episodio` | 5 días | — |
| **2** | Prescripciones + MAR | `prescripcion`, `mar` | 7 días | Requisiciones existentes |
| **2** | Documentos en R2 | — | 3 días | R2 (ya configurado) |
| **2** | Resumen de egreso PDF | — | 3 días | FacturaPrint (ya existe) |
| **2** | Workers AI (CIE-10, borrador egreso) | — | 4 días | Workers AI binding |
| **3 — Citas** | Agenda médica | `agenda_medico` | 3 días | — |
| **3** | Citas + calendario semanal | `cita` | 5 días | Agenda |
| **3** | Recordatorios email/WhatsApp | — | 4 días | Fase 1, WhatsApp API |
| **3** | Portal del paciente | — | 8 días | Email OTP (Fase 1) |
| **4 — Financiero** | Cuentas por pagar | `cuenta_pagar` | 4 días | Compras |
| **4** | Anticipos de pacientes | `anticipo_paciente` | 3 días | Facturación |
| **4** | Notas de crédito | `nota_credito` | 3 días | Facturación |
| **4** | Conciliación aseguradoras | — | 5 días | Seguros (Fase 1 reqs) |
| **4** | Arqueo/cierre de caja | `cierre_caja` | 4 días | Fase 1 snapshot |
| **4** | Estado de resultados | — | 3 días | Gastos, Facturación |
| **4** | Constancias de retención honorarios | — | 2 días | Honorarios |

**Total estimado:** ~85–95 días de desarrollo (considerando un desarrollador senior full-stack con el contexto actual del sistema).

---

*Documento generado el 2026-06-11. Basado en el código real del repositorio `enrique0343/AIS_management`, rama `claude/continuation-0dqtd`.*
