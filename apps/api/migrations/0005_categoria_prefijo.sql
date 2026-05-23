-- Cada categoria tiene un prefijo de codigo (MED, INS, LAB, RAD, SVC, QUI...)
-- usado para validar que el codigo del producto pertenece a su categoria.

ALTER TABLE categoria_producto ADD COLUMN prefijo TEXT NOT NULL DEFAULT '';

UPDATE categoria_producto SET prefijo = 'MED' WHERE nombre = 'Medicamento';
UPDATE categoria_producto SET prefijo = 'INS' WHERE nombre = 'Insumo Medico';
UPDATE categoria_producto SET prefijo = 'LAB' WHERE nombre = 'Laboratorio';
UPDATE categoria_producto SET prefijo = 'RAD' WHERE nombre = 'Radiologia';
UPDATE categoria_producto SET prefijo = 'SVC' WHERE nombre = 'Servicio Hospitalario';
UPDATE categoria_producto SET prefijo = 'QUI' WHERE nombre = 'Servicio Quirurgico';
