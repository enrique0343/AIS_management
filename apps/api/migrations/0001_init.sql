-- AIS Management - Esquema inicial
-- Cumple con el lineamiento SRS El Salvador 05.01.04.LIN.20250702.01
-- para manejo de medicamentos controlados.

PRAGMA foreign_keys = ON;

-- =========================================================
-- USUARIOS, ROLES Y AUDITORIA
-- =========================================================
CREATE TABLE usuario (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  nombre          TEXT NOT NULL,
  activo          INTEGER NOT NULL DEFAULT 1,
  mfa_secret      TEXT,
  creado_en       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rol (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL
);

CREATE TABLE usuario_rol (
  usuario_id INTEGER NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  rol_id     INTEGER NOT NULL REFERENCES rol(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, rol_id)
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha       TEXT NOT NULL DEFAULT (datetime('now')),
  usuario_id  INTEGER REFERENCES usuario(id),
  accion      TEXT NOT NULL,
  entidad     TEXT NOT NULL,
  entidad_id  INTEGER,
  payload     TEXT,
  ip          TEXT
);
CREATE INDEX idx_audit_entidad ON audit_log(entidad, entidad_id);
CREATE INDEX idx_audit_fecha ON audit_log(fecha);

-- =========================================================
-- CATALOGOS BASE
-- =========================================================
CREATE TABLE unidad_medida (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT NOT NULL UNIQUE,
  abreviatura TEXT NOT NULL
);

CREATE TABLE categoria_producto (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre                      TEXT NOT NULL UNIQUE,
  requiere_lote_vencimiento   INTEGER NOT NULL DEFAULT 0,
  es_servicio                 INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE laboratorio_fabricante (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  pais   TEXT
);

CREATE TABLE proveedor (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre              TEXT NOT NULL,
  nit                 TEXT,
  contacto            TEXT,
  telefono            TEXT,
  email               TEXT,
  condiciones_pago    TEXT,
  activo              INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE area (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  tipo   TEXT NOT NULL CHECK (tipo IN (
    'farmacia_central','farmacia_periferica','quirofano',
    'servicio','consulta_externa','emergencia','almacen'
  )),
  bajo_llave INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE responsable_directo (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id         INTEGER NOT NULL REFERENCES area(id),
  usuario_id      INTEGER NOT NULL REFERENCES usuario(id),
  tipo            TEXT NOT NULL CHECK (tipo IN ('directo','stock','jefe')),
  vigente_desde   TEXT NOT NULL DEFAULT (date('now')),
  vigente_hasta   TEXT,
  nombramiento_r2 TEXT
);
CREATE INDEX idx_resp_area ON responsable_directo(area_id);

-- =========================================================
-- PRODUCTOS, LOTES, EXISTENCIAS, MOVIMIENTOS
-- =========================================================
CREATE TABLE producto (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo                        TEXT NOT NULL UNIQUE,
  nombre                        TEXT NOT NULL,
  principio_activo              TEXT,
  categoria_id                  INTEGER NOT NULL REFERENCES categoria_producto(id),
  unidad_medida_id              INTEGER NOT NULL REFERENCES unidad_medida(id),
  laboratorio_id                INTEGER REFERENCES laboratorio_fabricante(id),
  registro_sanitario            TEXT,
  es_controlado                 INTEGER NOT NULL DEFAULT 0,
  requiere_receta_especial      INTEGER NOT NULL DEFAULT 0,
  condiciones_almacenamiento    TEXT,
  precio_venta                  REAL NOT NULL DEFAULT 0,
  costo_promedio_ponderado      REAL NOT NULL DEFAULT 0,
  punto_reorden                 REAL NOT NULL DEFAULT 0,
  stock_minimo                  REAL NOT NULL DEFAULT 0,
  stock_maximo                  REAL NOT NULL DEFAULT 0,
  proveedor_preferente_id       INTEGER REFERENCES proveedor(id),
  activo                        INTEGER NOT NULL DEFAULT 1,
  creado_en                     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_producto_categoria ON producto(categoria_id);
CREATE INDEX idx_producto_controlado ON producto(es_controlado);

CREATE TABLE lote (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id         INTEGER NOT NULL REFERENCES producto(id),
  numero_lote         TEXT NOT NULL,
  fecha_vencimiento   TEXT NOT NULL,
  fecha_ingreso       TEXT NOT NULL DEFAULT (date('now')),
  UNIQUE (producto_id, numero_lote)
);
CREATE INDEX idx_lote_venc ON lote(fecha_vencimiento);

CREATE TABLE existencia (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL REFERENCES producto(id),
  area_id     INTEGER NOT NULL REFERENCES area(id),
  lote_id     INTEGER REFERENCES lote(id),
  cantidad    REAL NOT NULL DEFAULT 0,
  UNIQUE (producto_id, area_id, lote_id)
);
CREATE INDEX idx_existencia_pa ON existencia(producto_id, area_id);

CREATE TABLE movimiento_inventario (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha               TEXT NOT NULL DEFAULT (datetime('now')),
  tipo                TEXT NOT NULL CHECK (tipo IN (
    'ingreso_compra','transferencia_entrada','transferencia_salida',
    'consumo_paciente','devolucion','descarte','ajuste'
  )),
  producto_id         INTEGER NOT NULL REFERENCES producto(id),
  lote_id             INTEGER REFERENCES lote(id),
  area_origen_id      INTEGER REFERENCES area(id),
  area_destino_id     INTEGER REFERENCES area(id),
  cantidad            REAL NOT NULL,
  costo_unitario      REAL NOT NULL DEFAULT 0,
  usuario_id          INTEGER REFERENCES usuario(id),
  referencia_tipo     TEXT,   -- 'orden_compra' | 'receta' | 'consumo' | 'descarte' | 'transferencia' | 'ajuste'
  referencia_id       INTEGER,
  n_autorizacion_srs  TEXT,   -- SRS §7.2 (transferencia / importacion)
  observaciones       TEXT
);
CREATE INDEX idx_mov_producto ON movimiento_inventario(producto_id);
CREATE INDEX idx_mov_fecha ON movimiento_inventario(fecha);
CREATE INDEX idx_mov_tipo ON movimiento_inventario(tipo);

-- =========================================================
-- COMPRAS
-- =========================================================
CREATE TABLE orden_compra (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  numero        TEXT NOT NULL UNIQUE,
  proveedor_id  INTEGER NOT NULL REFERENCES proveedor(id),
  fecha         TEXT NOT NULL DEFAULT (date('now')),
  estado        TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN (
    'borrador','enviada','recibida_parcial','recibida','cancelada'
  )),
  subtotal      REAL NOT NULL DEFAULT 0,
  iva           REAL NOT NULL DEFAULT 0,
  total         REAL NOT NULL DEFAULT 0,
  usuario_id    INTEGER REFERENCES usuario(id),
  observaciones TEXT
);

CREATE TABLE orden_compra_detalle (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  orden_id        INTEGER NOT NULL REFERENCES orden_compra(id) ON DELETE CASCADE,
  producto_id     INTEGER NOT NULL REFERENCES producto(id),
  cantidad        REAL NOT NULL,
  costo_unitario  REAL NOT NULL,
  subtotal        REAL NOT NULL
);
CREATE INDEX idx_oc_det_orden ON orden_compra_detalle(orden_id);

CREATE TABLE recepcion_compra (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  orden_id              INTEGER NOT NULL REFERENCES orden_compra(id),
  fecha                 TEXT NOT NULL DEFAULT (date('now')),
  n_factura_proveedor   TEXT,
  doc_r2_key            TEXT,
  area_destino_id       INTEGER REFERENCES area(id),
  usuario_id            INTEGER REFERENCES usuario(id)
);

CREATE TABLE recepcion_compra_detalle (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  recepcion_id        INTEGER NOT NULL REFERENCES recepcion_compra(id) ON DELETE CASCADE,
  producto_id         INTEGER NOT NULL REFERENCES producto(id),
  lote_numero         TEXT,
  fecha_vencimiento   TEXT,
  cantidad            REAL NOT NULL,
  costo_unitario      REAL NOT NULL,
  n_autorizacion_srs  TEXT
);

-- =========================================================
-- PACIENTES, EPISODIOS, CONSUMOS, RECETA ESPECIAL
-- =========================================================
CREATE TABLE paciente (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  expediente          TEXT UNIQUE,
  nombres             TEXT NOT NULL,
  apellidos           TEXT NOT NULL,
  documento_tipo      TEXT CHECK (documento_tipo IN ('dui','pasaporte','residencia','menor')),
  documento_numero    TEXT,
  fecha_nacimiento    TEXT,
  sexo                TEXT CHECK (sexo IN ('M','F','O')),
  telefono            TEXT,
  direccion           TEXT,
  contacto_emergencia TEXT,
  alergias            TEXT,
  observaciones       TEXT,
  creado_por          INTEGER REFERENCES usuario(id),
  creado_en           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_paciente_docu ON paciente(documento_numero);
CREATE INDEX idx_paciente_nombre ON paciente(apellidos, nombres);

CREATE TABLE profesional_medico (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER UNIQUE REFERENCES usuario(id),
  nombres       TEXT NOT NULL,
  apellidos     TEXT NOT NULL,
  jvpm          TEXT,
  especialidad  TEXT,
  sello_r2_key  TEXT,
  activo        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE profesional_enfermeria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER UNIQUE REFERENCES usuario(id),
  nombres     TEXT NOT NULL,
  apellidos   TEXT NOT NULL,
  registro    TEXT,
  nivel       TEXT,
  activo      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE personal_administrativo (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER UNIQUE REFERENCES usuario(id),
  cargo       TEXT,
  area_id     INTEGER REFERENCES area(id),
  activo      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE episodio_atencion (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id                 INTEGER NOT NULL REFERENCES paciente(id),
  area_id                     INTEGER REFERENCES area(id),
  medico_id                   INTEGER REFERENCES profesional_medico(id),
  enfermera_responsable_id    INTEGER REFERENCES profesional_enfermeria(id),
  motivo                      TEXT,
  estado                      TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','cerrado')),
  fecha_inicio                TEXT NOT NULL DEFAULT (datetime('now')),
  fecha_fin                   TEXT
);
CREATE INDEX idx_episodio_paciente ON episodio_atencion(paciente_id);

CREATE TABLE receta_especial_retenida (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_serie            TEXT NOT NULL UNIQUE,
  episodio_id             INTEGER REFERENCES episodio_atencion(id),
  paciente_id             INTEGER NOT NULL REFERENCES paciente(id),
  medico_id               INTEGER NOT NULL REFERENCES profesional_medico(id),
  fecha                   TEXT NOT NULL DEFAULT (date('now')),
  estado                  TEXT NOT NULL DEFAULT 'emitida' CHECK (estado IN ('emitida','dispensada','anulada')),
  original_r2_key         TEXT,
  duplicado_r2_key        TEXT,
  triplicado_r2_key       TEXT,
  sello_dispensada_fecha  TEXT,
  observaciones           TEXT
);

CREATE TABLE consumo_paciente (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  episodio_id                 INTEGER NOT NULL REFERENCES episodio_atencion(id),
  producto_id                 INTEGER NOT NULL REFERENCES producto(id),
  lote_id                     INTEGER REFERENCES lote(id),
  area_id                     INTEGER NOT NULL REFERENCES area(id),
  cantidad                    REAL NOT NULL,
  costo_unitario_snapshot     REAL NOT NULL DEFAULT 0,
  precio_venta_snapshot       REAL NOT NULL DEFAULT 0,
  fecha                       TEXT NOT NULL DEFAULT (datetime('now')),
  usuario_id                  INTEGER REFERENCES usuario(id),
  receta_especial_id          INTEGER REFERENCES receta_especial_retenida(id),
  factura_detalle_id          INTEGER, -- se llena cuando se factura
  observaciones               TEXT
);
CREATE INDEX idx_consumo_ep ON consumo_paciente(episodio_id);
CREATE INDEX idx_consumo_fact ON consumo_paciente(factura_detalle_id);

-- =========================================================
-- FACTURACION INTERNA
-- =========================================================
CREATE TABLE factura (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  numero      TEXT NOT NULL UNIQUE,
  paciente_id INTEGER NOT NULL REFERENCES paciente(id),
  episodio_id INTEGER REFERENCES episodio_atencion(id),
  fecha       TEXT NOT NULL DEFAULT (datetime('now')),
  subtotal    REAL NOT NULL DEFAULT 0,
  iva         REAL NOT NULL DEFAULT 0,
  total       REAL NOT NULL DEFAULT 0,
  estado      TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada','anulada')),
  usuario_id  INTEGER REFERENCES usuario(id),
  observaciones TEXT
);

CREATE TABLE factura_detalle (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id      INTEGER NOT NULL REFERENCES factura(id) ON DELETE CASCADE,
  consumo_id      INTEGER REFERENCES consumo_paciente(id),
  descripcion     TEXT NOT NULL,
  cantidad        REAL NOT NULL,
  precio_unitario REAL NOT NULL,
  subtotal        REAL NOT NULL
);
CREATE INDEX idx_fd_factura ON factura_detalle(factura_id);

CREATE TABLE pago (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id  INTEGER NOT NULL REFERENCES factura(id),
  metodo      TEXT NOT NULL CHECK (metodo IN ('efectivo','tarjeta','transferencia','otro')),
  monto       REAL NOT NULL,
  fecha       TEXT NOT NULL DEFAULT (datetime('now')),
  referencia  TEXT,
  usuario_id  INTEGER REFERENCES usuario(id)
);

-- =========================================================
-- QUIROFANO
-- =========================================================
CREATE TABLE quirofano (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre    TEXT NOT NULL UNIQUE,
  ubicacion TEXT,
  activo    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE cirugia (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo                      TEXT NOT NULL UNIQUE,
  fecha_programada            TEXT NOT NULL,
  hora_inicio                 TEXT,
  hora_fin                    TEXT,
  quirofano_id                INTEGER NOT NULL REFERENCES quirofano(id),
  paciente_id                 INTEGER REFERENCES paciente(id),   -- puede asociarse despues
  paciente_pendiente_nombre   TEXT,                              -- placeholder hasta asociar
  tipo_cirugia                TEXT,
  medico_principal_id         INTEGER REFERENCES profesional_medico(id),
  anestesiologo_id            INTEGER REFERENCES profesional_medico(id),
  enfermera_circulante_id     INTEGER REFERENCES profesional_enfermeria(id),
  enfermera_instrumentista_id INTEGER REFERENCES profesional_enfermeria(id),
  estado                      TEXT NOT NULL DEFAULT 'programada' CHECK (estado IN (
    'programada','en_curso','realizada','suspendida','cancelada'
  )),
  observaciones               TEXT
);
CREATE INDEX idx_cirugia_fecha ON cirugia(fecha_programada);
CREATE INDEX idx_cirugia_quir ON cirugia(quirofano_id, fecha_programada);

CREATE TABLE cirugia_consumo (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  cirugia_id              INTEGER NOT NULL REFERENCES cirugia(id) ON DELETE CASCADE,
  producto_id             INTEGER NOT NULL REFERENCES producto(id),
  lote_id                 INTEGER REFERENCES lote(id),
  cantidad                REAL NOT NULL,
  costo_unitario_snapshot REAL NOT NULL DEFAULT 0,
  consumo_id              INTEGER REFERENCES consumo_paciente(id)
);
