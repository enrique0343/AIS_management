# AIS Management — Análisis Completo y Roadmap de Mejoras

> **Fecha:** Junio 2026  
> **Repo:** `enrique0343/AIS_management`  
> **Rama activa:** `claude/continuation-0dqtd`

---

## Sección 1 — Estado actual del sistema

### Arquitectura general

| Capa | Tecnología | Detalle |
|---|---|---|
| **Runtime** | Cloudflare Workers | Hono v4, TypeScript strict |
| **Base de datos** | Cloudflare D1 (SQLite) | `cbc5a57a-cafa-4f26-b8c2-8e535c433e48` |
| **Sesiones** | Cloudflare KV | Token Bearer + TTL 8h |
| **Archivos** | Cloudflare R2 | Facturas de compra, comprobantes |
| **Frontend** | Workers Assets | SPA React + Vite + Tailwind |
| **Monorepo** | pnpm workspaces | `apps/api`, `apps/web`, `packages/shared` |
| **CI/CD** | GitHub Actions | TypeCheck + Deploy en push a main |

#### Multi-tenancy

Todas las 34 tablas de negocio llevan `institucion_id` (row-level). El slug se resuelve del subdominio:

- `ais.worke.net` → institución **principal**
- `psi.ais.worke.net` → institución **PSI Plastic Surgery Center**
- `*.workers.dev` / `localhost` → **principal** (desarrollo)

El helper `getInstId(c)` en el middleware de la API aplica automáticamente el filtro en cada query sin que cada ruta lo gestione manualmente.

#### RBAC — 9 roles

`admin`, `medico`, `enfermeria`, `farmaceutico`, `jefe_farmacia_central`, `responsable_stock`, `facturacion`, `programador_quirofano`, `super_admin`

---

### Migraciones (0001 – 0015)

| # | Archivo | Qué introduce |
|---|---|---|
| **0001** | `0001_init.sql` | Esquema base: `usuario`, `rol`, `usuario_rol`, `audit_log`, catálogos (`unidad_medida`, `categoria_producto`, `laboratorio_fabricante`, `proveedor`, `area`), `producto`, `lote`, `stock`, `paciente`, `episodio`, `consumo_paciente`, `cirugia`, `cirugia_consumo`, `cirugia_equipo`, `nota_enfermeria`, `requisicion`, `requisicion_item`, `factura`, `factura_detalle`, `pago`, `gasto`, `profesional`, `habitacion`. Semilla de roles y unidades de medida. Índices base. Alineado con lineamiento SRS El Salvador `05.01.04.LIN.20250702.01`. |
| **0002** | `0002_remove_physical_controls.sql` | Elimina controles físicos redundantes del esquema inicial. |
| **0003** | `0003_cirugia_consumo_area.sql` | Agrega columna `area_id` a `cirugia_consumo` para rastrear en qué área se usó cada insumo quirúrgico. |
| **0004** | `0004_habitaciones.sql` | Ajustes a tabla `habitacion` (tipo, piso, capacidad); relación con `episodio`. |
| **0005** | `0005_categoria_prefijo.sql` | Agrega `prefijo_folio` a `categoria_producto` para generar folios de requisición por categoría. |
| **0006** | `0006_alta_y_gastos.sql` | Columnas `en_cola_alta` + `fecha_alta` en `episodio`; tabla `gasto` con categorías y tipo (fijo/variable). |
| **0007** | `0007_cirugia_datetime.sql` | Migra campo `fecha` de `cirugia` a `datetime` ISO-8601 para soporte de anti-traslape en quirófano. |
| **0008** | `0008_requisiciones.sql` | Tabla `requisicion` + `requisicion_item` completa (estado `pendiente→despachada→cancelada`), folio auto, índices. |
| **0009** | `0009_devoluciones_pendientes.sql` | Columna `devuelto` y `devolucion_id` en `consumo_paciente` para trazabilidad de devoluciones a stock. |
| **0010** | `0010_producto_unidades_compra_srs.sql` | `unidad_compra`, `factor_conversion`, `codigo_srs`, `punto_reorden`, `stock_minimo` en `producto`. Normalización de conversión compra↔dispensación. |
| **0011** | `0011_multitenancy.sql` | **Gran migración**: agrega `institucion_id` a las 34 tablas de negocio; crea tabla `institucion`; índices compuestos por institución; tabla `profesional_institucion` para multi-institución de médicos. |
| **0012** | `0012_fix_unique_constraints.sql` | Ajusta constraints `UNIQUE` que rompían al pasar a multi-tenancy (uniqueness ahora es `(campo, institucion_id)`). |
| **0013** | `0013_area_activo.sql` | `ALTER TABLE area ADD COLUMN activo INTEGER NOT NULL DEFAULT 1` — habilita activar/desactivar áreas sin eliminar. |
| **0014** | `0014_seguro_medico.sql` | Tablas `aseguradora` y `poliza_paciente` (cobertura_pct %); columnas en `factura`: `tipo` (`normal`/`paciente`/`aseguradora`), `aseguradora_id`, `poliza_id`, `estado_seguro` (`pendiente`→`enviada`→`cobrada`), `fecha_envio_seguro`, `referencia_cobro_seguro`. |
| **0015** | `0015_honorarios.sql` | Tablas `honorario_medico` (estados `pendiente`→`cobrado`→`entregado`) y `entrega_honorario` — fondo de paso para honorarios médicos sin afectar contabilidad de la institución. |

