import { useEffect, useState } from "react";
import { api } from "../lib/api";

type User = { id: number; email: string; nombre: string; activo: number; creado_en: string; roles: string | null };
type Rol = { id: number; codigo: string; nombre: string };

export default function Usuarios() {
  const [items, setItems] = useState<User[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<{ email: string; password: string; nombre: string; roles: string[] }>({
    email: "",
    password: "",
    nombre: "",
    roles: [],
  });

  const load = () => api.get<{ data: User[] }>("/api/usuarios").then((r) => setItems(r.data));
  useEffect(() => {
    load();
    api.get<{ data: Rol[] }>("/api/usuarios/roles").then((r) => setRoles(r.data));
  }, []);

  const submit = async () => {
    if (!form.email || form.password.length < 8 || !form.nombre) {
      alert("Email, nombre y password (>=8) requeridos");
      return;
    }
    await api.post("/api/usuarios", form);
    setShow(false);
    setForm({ email: "", password: "", nombre: "", roles: [] });
    load();
  };

  const cambiarRoles = async (u: User) => {
    const actuales = (u.roles ?? "").split(",").filter(Boolean);
    const lista = roles.map((r) => r.codigo).join(", ");
    const nuevos = prompt(`Roles (separados por coma)\nDisponibles: ${lista}`, actuales.join(","));
    if (nuevos === null) return;
    await api.post(`/api/usuarios/${u.id}/roles`, {
      roles: nuevos.split(",").map((r) => r.trim()).filter(Boolean),
    });
    load();
  };

  const desactivar = async (u: User) => {
    if (!confirm(`Desactivar ${u.email}?`)) return;
    await api.post(`/api/usuarios/${u.id}/desactivar`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <button className="btn" onClick={() => setShow(true)}>Nuevo</button>
      </div>
      <div className="card overflow-auto">
        <table className="table">
          <thead><tr><th>Email</th><th>Nombre</th><th>Roles</th><th>Activo</th><th></th></tr></thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.nombre}</td>
                <td className="text-xs">{u.roles ?? "-"}</td>
                <td>{u.activo ? "Si" : "No"}</td>
                <td className="space-x-1">
                  <button className="btn-secondary text-xs" onClick={() => cambiarRoles(u)}>Roles</button>
                  {u.activo === 1 && <button className="btn-danger text-xs" onClick={() => desactivar(u)}>Desactivar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-md space-y-3">
            <h2 className="font-semibold">Nuevo usuario</h2>
            <input className="input" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="input" placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            <input className="input" placeholder="Password (>=8)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <div className="space-y-1 max-h-48 overflow-auto border rounded p-2">
              <div className="text-xs font-medium text-slate-500">Roles</div>
              {roles.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.roles.includes(r.codigo)}
                    onChange={(e) => {
                      setForm({
                        ...form,
                        roles: e.target.checked
                          ? [...form.roles, r.codigo]
                          : form.roles.filter((x) => x !== r.codigo),
                      });
                    }}
                  />
                  {r.nombre} <span className="text-xs text-slate-400">({r.codigo})</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShow(false)}>Cancelar</button>
              <button className="btn" onClick={submit}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
