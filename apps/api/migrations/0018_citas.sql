-- Agenda de disponibilidad de médicos
CREATE TABLE agenda_medico (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profesional_id  INTEGER NOT NULL REFERENCES profesional(id),
  dia_semana      INTEGER NOT NULL,
  hora_inicio     TEXT NOT NULL,
  hora_fin        TEXT NOT NULL,
  duracion_cita   INTEGER NOT NULL DEFAULT 30,
  activo          INTEGER NOT NULL DEFAULT 1,
  institucion_id  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_agenda_prof ON agenda_medico(profesional_id, dia_semana);

-- Citas médicas
CREATE TABLE cita (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profesional_id  INTEGER NOT NULL REFERENCES profesional(id),
  paciente_id     INTEGER NOT NULL REFERENCES paciente(id),
  fecha_hora      TEXT NOT NULL,
  duracion        INTEGER NOT NULL DEFAULT 30,
  tipo            TEXT NOT NULL DEFAULT 'consulta',
  estado          TEXT NOT NULL DEFAULT 'agendada',
  motivo          TEXT,
  notas           TEXT,
  creado_por      INTEGER REFERENCES usuario(id),
  creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  institucion_id  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_cita_fecha ON cita(profesional_id, fecha_hora);
CREATE INDEX idx_cita_pac   ON cita(paciente_id, fecha_hora);