---

### Módulos funcionales (16)

#### 1. Pacientes y Episodios
- Ficha completa: nombre, fecha nacimiento, DUI/pasaporte, teléfono, dirección.
- Episodios de hospitalización vinculados al paciente.
- Estado: `activo` / `en_cola_alta` / `alta`.
- **Seguros médicos**: gestión de pólizas por paciente (`poliza_paciente`) con aseguradora y porcentaje de cobertura; activar/desactivar póliza.

#### 2. Atención / Hospitalización
- Cola de pacientes pendientes de alta (`en_cola_alta = 1`).
- Asignación de habitaciones.
- Visualización de consumos por episodio.
- Acciones rápidas para pasar a facturación.

#### 3. Enfermería
- Registro de consumos de medicamentos/insumos por paciente (`consumo_paciente`).
- Descuento FEFO (First Expiration First Out): se descuenta del lote con menor fecha de vencimiento primero.
- Devoluciones: reingreso al stock con registro de motivo.
- Notas de enfermería por episodio.
- Snapshot de costos al momento del consumo (`costo_unitario_snapshot`, `precio_venta_snapshot`).

#### 4. Quirófano
- Programación de cirugías con datetime de inicio/fin.
- **Anti-traslape**: valida que el mismo médico o el mismo quirófano no tenga cirugías solapadas.
- Consumos de insumos por cirugía (con `area_id` del quirófano).
- Equipo quirúrgico (múltiples profesionales por cirugía con rol).
- Estadísticas de utilización.

#### 5. Farmacia / Requisiciones
- Requisiciones de áreas clínicas hacia farmacia central.
- Flujo: `pendiente → despachada / cancelada`.
- Folio automático por categoría de producto (prefijo configurable).
- Badge de requisiciones pendientes en el menú lateral.
- Despacho parcial o total con descuento de stock FEFO.

#### 6. Inventario
- Stock en tiempo real por producto/lote/institución.
- FEFO para consumos y despachos.
- Costo Promedio Ponderado (CPP): recalculado automáticamente en cada recepción de compra.
- Transferencias entre áreas/almacenes.
- Descartes SRS (cumplimiento normativo El Salvador).
- Ajustes de inventario con motivo y auditoría.

#### 7. Compras
- Órdenes de compra por proveedor.
- Recepciones parciales o totales; actualización automática de CPP.
- Factura del proveedor subida a R2 (PDF/imagen).
- Historial completo por proveedor.

