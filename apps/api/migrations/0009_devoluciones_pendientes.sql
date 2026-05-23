-- Tabla para gestionar el flujo de devoluciones en dos pasos:
-- 1. Enfermeria solicita devolucion (estado=pendiente, sin afectar inventario)
-- 2. Farmacia procesa/rechaza (estado=procesada|rechazada, inventario se ajusta al procesar)
CREATE TABLE devolucion_pendiente (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  consumo_id       INTEGER NOT NULL REFERENCES consumo_paciente(id),
  producto_id      INTEGER NOT NULL,
  lote_id          INTEGER,                        -- lote original del consumo
  cantidad         REAL NOT NULL,
  area_destino_id  INTEGER NOT NULL,               -- area sugerida por enfermeria
  observaciones    TEXT,
  estado           TEXT NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente','procesada','rechazada')),
  solicitante_id   INTEGER NOT NULL REFERENCES usuario(id),
  procesado_por_id INTEGER REFERENCES usuario(id),
  procesado_en     DATETIME,
  lote_final_id    INTEGER,                        -- farmacia puede corregir el lote
  area_final_id    INTEGER,                        -- farmacia puede cambiar el area
  motivo_rechazo   TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);
