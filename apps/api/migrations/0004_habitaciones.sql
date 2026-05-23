-- Habitaciones (camas/cuartos) y ocupacion (historial por episodio)
-- para registrar servicio de habitacion como cargo facturable al egreso.

CREATE TABLE habitacion (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  numero          TEXT NOT NULL UNIQUE,
  tipo            TEXT NOT NULL DEFAULT 'individual' CHECK (tipo IN ('individual','doble','suite','uci','observacion')),
  precio_diario   REAL NOT NULL DEFAULT 0,
  capacidad       INTEGER NOT NULL DEFAULT 1,
  area_id         INTEGER REFERENCES area(id),
  ubicacion       TEXT,
  activa          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE ocupacion_habitacion (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id              INTEGER NOT NULL REFERENCES paciente(id),
  episodio_id              INTEGER REFERENCES episodio_atencion(id),
  habitacion_id            INTEGER NOT NULL REFERENCES habitacion(id),
  fecha_ingreso            TEXT NOT NULL DEFAULT (datetime('now')),
  fecha_egreso             TEXT,
  precio_diario_snapshot   REAL NOT NULL DEFAULT 0,
  factura_detalle_id       INTEGER,
  usuario_id               INTEGER REFERENCES usuario(id),
  observaciones            TEXT
);
CREATE INDEX idx_ocup_paciente ON ocupacion_habitacion(paciente_id);
CREATE INDEX idx_ocup_episodio ON ocupacion_habitacion(episodio_id);
CREATE INDEX idx_ocup_habitacion_activa ON ocupacion_habitacion(habitacion_id, fecha_egreso);
CREATE INDEX idx_ocup_factura ON ocupacion_habitacion(factura_detalle_id);
