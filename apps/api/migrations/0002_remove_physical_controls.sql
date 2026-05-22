-- Elimina elementos que corresponden a controles fisicos / libro fisico
-- (receta especial retenida, sello DISPENSADA, triplicados). El control de
-- medicamentos controlados se realiza en el libro fisico autorizado por la SRS;
-- el sistema solo conserva trazabilidad de movimientos de inventario.

PRAGMA foreign_keys = OFF;

-- 1) Quitar referencia desde consumo_paciente a la receta
CREATE TABLE consumo_paciente__new (
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
  factura_detalle_id          INTEGER,
  observaciones               TEXT
);

INSERT INTO consumo_paciente__new
  (id, episodio_id, producto_id, lote_id, area_id, cantidad,
   costo_unitario_snapshot, precio_venta_snapshot, fecha, usuario_id,
   factura_detalle_id, observaciones)
SELECT id, episodio_id, producto_id, lote_id, area_id, cantidad,
       costo_unitario_snapshot, precio_venta_snapshot, fecha, usuario_id,
       factura_detalle_id, observaciones
  FROM consumo_paciente;

DROP TABLE consumo_paciente;
ALTER TABLE consumo_paciente__new RENAME TO consumo_paciente;
CREATE INDEX idx_consumo_ep ON consumo_paciente(episodio_id);
CREATE INDEX idx_consumo_fact ON consumo_paciente(factura_detalle_id);

-- 2) Eliminar la tabla de receta especial retenida
DROP TABLE IF EXISTS receta_especial_retenida;

PRAGMA foreign_keys = ON;