#### 8. Facturación
- Cola de pacientes listos para facturar (badge en menú).
- Generación de factura con detalle de consumos + servicios.
- Descuentos por ítem y descuento global.
- IVA incluido en precio (desglose informativo).
- **Facturación con seguro**: si el episodio tiene póliza activa:
  - Cobertura parcial → genera 2 facturas: `tipo='paciente'` (copago) + `tipo='aseguradora'`.
  - Cobertura 100% → genera 1 factura `tipo='aseguradora'`; la factura del paciente queda anulada.
  - Proporcional de detalle copiado a cada factura.
- PDF imprimible (ruta `/facturas/:id/print`), con variantes detalle y resumen.
- Gestión de pagos por factura.

#### 9. Seguros Médicos (Cuentas por Cobrar a Aseguradoras)
- Catálogo de aseguradoras (activar/desactivar).
- Pólizas por paciente con porcentaje de cobertura y fecha de vencimiento.
- Tab "Cuentas Seguro" en Facturación con filtro por estado.
- Ciclo de vida: `pendiente → enviada → cobrada`.
  - **Enviar**: registra fecha de envío.
  - **Cobrar**: registra referencia de cobro; marca factura como `pagada`.
- Aging de cuentas por cobrar por aseguradora.

#### 10. Honorarios Médicos
- Registro de honorarios por episodio/cirugía/profesional.
- Estados: `pendiente → cobrado → entregado`.
- La institución actúa como **fondo de paso** (no comisiona): colecta los honorarios del paciente, los resguarda como pasivo y los entrega íntegros al médico.
- **Liquidación**: agrupa todos los honorarios `cobrado` de un médico, genera `entrega_honorario` con comprobante.
- Vista "Pendientes de entrega" por médico con total acumulado.
- Historial completo de entregas.
- **Sin impacto contable** en los ingresos/resultados de la institución.

#### 11. Gastos
- Registro de gastos operativos con categoría y tipo (fijo/variable).
- Fechas, montos, notas.
- Reporte de gastos por período.

#### 12. Reportes
- Reporte de facturación por período (ingresos, facturas emitidas).
- Consumo por paciente.
- Movimientos de inventario.
- Rotación de productos.

#### 13. Catálogos
- **Áreas**: nombre, tipo, bajo_llave, activo. Edición in-place; activar/desactivar (no eliminar).
- **Proveedores**: nombre, NIT, contacto, teléfono, email, condiciones de pago, activo. Editables desde UI.
- **Aseguradoras**: nombre, NIT, contacto, teléfono, email, activo. CRUD completo.
- Unidades de medida, categorías de productos, laboratorios.
- **Catálogo SRS**: productos autorizados por la Unidad Reguladora de Medicamentos de El Salvador.

#### 14. Profesionales
- Registro de médicos y profesionales de salud.
- Especialidad, número de junta, estado.
- Multi-institución vía `profesional_institucion`.

#### 15. Usuarios
- Alta, edición, activar/desactivar.
- Asignación de roles múltiples.
- Historial de auditoría (`audit_log`): quién hizo qué, cuándo, desde qué IP.

#### 16. Habitaciones
- Catálogo de habitaciones por tipo y piso.
- Asignación a episodios de hospitalización.

---

### Cronología de hitos del proyecto

| Hito | Descripción |
|---|---|
| **Esquema base** | 34 tablas, FEFO, CPP, RBAC 9 roles, requisiciones, quirófano anti-traslape |
| **Multi-tenancy** | Migration 0011: `institucion_id` en todas las tablas; helper `getInstId` |
| **Dominio propio** | `ais.worke.net` + `psi.ais.worke.net`; `resolveSlug` por subdominio |
| **Menú reorganizado** | Grupos Clínico / Administración / Configuración en sidebar |
| **Áreas editables** | CRUD completo de áreas + activar/desactivar (sin eliminar) |
| **Proveedores editables** | Edición in-place de proveedor desde Catálogos; campo `condiciones_pago` |
| **Seguros médicos** | Migration 0014; facturas duales copago/aseguradora; cuentas por cobrar con ciclo enviada→cobrada |
| **Honorarios médicos** | Migration 0015; fondo de paso pendiente→cobrado→entregado; liquidación grupal |

