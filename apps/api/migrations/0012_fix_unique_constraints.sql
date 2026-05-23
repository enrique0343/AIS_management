-- ============================================================
-- 0012: Convierte UNIQUE simples en UNIQUE compuestos con institucion_id
-- SQLite no soporta ALTER TABLE para modificar constraints, requiere
-- recrear la tabla. Se usa PRAGMA foreign_keys = OFF para evitar errores
-- de FK durante la recreación. Los FK de otras tablas al nombre de la
-- tabla siguen funcionando tras el RENAME.
-- ============================================================

PRAGMA foreign_keys = OFF;

-- ---- usuario ------------------------------------------------
CREATE TABLE usuario_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  activo         INTEGER NOT NULL DEFAULT 1,
  mfa_secret     TEXT,
  creado_en      TEXT NOT NULL DEFAULT (datetime('now')),
  institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id),
  UNIQUE (email, institucion_id)
);
INSERT INTO usuario_new SELECT id, email, password_hash, nombre, activo, mfa_secret, creado_en, institucion_id FROM usuario;
DROP TABLE usuario;
ALTER TABLE usuario_new RENAME TO usuario;

-- ---- categoria_producto -------------------------------------
CREATE TABLE categoria_producto_new (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre                    TEXT NOT NULL,
  requiere_lote_vencimiento INTEGER NOT NULL DEFAULT 0,
  es_servicio               INTEGER NOT NULL DEFAULT 0,
  prefijo                   TEXT NOT NULL DEFAULT '',
  institucion_id            INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id),
  UNIQUE (nombre, institucion_id)
);
INSERT INTO categoria_producto_new SELECT id, nombre, requiere_lote_vencimiento, es_servicio, prefijo, institucion_id FROM categoria_producto;
DROP TABLE categoria_producto;
ALTER TABLE categoria_producto_new RENAME TO categoria_producto;

-- ---- laboratorio_fabricante ---------------------------------
CREATE TABLE laboratorio_fabricante_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre         TEXT NOT NULL,
  pais           TEXT,
  institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id),
  UNIQUE (nombre, institucion_id)
);
INSERT INTO laboratorio_fabricante_new SELECT id, nombre, pais, institucion_id FROM laboratorio_fabricante;
DROP TABLE laboratorio_fabricante;
ALTER TABLE laboratorio_fabricante_new RENAME TO laboratorio_fabricante;

-- ---- area ---------------------------------------------------
CREATE TABLE area_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre         TEXT NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN (
    'farmacia_central','farmacia_periferica','quirofano',
    'servicio','consulta_externa','emergencia','almacen'
  )),
  bajo_llave     INTEGER NOT NULL DEFAULT 0,
  institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id),
  UNIQUE (nombre, institucion_id)
);
INSERT INTO area_new SELECT id, nombre, tipo, bajo_llave, institucion_id FROM area;
DROP TABLE area;
ALTER TABLE area_new RENAME TO area;
CREATE INDEX idx_resp_area ON responsable_directo(area_id);

-- ---- producto -----------------------------------------------
CREATE TABLE producto_new (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo                     TEXT NOT NULL,
  nombre                     TEXT NOT NULL,
  principio_activo           TEXT,
  categoria_id               INTEGER NOT NULL REFERENCES categoria_producto(id),
  unidad_medida_id           INTEGER NOT NULL REFERENCES unidad_medida(id),
  laboratorio_id             INTEGER REFERENCES laboratorio_fabricante(id),
  registro_sanitario         TEXT,
  es_controlado              INTEGER NOT NULL DEFAULT 0,
  requiere_receta_especial   INTEGER NOT NULL DEFAULT 0,
  condiciones_almacenamiento TEXT,
  precio_venta               REAL NOT NULL DEFAULT 0,
  costo_promedio_ponderado   REAL NOT NULL DEFAULT 0,
  punto_reorden              REAL NOT NULL DEFAULT 0,
  stock_minimo               REAL NOT NULL DEFAULT 0,
  stock_maximo               REAL NOT NULL DEFAULT 0,
  proveedor_preferente_id    INTEGER REFERENCES proveedor(id),
  activo                     INTEGER NOT NULL DEFAULT 1,
  creado_en                  TEXT NOT NULL DEFAULT (datetime('now')),
  unidad_compra_id           INTEGER REFERENCES unidad_medida(id),
  factor_conversion          REAL NOT NULL DEFAULT 1.0 CHECK (factor_conversion > 0),
  pvmp_srs                   REAL,
  institucion_id             INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id),
  UNIQUE (codigo, institucion_id)
);
INSERT INTO producto_new SELECT id, codigo, nombre, principio_activo, categoria_id, unidad_medida_id,
  laboratorio_id, registro_sanitario, es_controlado, requiere_receta_especial, condiciones_almacenamiento,
  precio_venta, costo_promedio_ponderado, punto_reorden, stock_minimo, stock_maximo,
  proveedor_preferente_id, activo, creado_en, unidad_compra_id, factor_conversion, pvmp_srs, institucion_id
