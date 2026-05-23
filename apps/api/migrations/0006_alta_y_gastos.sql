-- Workflow de alta: enfermeria solicita alta -> admon revisa -> cierra y factura.
-- Se modela con dos columnas adicionales en episodio_atencion (sin cambiar el enum 'activo'/'cerrado').
ALTER TABLE episodio_atencion ADD COLUMN alta_solicitada_en TEXT;
ALTER TABLE episodio_atencion ADD COLUMN alta_solicitada_por INTEGER REFERENCES usuario(id);

-- Gastos operativos: energia, agua, limpieza, salarios, mantenimiento, etc.
-- No son inventario; solo registro contable para reporte mensual.
CREATE TABLE categoria_gasto (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT NOT NULL UNIQUE,
  descripcion TEXT
);

INSERT INTO categoria_gasto (nombre) VALUES
  ('Energia electrica'),
  ('Agua'),
  ('Limpieza'),
  ('Salarios'),
  ('Mantenimiento'),
  ('Internet / Telefonia'),
  ('Suministros oficina'),
  ('Honorarios profesionales'),
  ('Impuestos / Tasas'),
  ('Otros');

CREATE TABLE gasto_operativo (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha         TEXT NOT NULL DEFAULT (date('now')),
  categoria_id  INTEGER NOT NULL REFERENCES categoria_gasto(id),
  proveedor     TEXT,
  descripcion   TEXT NOT NULL,
  monto         REAL NOT NULL,
  doc_r2_key    TEXT,
  usuario_id    INTEGER REFERENCES usuario(id),
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_gasto_fecha ON gasto_operativo(fecha);
CREATE INDEX idx_gasto_categoria ON gasto_operativo(categoria_id);