---

## Sección 2 — Roadmap de mejoras por fases

### Fase 1 — Automatización y Alertas *(~2-3 semanas)*

**¿Por qué primero?** Las siguientes fases dependen de infraestructura de notificaciones y emails. Esta fase la provee.

#### 1.1 Cron Triggers (Cloudflare)

```toml
# wrangler.toml
[triggers]
crons = ["0 7 * * *", "0 */4 * * *"]
```

Handler en `apps/api/src/index.ts`:

```typescript
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env) {
    if (event.cron === "0 7 * * *") await runDailyCierre(env);
    if (event.cron === "0 */4 * * *") await runAlerts(env);
  }
}
```

#### 1.2 Tabla `notificacion`

```sql
CREATE TABLE notificacion (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo         TEXT NOT NULL,           -- 'lote_por_vencer'|'stock_bajo'|'seguro_sin_cobro'|'honorario_pendiente'
  titulo       TEXT NOT NULL,
  cuerpo       TEXT,
  leida        INTEGER NOT NULL DEFAULT 0,
  usuario_id   INTEGER REFERENCES usuario(id),
  entidad      TEXT,
  entidad_id   INTEGER,
  creado_en    TEXT NOT NULL DEFAULT (datetime('now')),
  institucion_id INTEGER NOT NULL DEFAULT 1
);
```

UI: campana en `Layout.tsx` (top bar) con badge de no leídas y drawer de notificaciones.

#### 1.3 Alertas automáticas

| Alerta | Disparador | Frecuencia |
|---|---|---|
| Lotes por vencer (30/60/90 días) | `lote.fecha_vencimiento <= now + N días` | Diario 07:00 |
| Stock bajo punto de reorden | `stock.cantidad <= producto.punto_reorden` | Cada 4h |
| Factura aseguradora sin cobro > 30 días | `estado_seguro='enviada' AND fecha_envio < now - 30d` | Diario 07:00 |
| Honorarios cobrados sin liquidar > 15 días | `estado='cobrado' AND fecha_cobro < now - 15d` | Diario 07:00 |

#### 1.4 Email saliente — Resend API

```typescript
// Secret: RESEND_API_KEY en wrangler.toml
await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ from: "noreply@ais.worke.net", to, subject, html })
});
```

#### 1.5 Cierre diario automatizado

Snapshot por institución al final del día: total facturado, pagos recibidos, honorarios pendientes, valor de inventario. Tabla `cierre_dia` para histórico.

---

### Fase 2 — Expediente Clínico Electrónico *(~4-6 semanas)*

#### 2.1 Signos vitales

Tabla `signo_vital` con campos: `episodio_id`, `registrado_por`, `fecha`, `fc`, `ta_sistolica`, `ta_diastolica`, `spo2`, `temperatura`, `fr`, `glucosa`, `peso`, `talla`.

UI en Atención/Hospitalización: formulario de captura + gráfica de tendencia (líneas por parámetro, biblioteca recharts).

#### 2.2 Notas clínicas

```sql
CREATE TABLE nota_clinica (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  episodio_id  INTEGER NOT NULL REFERENCES episodio(id),
  tipo         TEXT NOT NULL,   -- 'ingreso'|'evolucion'|'interconsulta'|'egreso'
  cuerpo       TEXT NOT NULL,
  firmada      INTEGER NOT NULL DEFAULT 0,
  firmada_por  INTEGER REFERENCES profesional(id),
  fecha_firma  TEXT,
  creado_por   INTEGER REFERENCES usuario(id),
  creado_en    TEXT NOT NULL DEFAULT (datetime('now')),
  institucion_id INTEGER NOT NULL DEFAULT 1
);
```

Regla de negocio: **inmutable tras firma** — `UPDATE` bloqueado si `firmada = 1`.

#### 2.3 Diagnósticos + CIE-10

