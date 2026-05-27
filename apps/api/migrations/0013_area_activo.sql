-- Permite desactivar áreas sin eliminarlas
ALTER TABLE area ADD COLUMN activo INTEGER NOT NULL DEFAULT 1;
