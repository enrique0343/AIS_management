import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth, hasRole } from "../lib/auth";

type Cita = {
  id: number; profesional_id: number; paciente_id: number;
  fecha_hora: string; duracion: number; tipo: string; estado: string;
  motivo?: string; notas?: string;
  paciente_nombre: string; expediente: string;
  profesional_nombre: string; especialidad?: string;
};
type StatsDia = { total: number; agendadas: number; confirmadas: number; en_espera: number; atendidas: number; no_show: number };
type Profesional = { id: number; nombres: string; apellidos: string; especialidad?: string };
type Paciente    = { id: number; expediente: string; nombres: string; apellidos: string };
type Agenda      = { id: number; dia_semana: number; hora_inicio: string; hora_fin: string; duracion_cita: number; profesional_nombre: string };

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const ESTADOS: Record<string, string> = {
  agendada: "bg-blue-100 text-blue-700",
  confirmada: "bg-green-100 text-green-700",
  en_espera: "bg-amber-100 text-amber-700",
  atendida: "bg-slate-100 text-slate-600",
  no_show: "bg-red-100 text-red-700",
  cancelada: "bg-rose-50 text-rose-500",
};

function hoy() { return new Date().toISOString().slice(0, 10); }
function fechaMas(n: number) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function Citas() {
  const { user } = useAuth();
  const [tab, setTab]     = useState<"dia" | "semana" | "agenda">("dia");
  const [fecha, setFecha] = useState(hoy());
  const [profId, setProfId] = useState<number | null>(null);
  const [citas, setCitas]   = useState<Cita[]>([]);
  const [stats, setStats]   = useState<StatsDia | null>(null);
  const [profs, setProfs]   = useState<Profesional[]>([]);
  const [pacs, setPacs]     = useState<Paciente[]>([]);
  const [agenda, setAgenda] = useState<Agenda[]>([]);
  const [loading, setLoading] = useState(false);

  /* modal nueva cita */
  const [nuevaModal, setNuevaModal] = useState(false);
  const [form, setForm]  = useState({ profesional_id: "", paciente_id: "", fecha_hora: "", duracion: 30, tipo: "consulta", motivo: "" });
  const [pacQ, setPacQ]  = useState("");
  const [pacOpts, setPacOpts] = useState<Paciente[]>([]);

  /* modal detalle */
  const [detalle, setDetalle] = useState<Cita | null>(null);

  useEffect(() => { cargarBase(); }, []);
  useEffect(() => { if (tab === "dia" || tab === "semana") cargarCitas(); }, [fecha, profId, tab]);
  useEffect(() => { if (tab === "agenda") cargarAgenda(); }, [tab]);

  async function cargarBase() {
    const [p] = await Promise.all([
      api.get<Profesional[]>("/api/profesionales?activo=1").catch(() => [] as Profesional[]),
    ]);
    setProfs(p);
  }
  async function cargarCitas() {
    setLoading(true);
    const desde = tab === "semana" ? fecha : fecha;
    const hasta = tab === "semana" ? fechaMas(6) : fecha;
    const qs = new URLSearchParams({ desde, hasta });
    if (profId) qs.set("profesional_id", String(profId));
    const [c, s] = await Promise.all([
      api.get<Cita[]>(`/api/citas?${qs}`).catch(() => [] as Cita[]),
      api.get<StatsDia>(`/api/citas/_stats_dia?fecha=${fecha}`).catch(() => null),
    ]);
    setCitas(c); setStats(s);
    setLoading(false);
  }
  async function cargarAgenda() {
    const a = await api.get<Agenda[]>("/api/citas/agenda").catch(() => [] as Agenda[]);
    setAgenda(a);
  }

  async function buscarPaciente(q: string) {
    setPacQ(q);
    if (q.length < 2) { setPacOpts([]); return; }
    const r = await api.get<Paciente[]>(`/api/pacientes?q=${encodeURIComponent(q)}&limit=10`).catch(() => [] as Paciente[]);
    setPacOpts(r);
  }

  async function guardarCita(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/api/citas", form).catch((err) => { alert(err.message); throw err; });
    setNuevaModal(false);
    setForm({ profesional_id: "", paciente_id: "", fecha_hora: "", duracion: 30, tipo: "consulta", motivo: "" });
    setPacQ(""); setPacOpts([]);
    cargarCitas();
  }

  async function cambiarEstado(id: number, estado: string) {
    await api.put(`/api/citas/${id}`, { estado });
    setDetalle(null); cargarCitas();
  }
  async function cancelarCita(id: number) {
    if (!confirm("¿Cancelar cita?")) return;
    await api.del(`/api/citas/${id}`);
    setDetalle(null); cargarCitas();
  }

  const TRANSICIONES: Record<string, string[]> = {
    agendada:   ["confirmada", "cancelada"],
    confirmada: ["en_espera", "cancelada"],
    en_espera:  ["atendida", "no_show"],
  };

  /* agrupa citas de semana por fecha */
  const semana = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(fecha); d.setDate(d.getDate() + i);
    const f = d.toISOString().slice(0, 10);
    return { fecha: f, label: `${DIAS[d.getDay()]} ${d.getDate()}`, citas: citas.filter((c) => c.fecha_hora.startsWith(f)) };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">Citas médicas</h1>
        {hasRole(user, "admin", "facturacion", "medico", "programador_quirofano") && (
          <button onClick={() => setNuevaModal(true)} className="btn-primary text-sm">+ Nueva cita</button>
        )}
      </div>

      {/* Stats del día */}
      {stats && tab !== "agenda" && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { label: "Total",     v: stats.total,      color: "bg-slate-100 text-slate-700" },
            { label: "Agendadas", v: stats.agendadas,  color: "bg-blue-100 text-blue-700" },
            { label: "Confirm.",  v: stats.confirmadas, color: "bg-green-100 text-green-700" },
            { label: "Espera",    v: stats.en_espera,  color: "bg-amber-100 text-amber-700" },
            { label: "Atendidas", v: stats.atendidas,  color: "bg-slate-100 text-slate-600" },
            { label: "No show",   v: stats.no_show,    color: "bg-red-100 text-red-700" },
          ].map((s) => (
            <div key={s.label} className={`${s.color} rounded-lg p-2 text-center`}>
              <div className="text-lg font-bold">{s.v}</div>
              <div className="text-xs">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* tabs + filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 border border-slate-200 rounded-lg overflow-hidden text-sm">
          {(["dia", "semana", "agenda"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 ${tab === t ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {t === "dia" ? "Día" : t === "semana" ? "Semana" : "Agenda"}
            </button>
          ))}
        </div>
        {tab !== "agenda" && (
          <>
            <input type="date" className="input-sm" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <select className="input-sm" value={profId ?? ""} onChange={(e) => setProfId(e.target.value ? +e.target.value : null)}>
              <option value="">Todos los médicos</option>
              {profs.map((p) => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos}</option>)}
            </select>
          </>
        )}
      </div>

      {/* ════ VISTA DÍA ════ */}
      {tab === "dia" && (
        <div className="space-y-2">
          {loading ? <div className="text-slate-400 text-sm p-4">Cargando...</div> : (
            <>
              {citas.filter((c) => c.fecha_hora.startsWith(fecha)).length === 0 && (
                <div className="card p-8 text-center text-slate-400">Sin citas para esta fecha</div>
              )}
              {citas.filter((c) => c.fecha_hora.startsWith(fecha)).sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora)).map((cita) => (
                <div key={cita.id}
                  className="card p-3 flex items-center gap-4 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setDetalle(cita)}>
                  <div className="text-sm font-mono text-slate-700 w-14 shrink-0">
                    {cita.fecha_hora.slice(11, 16)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-slate-800">{cita.paciente_nombre}</div>
                    <div className="text-xs text-slate-500">{cita.profesional_nombre} · {cita.tipo}</div>
                    {cita.motivo && <div className="text-xs text-slate-400 truncate">{cita.motivo}</div>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADOS[cita.estado] ?? "bg-slate-100"}`}>{cita.estado}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ════ VISTA SEMANA ════ */}
      {tab === "semana" && (
        <div className="grid grid-cols-7 gap-1 overflow-x-auto">
          {semana.map((dia) => (
            <div key={dia.fecha} className="min-w-0">
              <div className={`text-center text-xs font-semibold py-1.5 rounded-t ${dia.fecha === hoy() ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                {dia.label}
              </div>
              <div className="space-y-1 p-1 min-h-[120px] border border-slate-200 rounded-b bg-white">
                {dia.citas.map((c) => (
                  <div key={c.id}
                    onClick={() => setDetalle(c)}
                    className={`text-xs p-1 rounded cursor-pointer truncate ${ESTADOS[c.estado] ?? "bg-slate-100"}`}>
                    {c.fecha_hora.slice(11, 16)} {c.paciente_nombre.split(" ")[0]}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════ AGENDA MÉDICOS ════ */}
      {tab === "agenda" && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-xs">
              {["Médico", "Día", "Inicio", "Fin", "Duración (min)", ""].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
            </tr></thead>
            <tbody>
              {agenda.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">{a.profesional_nombre}</td>
                  <td className="px-3 py-2">{DIAS[a.dia_semana]}</td>
                  <td className="px-3 py-2 font-mono">{a.hora_inicio}</td>
                  <td className="px-3 py-2 font-mono">{a.hora_fin}</td>
                  <td className="px-3 py-2">{a.duracion_cita}</td>
                  <td className="px-3 py-2">
                    {hasRole(user, "admin", "programador_quirofano") && (
                      <button onClick={async () => { await api.del(`/api/citas/agenda/${a.id}`); cargarAgenda(); }}
                        className="text-red-400 hover:text-red-600 text-xs">Desactivar</button>
                    )}
                  </td>
                </tr>
              ))}
              {agenda.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Sin bloques de agenda configurados</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ════ MODAL NUEVA CITA ════ */}
      {nuevaModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">Nueva cita</h2>
            <form onSubmit={guardarCita} className="space-y-3">
              <div>
                <label className="label-sm">Médico</label>
                <select required className="input-sm w-full" value={form.profesional_id} onChange={(e) => setForm((p) => ({ ...p, profesional_id: e.target.value }))}>
                  <option value="">Seleccionar...</option>
                  {profs.map((p) => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos} — {p.especialidad ?? "General"}</option>)}
                </select>
              </div>
              <div className="relative">
                <label className="label-sm">Paciente</label>
                <input className="input-sm w-full" value={pacQ} onChange={(e) => buscarPaciente(e.target.value)} placeholder="Buscar por nombre o expediente..." />
                {pacOpts.length > 0 && (
                  <ul className="absolute z-10 bg-white border border-slate-200 rounded shadow-lg w-full max-h-36 overflow-y-auto text-xs">
                    {pacOpts.map((p) => (
                      <li key={p.id} className="px-3 py-2 hover:bg-blue-50 cursor-pointer"
                        onClick={() => { setForm((f) => ({ ...f, paciente_id: String(p.id) })); setPacQ(`${p.nombres} ${p.apellidos} (${p.expediente})`); setPacOpts([]); }}>
                        {p.nombres} {p.apellidos} — {p.expediente}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-sm">Fecha y hora</label>
                  <input required type="datetime-local" className="input-sm w-full" value={form.fecha_hora} onChange={(e) => setForm((p) => ({ ...p, fecha_hora: e.target.value }))} />
                </div>
                <div>
                  <label className="label-sm">Duración (min)</label>
                  <input type="number" className="input-sm w-full" value={form.duracion} onChange={(e) => setForm((p) => ({ ...p, duracion: +e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label-sm">Tipo</label>
                <select className="input-sm w-full" value={form.tipo} onChange={(e) => setForm((p) => ({ ...p, tipo: e.target.value }))}>
                  {["consulta", "seguimiento", "procedimiento"].map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="label-sm">Motivo</label>
                <input className="input-sm w-full" value={form.motivo} onChange={(e) => setForm((p) => ({ ...p, motivo: e.target.value }))} />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setNuevaModal(false)} className="btn-secondary flex-1">Cancelar</button>
                <button type="submit" className="btn-primary flex-1">Agendar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════ MODAL DETALLE CITA ════ */}
      {detalle && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold">Cita #{detalle.id}</h2>
              <button onClick={() => setDetalle(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="space-y-1 text-sm">
              <p><span className="text-slate-500">Paciente:</span> <strong>{detalle.paciente_nombre}</strong> ({detalle.expediente})</p>
              <p><span className="text-slate-500">Médico:</span> {detalle.profesional_nombre}</p>
              <p><span className="text-slate-500">Fecha:</span> {new Date(detalle.fecha_hora).toLocaleString("es-SV")}</p>
              <p><span className="text-slate-500">Tipo:</span> {detalle.tipo}</p>
              {detalle.motivo && <p><span className="text-slate-500">Motivo:</span> {detalle.motivo}</p>}
              <p><span className="text-slate-500">Estado:</span>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${ESTADOS[detalle.estado] ?? ""}`}>{detalle.estado}</span>
              </p>
            </div>
            {hasRole(user, "admin", "facturacion", "medico", "programador_quirofano") && TRANSICIONES[detalle.estado] && (
              <div className="flex flex-wrap gap-2">
                {TRANSICIONES[detalle.estado].map((s) => (
                  <button key={s} onClick={() => cambiarEstado(detalle.id, s)}
                    className={`btn-secondary text-xs ${s === "cancelada" ? "!border-red-300 !text-red-600 hover:!bg-red-50" : ""}`}>
                    → {s}
                  </button>
                ))}
              </div>
            )}
            {detalle.estado === "cancelada" || detalle.estado === "no_show" ? null : (
              <button onClick={() => cancelarCita(detalle.id)} className="btn-danger text-xs w-full">Cancelar cita</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
