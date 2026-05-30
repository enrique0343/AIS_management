-- Honorarios médicos (fondo de paso, no son ingreso institucional)
CREATE TABLE honorario_medico (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  episodio_id    INTEGER REFERENCES episodio_atencion(id),
  cirugia_id     INTEGER REFERENCES cirugia(id),
  profesional_id INTEGER NOT NULL,
  concepto       TEXT NOT NULL,
  -- 'consulta' | 'cirugia' | 'anestesia' | 'procedimiento' | 'otro'
  monto          REAL NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'cobrado' | 'entregado'
  fecha_cobro    TEXT,
  entrega_id     INTEGER,
  notas          TEXT,
  creado_por     INTEGER NOT NULL,
  institucion_id INTEGER NOT NULL DEFAULT 1,
  creado_en      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_honorario_prof  ON honorario_medico(profesional_id, institucion_id);
CREATE INDEX idx_honorario_ep    ON honorario_medico(episodio_id);
CREATE INDEX idx_honorario_estado ON honorario_medico(estado, institucion_id);

-- Registro de cada liquidación al médico
CREATE TABLE entrega_honorario (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  profesional_id INTEGER NOT NULL,
  fecha          TEXT NOT NULL DEFAULT (date('now')),
  monto_total    REAL NOT NULL,
  comprobante    TEXT,
  notas          TEXT,
  creado_por     INTEGER NOT NULL,
  institucion_id INTEGER NOT NULL DEFAULT 1,
  creado_en      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_entrega_prof ON entrega_honorario(profesional_id, institucion_id);
