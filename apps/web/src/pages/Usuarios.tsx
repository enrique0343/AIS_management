import { useEffect, useState } from "react";
import { api } from "../lib/api";

type User = { id: number; email: string; nombre: string; activo: number; creado_en: string; roles: string | null };
type Rol = { id: number; codigo: string; nombre: string };
type AuditRow = { id: number; fecha: string; accion: string; entidad: string; entidad_id: number | null; payload: string | null; ip: string | null; usuario_id: number | null; usuario: string | null };

export default function Usuarios() {
  const [tab, setTab] = useState<"usuarios" | "auditoria">("usuarios");
  const [items, setItems] = useState<User[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);

  // Nuevo usuario
  const [showNuevo, setShowNuevo] = useState(false);
  const [form, setForm] = useState<{ email: string; password: string; nombre: string; roles: string[] }>({ email: "", password: "", nombre: "", roles: [] });

  // Editar roles modal
  const [rolesModal, setRolesModal] = useState<{ user: User; selected: string[] } | null>(null);

  // Reset password modal
  const [resetModal, setResetModal] = useState<{ user: User; pwd: string; confirm: string } | null>(null);
  const [resetError, setResetError] = useState("");

  // Auditoria
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [acciones, setAcciones] = useState<string[]>([]);
  const [audDesde, setAudDesde] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [audHasta, setAudHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [audAccion, setAudAccion] = useState("");
  const [audUsuarioId, setAudUsuarioId] = useState("");
  const [auditDetalle, setAuditDetalle] = useState<number | null>(null);

  const load = () => api.get<{ data: User[] }>("/api/usuarios").then((r) => setItems(r.data));

  const loadAudit = () => {
    const q = new URLSearchParams({ desde: audDesde, hasta: audHasta });
    if (audAccion) q.set("accion", audAccion);
    if (audUsuarioId) q.set("usuario_id", audUsuarioId);
    api.get<{ data: AuditRow[] }>(`/api/usuarios/auditoria?${q}`).then((r) => setAudit(r.data));
  };

  useEffect(() => {
    load();
    api.get<{ data: Rol[] }>("/api/usuarios/roles").then((r) => setRoles(r.data));
  }, []);

  useEffect(() => {
    if (tab === "auditoria") {
      loadAudit();
      api.get<{ data: string[] }>("/api/usuarios/auditoria/acciones").then((r) => setAcciones(r.data));
    }
  }, [tab]);

  // ===== Acciones usuarios =====
  const submit = async () => {
    if (!form.email || form.password.length < 8 || !form.nombre) { alert("Email, nombre y password (>=8) requeridos"); return; }
    await api.post("/api/usuarios", form);
    setShowNuevo(false);
    setForm({ email: "", password: "", nombre: "", roles: [] });
    load();
  };

  const abrirRoles = (u: User) => {
    setRolesModal({ user: u, selected: (u.roles ?? "").split(",").filter(Boolean) });
  };

  const guardarRoles = async () => {
    if (!rolesModal) return;
    await api.post(`/api/usuarios/${rolesModal.user.id}/roles`, { roles: rolesModal.selected });
    setRolesModal(null);
    load();
  };

  const desactivar = async (u: User) => {
    if (!confirm(`Desactivar ${u.email}?`)) return;
    await api.post(`/api/usuarios/${u.id}/desactivar`);
    load();
  };

  const activar = async (u: User) => {
    if (!confirm(`Reactivar ${u.email}?`)) return;
    await api.post(`/api/usuarios/${u.id}/activar`);
    load();
  };

  const abrirReset = (u: User) => {
    setResetModal({ user: u, pwd: "", confirm: "" });
    setResetError("");
  };

  const confirmarReset = async () => {
    if (!resetModal) return;
    if (resetModal.pwd.length < 8) { setResetError("La contraseña debe tener al menos 8 caracteres"); return; }
    if (resetModal.pwd !== resetModal.confirm) { setResetError("Las contraseñas no coinciden"); return; }
    try {
      await api.post(`/api/usuarios/${resetModal.user.id}/reset-password`, { password: resetModal.pwd });
      setResetModal(null);
      alert("Contraseña actualizada");
    } catch (e: any) { setResetError(e.message ?? "Error"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        {tab === "usuarios" && <button className="btn" onClick={() => setShowNuevo(true)}>Nuevo usuario</button>}
      </div>

      <div className="flex gap-1 border-b">
        {(["usuarios", "auditoria"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t === "usuarios" ? "Usuarios" : "Auditoria"}
          </button>
        ))}
      </div>

      {/* ===== Tab usuarios ===== */}
      {tab === "usuarios" && (
        <div className="card overflow-auto">
          <table className="table">
            <thead>
              <tr><th>Nombre</th><th>Email</th><th>Roles</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className={u.activo ? "" : "opacity-50"}>
                  <td className="font-medium">{u.nombre}</td>
                  <td className="text-slate-500">{u.email}</td>
                  <td>
                    {(u.roles ?? "").split(",").filter(Boolean).map((r) => (
                      <span key={r} className="inline-block text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 mr-1">{r}</span>
                    ))}
                    {!u.roles && <span className="text-xs text-slate-400">Sin roles</span>}
                  </td>
                  <td>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${u.activo ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                      {u.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="space-x-1 whitespace-nowrap">
                    <button className="btn-secondary text-xs" onClick={() => abrirRoles(u)}>Roles</button>
                    <button className="btn-secondary text-xs" onClick={() => abrirReset(u)}>Clave</button>
                    {u.activo === 1
                      ? <button className="text-xs text-red-600 hover:underline px-1" onClick={() => desactivar(u)}>Desactivar</button>
                      : <button className="text-xs text-green-600 hover:underline px-1" onClick={() => activar(u)}>Reactivar</button>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== Tab auditoria ===== */}
      {tab === "auditoria" && (
        <div className="space-y-3">
          {/* Filtros */}
          <div className="card flex flex-wrap gap-2 items-end">
            <div><label className="text-xs">Desde</label><input className="input" type="date" value={audDesde} onChange={(e) => setAudDesde(e.target.value)} /></div>
            <div><label className="text-xs">Hasta</label><input className="input" type="date" value={audHasta} onChange={(e) => setAudHasta(e.target.value)} /></div>
            <div>
              <label className="text-xs">Accion</label>
              <select className="input" value={audAccion} onChange={(e) => setAudAccion(e.target.value)}>
                <option value="">Todas</option>
                {acciones.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs">Usuario</label>
              <select className="input" value={audUsuarioId} onChange={(e) => setAudUsuarioId(e.target.value)}>
                <option value="">Todos</option>
                {items.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <button className="btn-secondary" onClick={loadAudit}>Buscar</button>
          </div>

          <div className="card overflow-auto">
            <table className="table text-xs">
              <thead>
                <tr><th>Fecha</th><th>Usuario</th><th>Accion</th><th>Entidad</th><th>ID</th><th>IP</th><th></th></tr>
              </thead>
              <tbody>
                {!audit.length && (
                  <tr><td colSpan={7} className="text-center text-slate-400 py-4">Sin registros para los filtros seleccionados</td></tr>
                )}
                {audit.map((a) => (
                  <>
                    <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setAuditDetalle(auditDetalle === a.id ? null : a.id)}>
                      <td className="text-slate-500">{a.fecha?.slice(0, 16)}</td>
                      <td>{a.usuario ?? "-"}</td>
                      <td><span className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[11px]">{a.accion}</span></td>
                      <td>{a.entidad}</td>
                      <td>{a.entidad_id ?? "-"}</td>
                      <td className="text-slate-400">{a.ip ?? "-"}</td>
                      <td className="text-slate-400">{a.payload ? (auditDetalle === a.id ? "▲" : "▼") : ""}</td>
                    </tr>
                    {auditDetalle === a.id && a.payload && (
                      <tr key={`${a.id}-det`} className="bg-slate-50">
                        <td colSpan={7} className="px-3 py-2">
                          <pre className="text-[11px] text-slate-600 whitespace-pre-wrap break-all font-mono bg-white border rounded p-2">
                            {(() => { try { return JSON.stringify(JSON.parse(a.payload), null, 2); } catch { return a.payload; } })()}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== Modal nuevo usuario ===== */}
      {showNuevo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md space-y-3">
            <h2 className="font-semibold">Nuevo usuario</h2>
            <input className="input" placeholder="Nombre completo" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            <input className="input" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="input" placeholder="Contraseña (mín. 8 caracteres)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <div className="border rounded p-2 space-y-1">
              <div className="text-xs font-medium text-slate-500 mb-1">Roles</div>
              {roles.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.roles.includes(r.codigo)}
                    onChange={(e) => setForm({ ...form, roles: e.target.checked ? [...form.roles, r.codigo] : form.roles.filter((x) => x !== r.codigo) })} />
                  <span>{r.nombre}</span><span className="text-xs text-slate-400">({r.codigo})</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowNuevo(false)}>Cancelar</button>
              <button className="btn" onClick={submit}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal editar roles ===== */}
      {rolesModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-sm space-y-3">
            <h2 className="font-semibold">Roles — {rolesModal.user.nombre}</h2>
            <div className="border rounded p-2 space-y-1">
              {roles.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={rolesModal.selected.includes(r.codigo)}
                    onChange={(e) => setRolesModal({
                      ...rolesModal,
                      selected: e.target.checked
                        ? [...rolesModal.selected, r.codigo]
                        : rolesModal.selected.filter((x) => x !== r.codigo),
                    })} />
                  <span>{r.nombre}</span><span className="text-xs text-slate-400">({r.codigo})</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setRolesModal(null)}>Cancelar</button>
              <button className="btn" onClick={guardarRoles}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal reset contraseña ===== */}
      {resetModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-sm space-y-3">
            <h2 className="font-semibold">Cambiar contraseña — {resetModal.user.nombre}</h2>
            <input className="input" type="password" placeholder="Nueva contraseña (mín. 8)" value={resetModal.pwd}
              onChange={(e) => { setResetModal({ ...resetModal, pwd: e.target.value }); setResetError(""); }} />
            <input className="input" type="password" placeholder="Confirmar contraseña" value={resetModal.confirm}
              onChange={(e) => { setResetModal({ ...resetModal, confirm: e.target.value }); setResetError(""); }} />
            {resetError && <div className="text-xs text-red-600">{resetError}</div>}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setResetModal(null)}>Cancelar</button>
              <button className="btn" onClick={confirmarReset}>Actualizar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