Tabla `diagnostico_episodio` + catálogo global `cie10` (código, nombre, categoría). Búsqueda por código o descripción con debounce. Los diagnósticos se incluyen en el resumen de egreso.

#### 2.4 Prescripciones → ciclo cerrado

```
Médico prescribe → requisición automática a Farmacia → Farmacia despacha → Enfermería registra administración (MAR básico)
```

Tabla `prescripcion`: `episodio_id`, `producto_id`, `dosis`, `frecuencia_horas`, `dias`, `via`, `estado`.  
Tabla `administracion_medicamento`: `prescripcion_id`, `dosis_administrada`, `administrado_por`, `fecha`.

Cierra el ciclo **prescripción → dispensación → administración** con trazabilidad completa.

#### 2.5 Documentos clínicos en R2

Ruta `{slug}/pacientes/{id}/lab-{timestamp}.pdf` para laboratorios, imágenes y estudios. Upload desde Atención; visualización directa en el expediente.

#### 2.6 Resumen de egreso imprimible

Ruta `/episodios/:id/print-egreso` (misma arquitectura de `FacturaPrint`): diagnósticos, signos vitales resumen, medicamentos, cirugías, notas de egreso.

#### 2.7 Workers AI — borrador de resumen

```typescript
const ai = new Ai(env.AI);
const resumen = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
  messages: [
    { role: "system", content: "Eres un asistente médico clínico. Redacta resúmenes de egreso." },
    { role: "user", content: `Datos del episodio: ${JSON.stringify(datos)}` }
  ]
});
```

Uso diferenciador: el médico revisa y firma el borrador — no reemplaza el criterio clínico.

---

### Fase 3 — Citas, Agenda y Portal del Paciente *(~4-5 semanas)*

#### 3.1 Agenda médica + citas

```sql
CREATE TABLE agenda_medico (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  profesional_id   INTEGER NOT NULL REFERENCES profesional(id),
  dia_semana       INTEGER,        -- 0=Dom … 6=Sab
  hora_inicio      TEXT,
  hora_fin         TEXT,
  duracion_cita    INTEGER,        -- minutos por cita
  activo           INTEGER NOT NULL DEFAULT 1,
  institucion_id   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE cita (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  profesional_id   INTEGER NOT NULL REFERENCES profesional(id),
  paciente_id      INTEGER NOT NULL REFERENCES paciente(id),
  fecha_hora       TEXT NOT NULL,
  duracion         INTEGER,
  tipo             TEXT,           -- 'consulta'|'seguimiento'|'procedimiento'
  estado           TEXT NOT NULL DEFAULT 'agendada',  -- agendada|confirmada|en_espera|atendida|no_show
  motivo           TEXT,
  notas            TEXT,
  creado_por       INTEGER REFERENCES usuario(id),
  institucion_id   INTEGER NOT NULL DEFAULT 1,
  creado_en        TEXT NOT NULL DEFAULT (datetime('now'))
);
```

UI: vista calendario semanal por médico (drag-to-book opcional); semáforo de disponibilidad.

#### 3.2 Recordatorios automáticos

Cron (Fase 1) 24h antes de cada cita: email + opcionalmente WhatsApp Business API.

**WhatsApp como diferenciador clave para El Salvador**: la mayoría de pacientes prefieren WhatsApp sobre email. Integración vía `api.whatsapp.com` o Twilio Conversations. Plantilla pre-aprobada: *"Su cita con Dr. [nombre] está programada para mañana [fecha] a las [hora]. Responda CONFIRMAR o CANCELAR."*

#### 3.3 Portal del paciente

Ruta separada `/portal` — login por número de expediente + OTP enviado por email/WhatsApp.

| Funcionalidad | Detalle |
|---|---|
| Ver citas | Lista y estado |
| Ver facturas | PDF de facturas propias |
| Estado de cuenta | Saldo pendiente |
| Historial | Episodios anteriores (read-only) |
| Resultados | Documentos de R2 (fase 2) |

El portal **no** tiene acceso al sistema interno. JWT separado, claims `{ tipo: 'portal', paciente_id }`.

