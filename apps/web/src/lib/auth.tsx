import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "./api";

export type Usuario = {
  id: number;
  email: string;
  nombre: string;
  roles: string[];
};

type AuthCtx = {
  user: Usuario | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const r = await api.get<{ usuario: Usuario }>("/api/auth/me");
      setUser(r.usuario);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api.post<{ usuario: Usuario }>("/api/auth/login", { email, password });
    setUser(r.usuario);
  };

  const logout = async () => {
    await api.post("/api/auth/logout");
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}

export function hasRole(user: Usuario | null, ...roles: string[]): boolean {
  if (!user) return false;
  return user.roles.includes("admin") || user.roles.some((r) => roles.includes(r));
}
