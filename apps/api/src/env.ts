export type Bindings = {
  DB: D1Database;
  SESSIONS: KVNamespace;
  DOCS: R2Bucket;
  APP_ENV: string;
  SESSION_TTL_SECONDS: string;
};

export type SessionData = {
  usuario_id: number;
  email: string;
  nombre: string;
  roles: string[];
  created_at: number;
};

export type AppVariables = {
  session: SessionData | null;
  ip: string;
};