---

### Fase 4 — Financiero / Contable *(~5-6 semanas)*

#### 4.1 Cuentas por pagar

Tabla `cuenta_pagar`: ligada a `orden_compra_id` y `recepcion_id`, con `fecha_vencimiento` calculada según `condiciones_pago` del proveedor.

UI: aging de proveedores (0-30, 31-60, 61-90, >90 días vencidos). Marcar como pagada con referencia de pago.

#### 4.2 Anticipos y depósitos de pacientes

Tabla `deposito_paciente`: `paciente_id`, `monto`, `fecha`, `aplicado`, `factura_id`.

Al facturar el alta, se descuenta automáticamente el depósito disponible; el saldo restante (si lo hay) genera una nota de crédito.

#### 4.3 Notas de crédito

Tabla `nota_credito` referenciando `factura_id`. Aplicable a facturas en estado `pagada`. Actualmente no existe mecanismo para devoluciones post-facturación.

#### 4.4 Conciliación de aseguradoras

Lotes de reclamos: agrupar facturas `tipo='aseguradora'` por aseguradora en un período para envío consolidado. Estado de cuenta por aseguradora con aging (0-30, 31-60, 61-90, >90 días desde envío).

#### 4.5 Arqueo/cierre de caja por turno

`cierre_caja`: `usuario_id`, `fecha_inicio`, `fecha_fin`, `efectivo_apertura`, `efectivo_cierre`, `total_cobrado`, `diferencia`, `observaciones`. Reporte imprimible del turno.

#### 4.6 Estado de resultados por institución

```
Ingresos = SUM(factura.total WHERE estado='pagada' AND tipo IN ('normal','paciente','aseguradora'))
- COGS   = SUM(consumo_paciente.costo_unitario_snapshot * cantidad)
- Gastos = SUM(gasto.monto)
─────────────────────────────────────
UTILIDAD OPERATIVA

Nota: Los honorarios médicos NO son ingreso; son pasivo de paso (honorario_medico).
```

#### 4.7 Reporte fiscal de honorarios

Constancia mensual por médico: total cobrado, desglose por paciente, para cumplimiento de retención fiscal. Exportable como PDF (mismo patrón FacturaPrint).

---

## Sección 3 — Diferenciadores innovadores (transversales)

### Workers AI — IA en el edge

| Caso de uso | Modelo sugerido | Valor |
|---|---|---|
| Borrador de resumen de egreso | `llama-3.1-8b-instruct` | Reduce tiempo de documentación médica |
| Sugerencia de códigos CIE-10 | `llama-3.1-8b-instruct` | Mejora precisión diagnóstica |
| Detección de anomalías de consumo | `llama-3.1-8b-instruct` | Identifica consumos atípicos vs. histórico |
| Chatbot de consultas para portal | `llama-3.1-8b-instruct` | Resuelve dudas sin llamada al hospital |

Todo en el edge de Cloudflare — **sin latencia de round-trip a servidores externos**, costos en uso no en infraestructura.

### WhatsApp Business API

Diferenciador crítico para El Salvador y Centroamérica donde WhatsApp tiene >90% de penetración:

- Recordatorios de citas (confirmación/cancelación por respuesta).
- Notificación de alta al familiar.
- Envío de factura digital.
- OTP para portal del paciente.

### Dashboard BI por institución

Con los datos ya existentes se puede construir un dashboard ejecutivo:

- **Ocupación hospitalaria**: camas ocupadas vs. disponibles en tiempo real.
- **Top 10 productos**: mayor consumo y mayor costo.
- **Tendencia de ingresos**: semana/mes/año comparativo.
- **Rotación de inventario**: productos estancados vs. de alta rotación.
- **Productividad quirúrgica**: cirugías por médico, tiempo promedio, uso de quirófano %.
- **Cartera de seguros**: aging y tasa de recuperación por aseguradora.

### PWA — Modo offline para signos vitales

