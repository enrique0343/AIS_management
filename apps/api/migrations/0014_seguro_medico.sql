-- Compañías aseguradoras
CREATE TABLE aseguradora (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre         TEXT NOT NULL,
  nit            TEXT,
  contacto       TEXT,
  telefono       TEXT,
  email          TEXT,
  activo         INTEGER NOT NULL DEFAULT 1,
  institucion_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_aseguradora_inst ON aseguradora(institucion_id);

-- Pólizas de pacientes
CREATE TABLE poliza_paciente (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id    INTEGER NOT NULL REFERENCES paciente(id),
  aseguradora_id INTEGER NOT NULL REFERENCES aseguradora(id),
  numero_poliza  TEXT NOT NULL,
  titular        TEXT,
  cobertura_pct  REAL NOT NULL DEFAULT 100,
  fecha_vence    TEXT,
  activo         INTEGER NOT NULL DEFAULT 1,
  institucion_id INTEGER NOT NULL DEFAULT 1,
  creado_en      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_poliza_pac ON poliza_paciente(paciente_id, institucion_id);

-- Soporte de seguro en factura
-- tipo: 'normal' | 'paciente' (copago) | 'aseguradora' (cargo al seguro)
ALTER TABLE factura ADD COLUMN tipo TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE factura ADD COLUMN aseguradora_id INTEGER;
ALTER TABLE factura ADD COLUMN poliza_id INTEGER;
-- estado_seguro: null | 'enviada' | 'cobrada'
ALTER TABLE factura ADD COLUMN estado_seguro TEXT;
ALTER TABLE factura ADD COLUMN fecha_envio_seguro TEXT;
ALTER TABLE factura ADD COLUMN referencia_cobro_seguro TEXT;
