import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

export default function LoginPage() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [instNombre, setInstNombre] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ nombre: string }>("/api/auth/info")
      .then((r) => setInstNombre(r.nombre))
      .catch(() => {});
  }, []);

  if (user) {
    nav("/", { replace: true });
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await login(email, password);
      nav("/", { replace: true });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">AIS Management</h1>
        {instNombre && (
          <p className="text-sm text-slate-500">
            Acceso para <span className="font-medium text-slate-700">{instNombre}</span>
          </p>
        )}
        <div>
          <label className="text-sm font-medium">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="text-sm font-medium">Contrasena</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <button type="submit" className="btn w-full" disabled={loading}>
          {loading ? "Validando..." : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
