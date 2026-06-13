CREATE TABLE notificacion (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo           TEXT NOT NULL,
  titulo         TEXT NOT NULL,
  cuerpo         TEXT,
  leida          INTEGER NOT NULL DEFAULT 0,
  usuario_id     INTEGER REFERENCES usuario(id),
  entidad        TEXT,
  entidad_id     INTEGER,
  creado_en      TEXT NOT NULL DEFAULT (datetime('now')),
  institucion_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_notif_inst ON notificacion(institucion_id, leida, creado_en DESC);
