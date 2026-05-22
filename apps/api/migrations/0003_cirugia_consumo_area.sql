-- cirugia_consumo necesita area_id para descontar/registrar correctamente
-- (cirugia.quirofano_id apunta a quirofano, no a area).

ALTER TABLE cirugia_consumo ADD COLUMN area_id INTEGER REFERENCES area(id);
