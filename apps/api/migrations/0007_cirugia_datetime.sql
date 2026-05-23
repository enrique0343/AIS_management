-- Cirugia: agregar inicio_at y fin_at (datetime ISO) para soportar
-- cirugias que cruzan medianoche (ej. 23:00 - 02:00 del dia siguiente).
-- Agregar tambien cirujano_ayudante_id como medico opcional.

ALTER TABLE cirugia ADD COLUMN inicio_at TEXT;
ALTER TABLE cirugia ADD COLUMN fin_at TEXT;
ALTER TABLE cirugia ADD COLUMN cirujano_ayudante_id INTEGER REFERENCES profesional_medico(id);

-- Backfill desde columnas existentes para no perder datos previos
UPDATE cirugia
   SET inicio_at = fecha_programada || 'T' || COALESCE(hora_inicio, '00:00'),
       fin_at   = fecha_programada || 'T' || COALESCE(hora_fin, '23:59')
 WHERE inicio_at IS NULL;
