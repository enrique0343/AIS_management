import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

type Hosp = {
  ocupacion_id: number;
  fecha_ingreso: string;
  precio_diario_snapshot: number;
  episodio_id: number | null;
  observaciones: string | null;
  paciente_id: number;
  expediente: string;
  nombres: string;
  apellidos: string;
  documento_tipo: string | null;
  documento_numero: string | null;
  telefono: string | null;
  habitacion_id: number;
  habitacion: string;
  habitacion_tipo: string;
  dias_estancia: number;
  alta_solicitada_en: string | null;
};

type Hab = {
  id: number;
  numero: string;
  tipo: string;
  precio_diario: number;
  capacidad: number;
  ocupantes_actuales: number;
  activa: number;
};

type Pac = { id: number; expediente: string; nombres: string; apellidos: string; documento_numero: string | null };

export default function Hospitalizacion() {
  const [hospitalizados, setHospitalizados] = useState<Hosp[]>([]);
  const [habitaciones, setHabitaciones] = useState<Hab[]>([]);
  const [show, setShow] = useState(false);
  const [busqPac, setBusqPac] = useState("");
  const [pacientes, setPacientes] = useState<Pac[]>([]);
  const [form, setForm] = useState<any>({ paciente_id: "", habitacion_id: "", motivo: "Hospitalizacion", observaciones: "" });

  const load = () => {
    api.get<{ data: Hosp[] }>("/api/habitaciones/_hospitalizados").then((r) => setHospitalizados(r.data));
    api.get<{ data: Hab[] }>("/api/habitaciones").then((r) => setHabitaciones(r.data));
  };
  useEffect(() => { load(); }, []);

  const buscarPacientes = async (q: string) => {
    setBusqPac(q);
    if (!q.trim()) { setPacientes([]); return; }
    const r = await api.get<{ data: Pac[] }>(`/api/pacientes?q=${encodeURIComponent(q)}`);
    setPacientes(r.data);
  };

  const disponibles = useMemo(
    () => habitaciones.filter((h) => h.activa && h.ocupantes_actuales < h.capacidad),
    [habitaciones]
  );

  const hospitalizar = async () => {
    if (!form.paciente_id || !form.habitacion_id) {
      alert("Selecciona paciente y habitacion");
      return;
    }
    try {
      await api.post("/api/habitaciones/asignar", {
        paciente_id: Number(form.paciente_id),
        habitacion_id: Number(form.habitacion_id),
        motivo: form.motivo || "Hospitalizacion",
        observaciones: form.observaciones || null,
      });
      setShow(false);
      setForm({ paciente_id: "", habitacion_id: "", motivo: "Hospitalizacion", observaciones: "" });
      setBusqPac("");
      setPacientes([]);
      load();
    } catch (e: any) { alert(e.message); }
  };

  const egresar = async (ocupId: number, nombre: string) => {
    if (!confirm(`Egresar a ${nombre}? Quedara facturable.`)) return;
    await api.post(`/api/habitaciones/ocupacion/${ocupId}/egresar`, {});
    load();
  };

  const totalCamas = habitaciones.filter((h) => h.activa).reduce((s, h) => s + h.capacidad, 0);
  const ocupadas = hospitalizados.length;
  const libres = totalCamas - ocupadas;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Hospitalizacion</h1>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={load}>Refrescar</button>
          <button className="btn" onClick={() => setShow(true)}>+ Hospitalizar paciente</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="card"><div className="text-xs text-slate-500">Hospitalizados</div><div className="text-2xl font-semibold text-blue-600">{ocupadas}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Camas libres</div><div className="text-2xl font-semibold text-green-600">{libres}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Capacidad total</div><div className="text-2xl font-semibold">{totalCamas}</div></div>
        <div className="card"><div className="text-xs text-slate-500">% ocupacion actual</div><div className="text-2xl font-semibold">{totalCamas ? Math.round((ocupadas / totalCamas) * 100) : 0}%</div></div>
      </div>

      {!hospitalizados.length ? (
        <div className="card text-sm text-slate-500">No hay pacientes hospitalizados.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {hospitalizados.map((h) => (
            <div key={h.ocupacion_id} className={`card border-l-4 ${h.alta_solicitada_en ? "border-amber-500" : "border-blue-500"}`}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold">{h.nombres} {h.apellidos}</div>
                  <div className="text-xs text-slate-500">Exp: {h.expediente}</div>
                  {h.documento_numero && <div className="text-xs text-slate-500">{h.documento_tipo}: {h.documento_numero}</div>}
                </div>
                {h.alta_solicitada_en && <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded">ALTA SOLICITADA</span>}
              </div>
              <div className="mt-2 text-sm space-y-1">
                <div><span className="text-slate-500">Habitacion:</span> <strong>{h.habitacion}</strong> ({h.habitacion_tipo})</div>
                <div><span className="text-slate-500">Ingreso:</span> {h.fecha_ingreso}</div>
                <div><span className="text-slate-500">Estancia:</span> {h.dias_estancia} dia(s)</div>
                <div><span className="text-slate-500">Precio/dia:</span> ${Number(h.precio_diario_snapshot).toFixed(2)}</div>
                <div><span className="text-slate-500">Acumulado habitacion:</span> <strong>${(h.dias_estancia * h.precio_diario_snapshot).toFixed(2)}</strong></div>
              </div>
              <div className="mt-3 flex gap-2 flex-wrap">
                <Link to="/atencion" className="btn-secondary text-xs">Atencion</Link>
                <button className="btn-danger text-xs" onClick={() => egresar(h.ocupacion_id, `${h.nombres} ${h.apellidos}`)}>Egresar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-lg space-y-3 max-h-[90vh] overflow-auto">
            <h2 className="font-semibold text-lg">Hospitalizar paciente</h2>
            <p className="text-xs text-slate-500">
              Asignar habitacion no requiere registrar cargos previos. Si el paciente
              no tiene episodio activo se abre uno automaticamente.
            </p>

            <div>
              <label className="text-xs font-medium">Paciente *</label>
              <input
                className="input"
                placeholder="Buscar por nombre, expediente o documento..."
                value={busqPac}
                onChange={(e) => buscarPacientes(e.target.value)}
              />
              {pacientes.length > 0 && (
                <div className="border rounded mt-1 max-h-40 overflow-auto">
                  {pacientes.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setForm({ ...form, paciente_id: p.id }); setBusqPac(`${p.nombres} ${p.apellidos} (${p.expediente})`); setPacientes([]); }}
                      className={`block w-full text-left px-2 py-1 text-sm hover:bg-blue-50 ${form.paciente_id == p.id ? "bg-blue-100" : ""}`}
                    >
                      {p.expediente} - {p.nombres} {p.apellidos} {p.documento_numero ? `(${p.documento_numero})` : ""}
                    </button>
                  ))}
                </div>
              )}
              {form.paciente_id && pacientes.length === 0 && (
                <div className="text-xs text-green-700 mt-1">Paciente seleccionado.</div>
              )}
              <p className="text-xs text-slate-500 mt-1">
                Si no esta registrado, ve a <Link className="text-blue-600 hover:underline" to="/pacientes">Pacientes</Link> primero.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium">Habitacion disponible *</label>
              <select className="input" value={form.habitacion_id} onChange={(e) => setForm({ ...form, habitacion_id: e.target.value })}>
                <option value="">-- Seleccionar --</option>
                {disponibles.length === 0 && <option disabled>No hay habitaciones disponibles</option>}
                {disponibles.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.numero} - {h.tipo} (${Number(h.precio_diario).toFixed(2)}/dia) - {h.ocupantes_actuales}/{h.capacidad}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium">Motivo de ingreso</label>
              <input className="input" value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} />
            </div>

            <div>
              <label className="text-xs font-medium">Observaciones</label>
              <textarea className="input" value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setShow(false)}>Cancelar</button>
              <button className="btn" onClick={hospitalizar} disabled={!form.paciente_id || !form.habitacion_id}>Hospitalizar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
