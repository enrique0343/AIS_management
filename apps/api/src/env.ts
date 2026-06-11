export type Bindings = {
  DB: D1Database;
  SESSIONS: KVNamespace;
  DOCS: R2Bucket;
  ASSETS: Fetcher;
  APP_ENV: string;
  SESSION_TTL_SECONDS: string;
  RESEND_API_KEY?: string;
};

export type SessionData = {
  usuario_id: number;
  email: string;
  nombre: string;
  roles: string[];
  created_at: number;
  institucion_id: number;
  institucion_slug: string;
};

export type AppVariables = {
  session: SessionData | null;
  ip: string;
};
