-- Signos vitales
CREATE TABLE signo_vital (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  episodio_id     INTEGER NOT NULL REFERENCES episodio_atencion(id),
  registrado_por  INTEGER REFERENCES usuario(id),
  fecha           TEXT NOT NULL DEFAULT (datetime('now')),
  fc              INTEGER,
  ta_sistolica    INTEGER,
  ta_diastolica   INTEGER,
  spo2            REAL,
  temperatura     REAL,
  fr              INTEGER,
  glucosa         INTEGER,
  peso            REAL,
  talla           REAL,
  notas           TEXT,
  institucion_id  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_signo_vital_ep ON signo_vital(episodio_id, fecha DESC);

-- Notas clínicas (inmutables tras firma)
CREATE TABLE nota_clinica (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  episodio_id     INTEGER NOT NULL REFERENCES episodio_atencion(id),
  tipo            TEXT NOT NULL DEFAULT 'evolucion',
  cuerpo          TEXT NOT NULL,
  firmada         INTEGER NOT NULL DEFAULT 0,
  firmado_por_id  INTEGER REFERENCES profesional(id),
  fecha_firma     TEXT,
  creado_por      INTEGER REFERENCES usuario(id),
  creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  institucion_id  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_nota_clinica_ep ON nota_clinica(episodio_id, creado_en DESC);

-- Catálogo CIE-10 (global, sin institucion_id)
CREATE TABLE cie10 (
  codigo    TEXT PRIMARY KEY,
  nombre    TEXT NOT NULL,
  categoria TEXT
);

-- Diagnósticos por episodio
CREATE TABLE diagnostico_episodio (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  episodio_id     INTEGER NOT NULL REFERENCES episodio_atencion(id),
  cie10_codigo    TEXT REFERENCES cie10(codigo),
  descripcion     TEXT NOT NULL,
  tipo            TEXT NOT NULL DEFAULT 'principal',
  creado_por      INTEGER REFERENCES usuario(id),
  creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  institucion_id  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_diag_ep ON diagnostico_episodio(episodio_id);

-- Prescripciones médicas
CREATE TABLE prescripcion (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  episodio_id     INTEGER NOT NULL REFERENCES episodio_atencion(id),
  producto_id     INTEGER NOT NULL REFERENCES producto(id),
  prescrito_por   INTEGER REFERENCES profesional(id),
  dosis           TEXT NOT NULL,
  frecuencia_horas INTEGER NOT NULL DEFAULT 8,
  dias            INTEGER NOT NULL DEFAULT 1,
  via             TEXT NOT NULL DEFAULT 'oral',
  estado          TEXT NOT NULL DEFAULT 'activa',
  notas           TEXT,
  creado_por      INTEGER REFERENCES usuario(id),
  creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  institucion_id  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_prescripcion_ep ON prescripcion(episodio_id, estado);

-- MAR (Medication Administration Record)
CREATE TABLE administracion_medicamento (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  prescripcion_id    INTEGER NOT NULL REFERENCES prescripcion(id),
  administrado_por   INTEGER REFERENCES usuario(id),
  fecha              TEXT NOT NULL DEFAULT (datetime('now')),
  dosis_administrada TEXT NOT NULL,
  via                TEXT,
  observaciones      TEXT,
  institucion_id     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_admin_med ON administracion_medicamento(prescripcion_id, fecha DESC);

-- Semilla CIE-10 con códigos hospitalarios frecuentes
INSERT INTO cie10 (codigo, nombre, categoria) VALUES
('A09',   'Otras gastroenteritis y colitis de origen infeccioso y no especificado', 'Infeccioso'),
('A90',   'Dengue clásico', 'Infeccioso'),
('A91',   'Fiebre hemorrágica debida a virus del dengue', 'Infeccioso'),
('B34.9', 'Infección viral, no especificada', 'Infeccioso'),
('E11.9', 'Diabetes mellitus tipo 2 sin complicaciones', 'Endocrino'),
('E14',   'Diabetes mellitus no especificada', 'Endocrino'),
('G43.9', 'Migraña, no especificada', 'Neurológico'),
('G45',   'Ataques de isquemia cerebral transitoria', 'Neurológico'),
('I10',   'Hipertensión esencial (primaria)', 'Cardiovascular'),
('I20.9', 'Angina de pecho, no especificada', 'Cardiovascular'),
('I21.9', 'Infarto agudo del miocardio, no especificado', 'Cardiovascular'),
('I50.9', 'Insuficiencia cardíaca, no especificada', 'Cardiovascular'),
('I64',   'Accidente vascular encefálico, no especificado como hemorrágico o isquémico', 'Cardiovascular'),
('J06.9', 'Infección aguda de las vías respiratorias superiores, no especificada', 'Respiratorio'),
('J18.9', 'Neumonía, no especificada', 'Respiratorio'),
('J44.1', 'Enfermedad pulmonar obstructiva crónica con exacerbación aguda', 'Respiratorio'),
('J45.9', 'Asma, no especificada', 'Respiratorio'),
('K29.7', 'Gastritis, no especificada', 'Digestivo'),
('K35.9', 'Apendicitis aguda, no especificada', 'Digestivo'),
('K40.9', 'Hernia inguinal unilateral, sin obstrucción ni gangrena, no especificada', 'Digestivo'),
('K57.3', 'Enfermedad diverticular del intestino grueso sin perforación ni absceso, sin hemorragia', 'Digestivo'),
('K80.2', 'Cálculos biliares sin colecistitis', 'Digestivo'),
('K92.1', 'Melena', 'Digestivo'),
('L03.9', 'Celulitis, no especificada', 'Dermatológico'),
('M54.5', 'Dolor lumbar bajo', 'Musculoesquelético'),
('M79.3', 'Panniculitis, no especificada', 'Musculoesquelético'),
('N17.9', 'Insuficiencia renal aguda, no especificada', 'Nefrológico'),
('N18.9', 'Insuficiencia renal crónica no especificada', 'Nefrológico'),
('N39.0', 'Infección de las vías urinarias, sitio no especificado', 'Nefrológico'),
('O80',   'Parto único espontáneo', 'Obstétrico'),
('O82',   'Parto por cesárea electiva', 'Obstétrico'),
('R10.4', 'Otros dolores abdominales y los no especificados', 'Síntomas'),
('R50.9', 'Fiebre, no especificada', 'Síntomas'),
('R55',   'Síncope y colapso', 'Síntomas'),
('S06.9', 'Traumatismo intracraneal, no especificado', 'Traumatismo'),
('S72.0', 'Fractura del cuello del fémur', 'Traumatismo'),
('T78.4', 'Alergia, no especificada', 'Alérgico'),
('Z38.0', 'Recién nacido único, nacido en hospital', 'Perinatal');
