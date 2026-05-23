-- Seed de datos base. Idempotente vía INSERT OR IGNORE.
-- Usuario admin: email admin@ais.local, password "admin123" (Argon2id).
-- El hash se calcula vía endpoint de bootstrap; aquí dejamos placeholder
-- que el script de bootstrap reemplazará. Si se aplica seed directo,
-- usar el endpoint POST /api/auth/bootstrap.

INSERT OR IGNORE INTO rol (codigo, nombre) VALUES
  ('admin', 'Administrador'),
  ('jefe_farmacia_central', 'Jefe Farmacia Central'),
  ('farmaceutico', 'Farmaceutico / Responsable de Stock'),
  ('responsable_stock', 'Responsable de Stock'),
  ('medico', 'Medico'),
  ('enfermeria', 'Enfermeria'),
  ('facturacion', 'Caja / Facturacion'),
  ('programador_quirofano', 'Programador de Quirofano');

INSERT OR IGNORE INTO unidad_medida (nombre, abreviatura) VALUES
  ('Unidad', 'U'),
  ('Tableta', 'TAB'),
  ('Capsula', 'CAP'),
  ('Ampolla', 'AMP'),
  ('Vial', 'VIAL'),
  ('Frasco', 'FCO'),
  ('Mililitro', 'ML'),
  ('Miligramo', 'MG'),
  ('Caja', 'CJA'),
  ('Sobre', 'SOB'),
  ('Servicio', 'SVC');

INSERT OR IGNORE INTO categoria_producto (nombre, requiere_lote_vencimiento, es_servicio, prefijo) VALUES
  ('Medicamento', 1, 0, 'MED'),
  ('Insumo Medico', 1, 0, 'INS'),
  ('Laboratorio', 0, 1, 'LAB'),
  ('Radiologia', 0, 1, 'RAD'),
  ('Servicio Hospitalario', 0, 1, 'SVC'),
  ('Servicio Quirurgico', 0, 1, 'QUI');

INSERT OR IGNORE INTO area (nombre, tipo, bajo_llave) VALUES
  ('Almacen Central', 'almacen', 1),
  ('Farmacia Central', 'farmacia_central', 1),
  ('Farmacia Emergencia', 'farmacia_periferica', 1),
  ('Quirofano 1', 'quirofano', 1),
  ('Consulta Externa', 'consulta_externa', 0),
  ('Emergencia', 'emergencia', 0),
  ('Hospitalizacion', 'servicio', 0);

INSERT OR IGNORE INTO quirofano (nombre, ubicacion) VALUES
  ('Quirofano 1', 'Planta baja - Ala norte');