Enfermería captura signos vitales incluso sin conexión (IndexedDB local). Sincronización automática al reconectar. Especialmente útil en zonas del hospital con cobertura WiFi intermitente.

```json
// manifest.json
{ "display": "standalone", "background_sync": true }
```

### API pública FHIR-lite

Endpoints de solo lectura para interoperabilidad futura:

```
GET /fhir/Patient/:id       → recurso Patient FHIR R4
GET /fhir/Encounter/:id     → recurso Encounter (episodio)
GET /fhir/MedicationRequest → prescripciones activas
```

Permite conexión con laboratorios externos, sistemas de imágenes (PACS), y reportes al Ministerio de Salud de El Salvador.

---

## Sección 4 — Tabla resumen del roadmap

| Fase | Módulo / Funcionalidad | Tablas nuevas | Esfuerzo estimado | Dependencias |
|---|---|---|---|---|
| **1** | Cron Triggers + notificaciones | `notificacion`, `cierre_dia` | 1 semana | — |
| **1** | Alertas automáticas (lotes, stock, seguros, honorarios) | — | 0.5 semanas | Tabla `notificacion` |
| **1** | Email saliente (Resend API) | — | 0.5 semanas | Secret `RESEND_API_KEY` |
| **2** | Signos vitales + gráfica | `signo_vital` | 1 semana | — |
| **2** | Notas clínicas (firmadas, inmutables) | `nota_clinica` | 1 semana | — |
| **2** | Diagnósticos + catálogo CIE-10 | `diagnostico_episodio`, `cie10` | 1 semana | — |
| **2** | Prescripciones → ciclo cerrado | `prescripcion`, `administracion_medicamento` | 2 semanas | Requisiciones (ya existe) |
| **2** | Documentos clínicos en R2 | — (R2 ya existe) | 0.5 semanas | R2 configurado |
| **2** | Resumen de egreso + Workers AI | — | 1 semana | Notas clínicas, diagnósticos |
| **3** | Agenda médica + citas | `agenda_medico`, `cita` | 1.5 semanas | Profesionales (ya existe) |
| **3** | Recordatorios WhatsApp/email | — | 0.5 semanas | Fase 1 (cron + email) |
| **3** | Portal del paciente | — (nueva ruta React) | 2 semanas | Fases 1+2 |
| **4** | Cuentas por pagar + aging | `cuenta_pagar` | 1 semana | Compras (ya existe) |
| **4** | Anticipos + notas de crédito | `deposito_paciente`, `nota_credito` | 1 semana | Facturación (ya existe) |
| **4** | Conciliación de aseguradoras | — (sobre tablas de Fase 0) | 1 semana | Seguros (ya existe, migración 0014) |
| **4** | Arqueo de caja por turno | `cierre_caja` | 1 semana | Facturación (ya existe) |
| **4** | Estado de resultados | — | 1 semana | Todo lo anterior |
| **4** | Reporte fiscal de honorarios | — | 0.5 semanas | Honorarios (ya existe, migración 0015) |

**Esfuerzo total estimado**: ~15-18 semanas de desarrollo para las 4 fases completas.

---

## Resumen ejecutivo

El sistema AIS Management ya es un **HIS (Hospital Information System) funcional** con 16 módulos operativos, multi-tenancy, seguros médicos y honorarios como fondo de paso. Las 15 migraciones establecen una base de datos robusta y normalizada.

El roadmap propuesto lo convierte en un **HIS de clase regional** incorporando:

1. **Infraestructura de alertas** (Fase 1) — elimina puntos ciegos operativos.
2. **Expediente clínico electrónico** (Fase 2) — cierra el ciclo asistencial completo.
3. **Citas + portal** (Fase 3) — digitaliza la relación con el paciente.
4. **Contabilidad completa** (Fase 4) — convierte el sistema en la fuente única de verdad financiera.

Los diferenciadores transversales (Workers AI, WhatsApp, FHIR-lite) posicionan el producto para el mercado centroamericano donde la penetración de smartphones es alta pero la infraestructura de HIS moderno es escasa.
