import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Honorario = {
  id: number; profesional: string; especialidad: string | null;
  paciente: string | null; expediente: string | null;
  concepto: string; monto: number; estado: string;
  fecha_cobro: string | null; notas: string | null; creado_en: string;
};
type PendienteEntrega = {
  profesional_id: number; profesional: string; especialidad: string | null;
  cantidad: number; total: number;
};
type Entrega = {
  id: number; fecha: string; profesional: string; monto_total: number;
  comprobante: string | null; notas: string | null; creado_por_nombre: string | null;
};

const CONCEPTOS = ["consulta", "cirugia", "anestesia", "procedimiento", "otro"];
const EMPTY_FORM = { profesional_id: "", concepto: "consulta", monto: "", episodio_id: "", notas: "" };

export default function Honorarios() {
  const [tab, setTab] = useState<"registros" | "pendientes" | "entregas">("registros");
  const [items, setItems] = useState<Honorario[]>([]);
  const [pendientes, setPendientes] = useState<PendienteEntrega[]>([]);
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [profesionales, setProfesionales] = useState<any[]>([]);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [entregaModal, setEntregaModal] = useState<PendienteEntrega | null>(null);
  const [entregaForm, setEntregaForm] = useState({ comprobante: "", notas: "" });
  const [filtroEstado, setFiltroEstado] = useState("");

  const loadItems = (estado = filtroEstado) =>
    api.get<{ data: Honorario[] }>(`/api/honorarios${estado ? `?estado=${estado}` : ""}`)
      .then((r) => setItems(r.data)).catch(() => {});
  const loadPendientes = () =>
    api.get<{ data: PendienteEntrega[] }>("/api/honorarios/pendientes-entrega").then((r) => setPendientes(r.data)).catch(() => {});
  const loadEntregas = () =>
    api.get<{ data: Entrega[] }>("/api/honorarios/entregas").then((r) => setEntregas(r.data)).catch(() => {});

  useEffect(() => {
    api.get<{ data: any[] }>("/api/profesionales/medicos").then((r) => setProfesionales(r.data)).catch(() => {});
    loadItems();
  }, []);

  const crearHonorario = async () => {
    if (!form.profesional_id || !form.monto) { alert("Profesional y monto requeridos"); return; }
    try {
      await api.post("/api/honorarios", {
        profesional_id: Number(form.profesional_id),
        concepto: form.concepto,
        monto: Number(form.monto),
        episodio_id: form.episodio_id ? Number(form.episodio_id) : undefined,
        notas: form.notas || undefined,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      loadItems();
    } catch (e: any) { alert(e.message ?? "Error"); }
  };

  const cobrar = async (id: number) => {
    await api.post(`/api/honorarios/${id}/cobrar`, {});
    loadItems();
    loadPendientes();
  };

  const eliminar = async (id: number) => {
    if (!confirm("Eliminar honorario?")) return;
    await api.del(`/api/honorarios/${id}`);
    loadItems();
  };

  const confirmarEntrega = async () => {
    if (!entregaModal) return;
    try {
      await api.post("/api/honorarios/entregar", {
        profesional_id: entregaModal.profesional_id,
        monto_total: entregaModal.total,
        comprobante: entregaForm.comprobante || undefined,
        notas: entregaForm.notas || undefined,
      });
      setEntregaModal(null);
      loadPendientes();
      loadEntregas();
    } catch (e: any) { alert(e.message ?? "Error"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Honorarios Medicos</h1>
        <p className="text-xs text-slate-500 max-w-xs text-right">Fondo de paso — no son ingreso institucional</p>
      </div>

      <div className="flex gap-1 border-b">
        {(["registros", "pendientes", "entregas"] as const).map((t) => (
          <button key={t} onClick={() => {
            setTab(t);
            if (t === "registros") loadItems();
            if (t === "pendientes") loadPendientes();
            if (t === "entregas") loadEntregas();
          }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500"}`}>
            {t === "registros" ? "Todos los registros" : t === "pendientes" ? "Pendientes de entrega" : "Historial de entregas"}
            {t === "pendientes" && pendientes.length > 0 && (
              <span className="ml-1 bg-amber-500 text-white text-xs px-1.5 rounded-full">{pendientes.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "registros" && (
        <div className="space-y-3">
          <div className="flex gap-2 items-end flex-wrap">
            <div>
              <label className="text-xs">Estado</label>
              <select className="input text-sm" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
                <option value="">Todos</option>
                <option value="pendiente">Pendiente</option>
                <option value="cobrado">Cobrado</option>
                <option value="entregado">Entregado</option>
              </select>
            </div>
            <button className="btn-secondary" onClick={() => loadItems(filtroEstado)}>Buscar</button>
            <button className="btn ml-auto" onClick={() => setShowForm(true)}>+ Registrar honorario</button>
          </div>

          {showForm && (
            <div className="card border-l-4 border-blue-400 space-y-3">
              <h3 className="font-semibold text-sm">Nuevo honorario</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <label className="text-xs font-medium">Medico *</label>
                  <select className="input" value={form.profesional_id} onChange={(e) => setForm({ ...form, profesional_id: e.target.value })}>
                    <option value="">-- Seleccionar --</option>
                    {profesionales.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.nombres} {p.apellidos} — {p.especialidad ?? "General"}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium">Concepto *</label>
                  <select className="input" value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })}>
                    {CONCEPTOS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium">Monto ($) *</label>
                  <input className="input" type="number" step="0.01" min="0.01" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium">Episodio ID (opcional)</label>
                  <input className="input" type="number" value={form.episodio_id} onChange={(e) => setForm({ ...form, episodio_id: e.target.value })} />
                </div>
                <div className="md:col-span-3">
                  <label className="text-xs font-medium">Notas</label>
                  <input className="input" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button className="btn" onClick={crearHonorario}>Guardar</button>
              </div>
            </div>
          )}

          <div className="card overflow-auto">
            <table className="table">
              <thead><tr><th>Medico</th><th>Concepto</th><th>Paciente</th><th>Monto</th><th>Estado</th><th>Creado</th><th></th></tr></thead>
              <tbody>
                {!items.length && <tr><td colSpan={7} className="text-center text-slate-500 py-4">Sin registros</td></tr>}
                {items.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <div className="font-medium text-sm">{h.profesional}</div>
                      {h.especialidad && <div className="text-xs text-slate-500">{h.especialidad}</div>}
                    </td>
                    <td><span className="text-xs px-2 py-0.5 rounded bg-slate-100">{h.concepto}</span></td>
                    <td className="text-xs">{h.paciente ?? "-"}</td>
                    <td className="font-semibold">${Number(h.monto).toFixed(2)}</td>
                    <td>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        h.estado === "entregado" ? "bg-green-100 text-green-700" :
                        h.estado === "cobrado" ? "bg-blue-100 text-blue-700" :
                        "bg-amber-100 text-amber-700"
                      }`}>{h.estado}</span>
                    </td>
                    <td className="text-xs text-slate-500">{h.creado_en?.slice(0, 10)}</td>
                    <td className="flex gap-1">
                      {h.estado === "pendiente" && (
                        <>
                          <button className="btn text-xs" onClick={() => cobrar(h.id)}>Cobrado</button>
                          <button className="btn-danger text-xs" onClick={() => eliminar(h.id)}>Eliminar</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "pendientes" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Honorarios cobrados al paciente pendientes de liquidar al medico.</p>
          {!pendientes.length ? (
            <div className="card text-sm text-slate-500">No hay honorarios pendientes de entrega.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {pendientes.map((p) => (
                <div key={p.profesional_id} className="card space-y-2">
                  <div className="font-semibold">{p.profesional}</div>
                  {p.especialidad && <div className="text-xs text-slate-500">{p.especialidad}</div>}
                  <div className="flex justify-between items-end">
                    <div>
                      <div className="text-xs text-slate-500">{p.cantidad} honorario(s)</div>
                      <div className="text-2xl font-bold text-blue-700">${Number(p.total).toFixed(2)}</div>
                    </div>
                    <button className="btn" onClick={() => { setEntregaModal(p); setEntregaForm({ comprobante: "", notas: "" }); }}>
                      Liquidar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "entregas" && (
        <div className="card overflow-auto">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Medico</th><th>Total</th><th>Comprobante</th><th>Registrado por</th></tr></thead>
            <tbody>
              {!entregas.length && <tr><td colSpan={5} className="text-center text-slate-500 py-4">Sin entregas registradas</td></tr>}
              {entregas.map((e) => (
                <tr key={e.id}>
                  <td>{e.fecha}</td>
                  <td>{e.profesional}</td>
                  <td className="font-semibold">${Number(e.monto_total).toFixed(2)}</td>
                  <td className="font-mono text-xs">{e.comprobante ?? "-"}</td>
                  <td className="text-xs text-slate-500">{e.creado_por_nombre ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal liquidación */}
      {entregaModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-sm space-y-4">
            <h2 className="font-semibold">Liquidar honorarios</h2>
            <div className="bg-blue-50 rounded p-3">
              <div className="font-medium">{entregaModal.profesional}</div>
              <div className="text-xs text-slate-500">{entregaModal.cantidad} honorario(s) cobrados</div>
              <div className="text-2xl font-bold text-blue-700 mt-1">${Number(entregaModal.total).toFixed(2)}</div>
            </div>
            <div>
              <label className="text-xs font-medium">No. Comprobante (cheque/transferencia)</label>
              <input className="input" placeholder="Ej. TRF-001-2025" value={entregaForm.comprobante} onChange={(e) => setEntregaForm({ ...entregaForm, comprobante: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium">Notas</label>
              <input className="input" value={entregaForm.notas} onChange={(e) => setEntregaForm({ ...entregaForm, notas: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEntregaModal(null)}>Cancelar</button>
              <button className="btn" onClick={confirmarEntrega}>Confirmar entrega</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
