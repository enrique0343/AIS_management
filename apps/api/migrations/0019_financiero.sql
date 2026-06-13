-- Cuentas por pagar a proveedores
CREATE TABLE cuenta_pagar (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id      INTEGER NOT NULL REFERENCES proveedor(id),
  orden_compra_id   INTEGER,
  concepto          TEXT NOT NULL,
  monto             REAL NOT NULL,
  fecha_emision     TEXT NOT NULL DEFAULT (date('now')),
  fecha_vencimiento TEXT,
  estado            TEXT NOT NULL DEFAULT 'pendiente',
  referencia_pago   TEXT,
  fecha_pago        TEXT,
  notas             TEXT,
  creado_por        INTEGER REFERENCES usuario(id),
  creado_en         TEXT NOT NULL DEFAULT (datetime('now')),
  institucion_id    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_cp_venc ON cuenta_pagar(fecha_vencimiento, estado);
CREATE INDEX idx_cp_prov ON cuenta_pagar(proveedor_id, estado);

-- Depósitos / anticipos de pacientes
CREATE TABLE deposito_paciente (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id     INTEGER NOT NULL REFERENCES paciente(id),
  episodio_id     INTEGER REFERENCES episodio_atencion(id),
  monto           REAL NOT NULL,
  fecha           TEXT NOT NULL DEFAULT (date('now')),
  concepto        TEXT,
  aplicado        INTEGER NOT NULL DEFAULT 0,
  factura_id      INTEGER REFERENCES factura(id),
  creado_por      INTEGER REFERENCES usuario(id),
  institucion_id  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_dep_pac ON deposito_paciente(paciente_id, aplicado);

-- Notas de crédito
CREATE TABLE nota_credito (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id      INTEGER NOT NULL REFERENCES factura(id),
  numero          TEXT NOT NULL,
  monto           REAL NOT NULL,
  motivo          TEXT NOT NULL,
  creado_por      INTEGER REFERENCES usuario(id),
  creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  institucion_id  INTEGER NOT NULL DEFAULT 1
);

-- Arqueo / cierre de caja por turno
CREATE TABLE cierre_caja (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id        INTEGER NOT NULL REFERENCES usuario(id),
  fecha_inicio      TEXT NOT NULL,
  fecha_fin         TEXT NOT NULL DEFAULT (datetime('now')),
  efectivo_apertura REAL NOT NULL DEFAULT 0,
  efectivo_cierre   REAL NOT NULL DEFAULT 0,
  total_cobrado     REAL NOT NULL DEFAULT 0,
  observaciones     TEXT,
  institucion_id    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_cierre_caja_fecha ON cierre_caja(institucion_id, fecha_fin DESC);
