-- ============================================================
-- 0011: Multi-tenancy — tabla institucion + columna institucion_id
-- Cada institución (hospital/clínica) es un tenant independiente.
-- Los datos existentes se asignan a institucion_id = 1 (DEFAULT).
-- ============================================================

PRAGMA foreign_keys = OFF;

CREATE TABLE institucion (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT NOT NULL UNIQUE,   -- identificador URL-safe: "hospital-bloom"
  nombre    TEXT NOT NULL,
  nit       TEXT,
  activa    INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- El hospital actual queda como institución 1
INSERT INTO institucion (id, slug, nombre) VALUES (1, 'principal', 'Hospital Principal');

-- ---- Usuarios y auditoría -----------------------------------
ALTER TABLE usuario            ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE usuario_rol        ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE audit_log          ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1;

-- ---- Catálogos base (ahora por tenant) ----------------------
ALTER TABLE categoria_producto    ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE laboratorio_fabricante ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE proveedor             ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);

-- ---- Áreas y responsables -----------------------------------
ALTER TABLE area                  ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE responsable_directo   ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);

-- ---- Inventario ---------------------------------------------
ALTER TABLE producto              ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE lote                  ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE existencia            ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE movimiento_inventario ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);

-- ---- Compras ------------------------------------------------
ALTER TABLE orden_compra          ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE orden_compra_detalle  ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE recepcion_compra      ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE recepcion_compra_detalle ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);

-- ---- Pacientes y atención -----------------------------------
ALTER TABLE paciente              ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE profesional_medico    ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE profesional_enfermeria ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE personal_administrativo ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE episodio_atencion     ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE consumo_paciente      ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);

-- ---- Facturación --------------------------------------------
ALTER TABLE factura               ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE factura_detalle       ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE pago                  ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);

-- ---- Quirófano y cirugía ------------------------------------
ALTER TABLE quirofano             ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE cirugia               ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE cirugia_consumo       ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);

-- ---- Habitaciones -------------------------------------------
ALTER TABLE habitacion            ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE ocupacion_habitacion  ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);

-- ---- Requisiciones y devoluciones ---------------------------
ALTER TABLE requisicion           ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE requisicion_detalle   ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);
ALTER TABLE devolucion_pendiente  ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);

-- ---- Gastos -------------------------------------------------
ALTER TABLE gasto_operativo       ADD COLUMN institucion_id INTEGER NOT NULL DEFAULT 1 REFERENCES institucion(id);

-- ---- Índices de rendimiento (institucion_id primero) --------
CREATE INDEX idx_usuario_inst        ON usuario(institucion_id);
CREATE INDEX idx_cat_prod_inst       ON categoria_producto(institucion_id);
CREATE INDEX idx_lab_fab_inst        ON laboratorio_fabricante(institucion_id);
CREATE INDEX idx_proveedor_inst      ON proveedor(institucion_id);
CREATE INDEX idx_area_inst           ON area(institucion_id);
CREATE INDEX idx_producto_inst       ON producto(institucion_id);
CREATE INDEX idx_lote_inst           ON lote(institucion_id);
CREATE INDEX idx_existencia_inst_pa  ON existencia(institucion_id, producto_id, area_id);
CREATE INDEX idx_mov_inst_fecha      ON movimiento_inventario(institucion_id, fecha);
CREATE INDEX idx_oc_inst             ON orden_compra(institucion_id);
CREATE INDEX idx_recepcion_inst      ON recepcion_compra(institucion_id);
CREATE INDEX idx_paciente_inst       ON paciente(institucion_id);
CREATE INDEX idx_episodio_inst       ON episodio_atencion(institucion_id);
CREATE INDEX idx_consumo_inst        ON consumo_paciente(institucion_id);
CREATE INDEX idx_factura_inst        ON factura(institucion_id);
CREATE INDEX idx_quirofano_inst      ON quirofano(institucion_id);
CREATE INDEX idx_cirugia_inst        ON cirugia(institucion_id);
CREATE INDEX idx_habitacion_inst     ON habitacion(institucion_id);
CREATE INDEX idx_requisicion_inst    ON requisicion(institucion_id);
CREATE INDEX idx_gasto_inst          ON gasto_operativo(institucion_id);

-- Agregar super_admin al catálogo de roles (plataforma)
INSERT OR IGNORE INTO rol (codigo, nombre) VALUES ('super_admin', 'Super Administrador (Plataforma)');

PRAGMA foreign_keys = ON;
