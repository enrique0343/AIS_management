-- Unidad de compra y factor de conversion por producto
-- unidad_medida_id sigue siendo la unidad de VENTA/dispensacion (base)
-- unidad_compra_id es como llega del proveedor (puede ser NULL = misma que venta)
-- factor_conversion: cuantas unidades de venta hay en 1 unidad de compra (default 1)
ALTER TABLE producto ADD COLUMN unidad_compra_id INTEGER REFERENCES unidad_medida(id);
ALTER TABLE producto ADD COLUMN factor_conversion REAL NOT NULL DEFAULT 1.0
  CHECK (factor_conversion > 0);
-- PVMP oficial del catalogo SRS (precio maximo de venta al publico, por presentacion de compra)
ALTER TABLE producto ADD COLUMN pvmp_srs REAL;

-- Catalogo de referencia del Registro Sanitario (SRS) - solo lectura, no afecta inventario
CREATE TABLE IF NOT EXISTS catalogo_srs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  registro_sanitario TEXT    NOT NULL,
  nombre_comercial   TEXT    NOT NULL,
  principio_activo   TEXT,
  concentracion      TEXT,
  forma_farmaceutica TEXT,
  fabricante         TEXT,
  pvmp               REAL,
  estado             TEXT NOT NULL DEFAULT 'A'
);
CREATE INDEX IF NOT EXISTS idx_csrs_nombre ON catalogo_srs(nombre_comercial);
CREATE INDEX IF NOT EXISTS idx_csrs_principio ON catalogo_srs(principio_activo);
CREATE INDEX IF NOT EXISTS idx_csrs_rs     ON catalogo_srs(registro_sanitario);
