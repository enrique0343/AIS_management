-- Requisiciones internas: enfermeria solicita medicamentos/insumos a la
-- farmacia interna sin elegir lote (no tiene visibilidad). Farmacia recibe
-- la solicitud, valida y despacha; al despachar el sistema descarga el
-- stock por FEFO y genera el consumo del paciente correspondiente.

CREATE TABLE requisicion (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  numero                TEXT NOT NULL UNIQUE,
  fecha_solicitud       TEXT NOT NULL DEFAULT (datetime('now')),
  paciente_id           INTEGER NOT NULL REFERENCES paciente(id),
  episodio_id           INTEGER REFERENCES episodio_atencion(id),
  area_solicitante_id   INTEGER REFERENCES area(id),
  area_farmacia_id      INTEGER NOT NULL REFERENCES area(id),
  estado                TEXT NOT NULL DEFAULT 'pendiente'
                          CHECK (estado IN ('pendiente','despachada','rechazada','cancelada','despachada_parcial')),
  prioridad             TEXT NOT NULL DEFAULT 'normal'
                          CHECK (prioridad IN ('normal','urgente','stat')),
  solicitante_id        INTEGER NOT NULL REFERENCES usuario(id),
  despachador_id        INTEGER REFERENCES usuario(id),
  fecha_despacho        TEXT,
  motivo_rechazo        TEXT,
  observaciones         TEXT
);
CREATE INDEX idx_req_estado ON requisicion(estado);
CREATE INDEX idx_req_fecha ON requisicion(fecha_solicitud);
CREATE INDEX idx_req_paciente ON requisicion(paciente_id);

CREATE TABLE requisicion_detalle (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  requisicion_id          INTEGER NOT NULL REFERENCES requisicion(id) ON DELETE CASCADE,
  producto_id             INTEGER NOT NULL REFERENCES producto(id),
  cantidad_solicitada     REAL NOT NULL,
  cantidad_despachada     REAL NOT NULL DEFAULT 0,
  observaciones           TEXT
);
CREATE INDEX idx_req_det ON requisicion_detalle(requisicion_id);