FROM producto;
DROP TABLE producto;
ALTER TABLE producto_new RENAME TO producto;
CREATE INDEX idx_producto_categoria ON producto(categoria_id);
CREATE INDEX idx_producto_controlado ON producto(es_controlado);

-- ---- quirofano ----------------------------------------------
CREATE TABLE quirofano_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre         TEXT NOT NULL,
  ubicacion      TEXT,
  activo         INTEGER NOT NULL DEFAULT 1,
  institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id),
  UNIQUE (nombre, institucion_id)
);
INSERT INTO quirofano_new SELECT id, nombre, ubicacion, activo, institucion_id FROM quirofano;
DROP TABLE quirofano;
ALTER TABLE quirofano_new RENAME TO quirofano;

-- ---- habitacion ---------------------------------------------
CREATE TABLE habitacion_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  numero         TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'individual' CHECK (tipo IN ('individual','doble','suite','uci','observacion')),
  precio_diario  REAL NOT NULL DEFAULT 0,
  capacidad      INTEGER NOT NULL DEFAULT 1,
  area_id        INTEGER REFERENCES area(id),
  ubicacion      TEXT,
  activa         INTEGER NOT NULL DEFAULT 1,
  institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id),
  UNIQUE (numero, institucion_id)
);
INSERT INTO habitacion_new SELECT id, numero, tipo, precio_diario, capacidad, area_id, ubicacion, activa, institucion_id FROM habitacion;
DROP TABLE habitacion;
ALTER TABLE habitacion_new RENAME TO habitacion;
CREATE INDEX idx_ocup_habitacion_activa ON ocupacion_habitacion(habitacion_id, fecha_egreso);

-- ---- factura ------------------------------------------------
CREATE TABLE factura_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  numero         TEXT NOT NULL,
  paciente_id    INTEGER NOT NULL REFERENCES paciente(id),
  episodio_id    INTEGER REFERENCES episodio_atencion(id),
  fecha          TEXT NOT NULL DEFAULT (datetime('now')),
  subtotal       REAL NOT NULL DEFAULT 0,
  iva            REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  estado         TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada','anulada')),
  usuario_id     INTEGER REFERENCES usuario(id),
  observaciones  TEXT,
  institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id),
  UNIQUE (numero, institucion_id)
);
INSERT INTO factura_new SELECT id, numero, paciente_id, episodio_id, fecha, subtotal, iva, total,
  estado, usuario_id, observaciones, institucion_id FROM factura;
DROP TABLE factura;
ALTER TABLE factura_new RENAME TO factura;
CREATE INDEX idx_fd_factura ON factura_detalle(factura_id);

-- ---- orden_compra -------------------------------------------
CREATE TABLE orden_compra_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  numero         TEXT NOT NULL,
  proveedor_id   INTEGER NOT NULL REFERENCES proveedor(id),
  fecha          TEXT NOT NULL DEFAULT (date('now')),
  estado         TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN (
    'borrador','enviada','recibida_parcial','recibida','cancelada'
  )),
  subtotal       REAL NOT NULL DEFAULT 0,
  iva            REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  usuario_id     INTEGER REFERENCES usuario(id),
  observaciones  TEXT,
  institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id),
  UNIQUE (numero, institucion_id)
);
INSERT INTO orden_compra_new SELECT id, numero, proveedor_id, fecha, estado, subtotal, iva, total,
  usuario_id, observaciones, institucion_id FROM orden_compra;
DROP TABLE orden_compra;
ALTER TABLE orden_compra_new RENAME TO orden_compra;
CREATE INDEX idx_oc_det_orden ON orden_compra_detalle(orden_id);

-- ---- requisicion --------------------------------------------
CREATE TABLE requisicion_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  numero              TEXT NOT NULL,
  fecha_solicitud     TEXT NOT NULL DEFAULT (datetime('now')),
  paciente_id         INTEGER NOT NULL REFERENCES paciente(id),
  episodio_id         INTEGER REFERENCES episodio_atencion(id),
  area_solicitante_id INTEGER REFERENCES area(id),
  area_farmacia_id    INTEGER NOT NULL REFERENCES area(id),
  estado              TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
    'pendiente','despachada','rechazada','cancelada','despachada_parcial'
  )),
  prioridad           TEXT NOT NULL DEFAULT 'normal' CHECK (prioridad IN ('normal','urgente','stat')),
  solicitante_id      INTEGER NOT NULL REFERENCES usuario(id),
  despachador_id      INTEGER REFERENCES usuario(id),
  fecha_despacho      TEXT,
  motivo_rechazo      TEXT,
  observaciones       TEXT,
  institucion_id      INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id),
  UNIQUE (numero, institucion_id)
);
INSERT INTO requisicion_new SELECT id, numero, fecha_solicitud, paciente_id, episodio_id,
  area_solicitante_id, area_farmacia_id, estado, prioridad, solicitante_id, despachador_id,
  fecha_despacho, motivo_rechazo, observaciones, institucion_id FROM requisicion;
DROP TABLE requisicion;
ALTER TABLE requisicion_new RENAME TO requisicion;
CREATE INDEX idx_req_estado   ON requisicion(estado);
CREATE INDEX idx_req_fecha    ON requisicion(fecha_solicitud);
CREATE INDEX idx_req_paciente ON requisicion(paciente_id);
CREATE INDEX idx_req_det      ON requisicion_detalle(requisicion_id);

-- ---- paciente -----------------------------------------------
CREATE TABLE paciente_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  expediente          TEXT,
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
  creado_en           TEXT NOT NULL DEFAULT (datetime('now')),
  institucion_id      INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id),
  UNIQUE (expediente, institucion_id)
);
INSERT INTO paciente_new SELECT id, expediente, nombres, apellidos, documento_tipo, documento_numero,
  fecha_nacimiento, sexo, telefono, direccion, contacto_emergencia, alergias, observaciones,
  creado_por, creado_en, institucion_id FROM paciente;
DROP TABLE paciente;
ALTER TABLE paciente_new RENAME TO paciente;
CREATE INDEX idx_paciente_docu   ON paciente(documento_numero);
CREATE INDEX idx_paciente_nombre ON paciente(apellidos, nombres);

-- ---- cirugia ------------------------------------------------
CREATE TABLE cirugia_new (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo                      TEXT NOT NULL,
  fecha_programada            TEXT NOT NULL,
  hora_inicio                 TEXT,
  hora_fin                    TEXT,
  quirofano_id                INTEGER NOT NULL REFERENCES quirofano(id),
  paciente_id                 INTEGER REFERENCES paciente(id),
  paciente_pendiente_nombre   TEXT,
  tipo_cirugia                TEXT,
  medico_principal_id         INTEGER REFERENCES profesional_medico(id),
  anestesiologo_id            INTEGER REFERENCES profesional_medico(id),
  enfermera_circulante_id     INTEGER REFERENCES profesional_enfermeria(id),
  enfermera_instrumentista_id INTEGER REFERENCES profesional_enfermeria(id),
  estado                      TEXT NOT NULL DEFAULT 'programada' CHECK (estado IN (
    'programada','en_curso','realizada','suspendida','cancelada'
  )),
  observaciones               TEXT,
  inicio_at                   TEXT,
  fin_at                      TEXT,
  cirujano_ayudante_id        INTEGER REFERENCES profesional_medico(id),
  institucion_id              INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id),
  UNIQUE (codigo, institucion_id)
);
INSERT INTO cirugia_new SELECT id, codigo, fecha_programada, hora_inicio, hora_fin, quirofano_id,
  paciente_id, paciente_pendiente_nombre, tipo_cirugia, medico_principal_id, anestesiologo_id,
  enfermera_circulante_id, enfermera_instrumentista_id, estado, observaciones,
  inicio_at, fin_at, cirujano_ayudante_id, institucion_id FROM cirugia;
DROP TABLE cirugia;
ALTER TABLE cirugia_new RENAME TO cirugia;
CREATE INDEX idx_cirugia_fecha ON cirugia(fecha_programada);
CREATE INDEX idx_cirugia_quir  ON cirugia(quirofano_id, fecha_programada);

PRAGMA foreign_keys = ON;
