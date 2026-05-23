import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Cir = {
  id: number;
  codigo: string;
  fecha_programada: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  inicio_at: string | null;
  fin_at: string | null;
  quirofano: string;
  paciente_id: number | null;
  paciente_nombre: string | null;
  tipo_cirugia: string | null;
  estado: string;
  cirujano_nombre: string | null;
  ayudante_nombre: string | null;
  anestesiologo_nombre: string | null;
};

type Q = { id: number; nombre: string };

function FragmentRow({ q, dias, cirugias, estadoColor, onClick }: {
  q: Q;
  dias: Date[];
  cirugias: Cir[];
  estadoColor: Record<string, string>;
  onClick: (c: Cir) => void;
}) {
  return (
    <>
      <div className="text-xs font-semibold p-2 bg-slate-50 border-r">{q.nombre}</div>
      {dias.map((d) => {
        const fechaStr = d.toISOString().slice(0, 10);
        const items = cirugias.filter((c) => c.quirofano === q.nombre && c.fecha_programada === fechaStr);
        return (
          <div key={d.toISOString()} className="min-h-[80px] p-1 border space-y-1">
            {items.map((c) => (
              <button
                key={c.id}
                onClick={() => onClick(c)}
                className={`block w-full text-left text-xs p-1 rounded border ${estadoColor[c.estado] ?? "bg-white"}`}
              >
                <div className="font-medium">{c.hora_inicio ?? "--"} {c.tipo_cirugia ?? ""}</div>
                <div className="truncate">{c.paciente_nombre ?? "Sin paciente"}</div>
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}
type Prod = { id: number; codigo: string; nombre: string };
type Area = { id: number; nombre: string };
type ConsumoCir = { id: number; producto: string; codigo: string; numero_lote: string | null; cantidad: number; costo_unitario_snapshot: number; consumo_id: number | null };

export default function Quirofano() {
  const [cirugias, setCirugias] = useState<Cir[]>([]);
  const [quirofanos, setQuirofanos] = useState<Q[]>([]);
  const [prods, setProds] = useState<Prod[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [pacientes, setPacientes] = useState<any[]>([]);
  const [medicos, setMedicos] = useState<any[]>([]);
  const [consumosCir, setConsumosCir] = useState<{ cirugia: Cir; lista: ConsumoCir[] } | null>(null);
  const [cForm, setCForm] = useState<any>({ producto_id: "", area_id: "", cantidad: 1 });
  const [show, setShow] = useState(false);
  const blankCirugia = {
    quirofano_id: "",
    inicio_at: "",
    fin_at: "",
    paciente_id: "",
    paciente_pendiente_nombre: "",
    tipo_cirugia: "",
    medico_principal_id: "",
    cirujano_ayudante_id: "",
    anestesiologo_id: "",
    observaciones: "",
  };
  const [form, setForm] = useState<any>(blankCirugia);

  const [vista, setVista] = useState<"tabla" | "calendario">("calendario");
  const [semanaBase, setSemanaBase] = useState<Date>(() => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // lunes = 0
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(semanaBase); d.setDate(d.getDate() + i); return d;
  });
  const fmtDia = (d: Date) => d.toISOString().slice(0, 10);

  const load = () => {
    const desde = fmtDia(dias[0]);
    const hasta = fmtDia(dias[6]);
    const url = vista === "calendario"
      ? `/api/quirofano/cirugias?desde=${desde}&hasta=${hasta}`
      : "/api/quirofano/cirugias";
    api.get<{ data: Cir[] }>(url).then((r) => setCirugias(r.data));
  };

  useEffect(() => { load(); }, [vista, semanaBase]);
  useEffect(() => {
    api.get<{ data: Q[] }>("/api/quirofano/quirofanos").then((r) => setQuirofanos(r.data));
    api.get<{ data: Prod[] }>("/api/productos").then((r) => setProds(r.data));
    api.get<{ data: Area[] }>("/api/catalogos/areas").then((r) => setAreas(r.data));
    api.get<{ data: any[] }>("/api/pacientes").then((r) => setPacientes(r.data));
    api.get<{ data: any[] }>("/api/profesionales/medicos").then((r) => setMedicos(r.data));
  }, []);

  const estadoColor: Record<string, string> = {
    programada: "bg-blue-100 border-blue-300",
    en_curso: "bg-amber-100 border-amber-300",
    realizada: "bg-green-100 border-green-300",
    suspendida: "bg-slate-100 border-slate-300",
    cancelada: "bg-red-100 border-red-300",
  };

  const abrirConsumos = async (c: Cir) => {
    const r = await api.get<{ data: ConsumoCir[] }>(`/api/quirofano/cirugias/${c.id}/consumos`);
    setConsumosCir({ cirugia: c, lista: r.data });
  };

  const regCons = async () => {
    if (!consumosCir) return;
    try {
      await api.post(`/api/quirofano/cirugias/${consumosCir.cirugia.id}/consumos`, {
        producto_id: Number(cForm.producto_id),
        area_id: Number(cForm.area_id),
        cantidad: Number(cForm.cantidad),
      });
      setCForm({ ...cForm, producto_id: "", cantidad: 1 });
      abrirConsumos(consumosCir.cirugia);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const submit = async () => {
    if (!form.quirofano_id || !form.inicio_at || !form.fin_at || !form.medico_principal_id) {
      alert("Quirofano, inicio, fin y cirujano son obligatorios");
      return;
    }
    if (form.fin_at <= form.inicio_at) {
      alert("La hora de fin debe ser posterior a la de inicio");
      return;
    }
    try {
      await api.post("/api/quirofano/cirugias", {
        quirofano_id: Number(form.quirofano_id),
        inicio_at: form.inicio_at,
        fin_at: form.fin_at,
        paciente_id: form.paciente_id ? Number(form.paciente_id) : null,
        paciente_pendiente_nombre: form.paciente_id ? null : (form.paciente_pendiente_nombre || null),
        tipo_cirugia: form.tipo_cirugia || null,
        medico_principal_id: Number(form.medico_principal_id),
        cirujano_ayudante_id: form.cirujano_ayudante_id ? Number(form.cirujano_ayudante_id) : null,
        anestesiologo_id: form.anestesiologo_id ? Number(form.anestesiologo_id) : null,
        observaciones: form.observaciones || null,
      });
      setShow(false);
      setForm(blankCirugia);
      load();
    } catch (e: any) { alert(e.message); }
  };

  const asociar = async (id: number) => {
    const pid = prompt("ID del paciente:");
    if (!pid) return;
    await api.post(`/api/quirofano/cirugias/${id}/asociar-paciente`, { paciente_id: Number(pid) });
    load();
  };

  const cambiarEstado = async (id: number) => {
    const estado = prompt("Estado (programada/en_curso/realizada/suspendida/cancelada):");
    if (!estado) return;
    try {
      await api.post(`/api/quirofano/cirugias/${id}/estado`, { estado });
    } catch (e: any) {
      alert(e.message);
    }
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Quirofano</h1>
        <div className="flex gap-2 items-center">
          <div className="flex border rounded overflow-hidden">
            <button className={`px-3 py-1 text-sm ${vista === "calendario" ? "bg-blue-600 text-white" : "bg-white"}`} onClick={() => setVista("calendario")}>Calendario</button>
            <button className={`px-3 py-1 text-sm ${vista === "tabla" ? "bg-blue-600 text-white" : "bg-white"}`} onClick={() => setVista("tabla")}>Tabla</button>
          </div>
          {vista === "calendario" && (
            <div className="flex gap-1 items-center">
              <button className="btn-secondary text-xs" onClick={() => { const d = new Date(semanaBase); d.setDate(d.getDate() - 7); setSemanaBase(d); }}>&laquo;</button>
              <span className="text-xs px-2">{fmtDia(dias[0])} a {fmtDia(dias[6])}</span>
              <button className="btn-secondary text-xs" onClick={() => { const d = new Date(semanaBase); d.setDate(d.getDate() + 7); setSemanaBase(d); }}>&raquo;</button>
            </div>
          )}
          <button className="btn" onClick={() => setShow(true)}>Programar cirugia</button>
        </div>
      </div>

      {vista === "calendario" && (
        <div className="card overflow-auto">
          <div className="grid grid-cols-8 gap-1 min-w-[800px]">
            <div className="text-xs font-semibold p-2">Quirofano</div>
            {dias.map((d) => (
              <div key={d.toISOString()} className="text-xs font-semibold p-2 text-center bg-slate-100">
                {["L", "M", "Mi", "J", "V", "S", "D"][((d.getDay() + 6) % 7)]} {d.getDate()}/{d.getMonth() + 1}
              </div>
            ))}
            {quirofanos.map((q) => (
              <FragmentRow key={q.id} q={q} dias={dias} cirugias={cirugias} estadoColor={estadoColor} onClick={abrirConsumos} />
            ))}
          </div>
        </div>
      )}

      {vista === "tabla" && (
      <div className="card overflow-auto">
        <table className="table">
          <thead>
            <tr><th>Codigo</th><th>Inicio</th><th>Fin</th><th>Quirofano</th><th>Paciente</th><th>Tipo</th><th>Equipo medico</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {cirugias.map((c) => (
              <tr key={c.id}>
                <td>{c.codigo}</td>
                <td className="text-xs whitespace-nowrap">{c.inicio_at ? c.inicio_at.replace("T", " ") : (c.fecha_programada + " " + (c.hora_inicio ?? "-"))}</td>
                <td className="text-xs whitespace-nowrap">{c.fin_at ? c.fin_at.replace("T", " ") : (c.fecha_programada + " " + (c.hora_fin ?? "-"))}</td>
                <td>{c.quirofano}</td>
                <td>{c.paciente_nombre ?? <span className="text-orange-600">SIN ASOCIAR</span>}</td>
                <td>{c.tipo_cirugia ?? "-"}</td>
                <td className="text-xs">
                  {c.cirujano_nombre && <div><span className="text-slate-500">Cirujano:</span> {c.cirujano_nombre}</div>}
                  {c.ayudante_nombre && <div><span className="text-slate-500">Ayudante:</span> {c.ayudante_nombre}</div>}
                  {c.anestesiologo_nombre && <div><span className="text-slate-500">Anest.:</span> {c.anestesiologo_nombre}</div>}
                </td>
                <td>{c.estado}</td>
                <td className="space-x-1">
                  {!c.paciente_id && <button className="btn-secondary text-xs" onClick={() => asociar(c.id)}>Asociar</button>}
                  <button className="btn-secondary text-xs" onClick={() => abrirConsumos(c)}>Consumos</button>
                  <button className="btn-secondary text-xs" onClick={() => cambiarEstado(c.id)}>Estado</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {consumosCir && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-3xl space-y-3 max-h-[90vh] overflow-auto">
            <div className="flex justify-between">
              <h2 className="font-semibold">Consumos - {consumosCir.cirugia.codigo}</h2>
              <button className="btn-secondary" onClick={() => setConsumosCir(null)}>Cerrar</button>
            </div>
            <div className="grid grid-cols-12 gap-2">
              <select className="input col-span-5" value={cForm.producto_id} onChange={(e) => setCForm({ ...cForm, producto_id: e.target.value })}>
                <option value="">-- Producto --</option>
                {prods.map((p) => <option key={p.id} value={p.id}>{p.codigo} - {p.nombre}</option>)}
              </select>
              <select className="input col-span-4" value={cForm.area_id} onChange={(e) => setCForm({ ...cForm, area_id: e.target.value })}>
                <option value="">-- Area stock --</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
              <input className="input col-span-2" type="number" placeholder="Cant" value={cForm.cantidad} onChange={(e) => setCForm({ ...cForm, cantidad: e.target.value })} />
              <button className="btn col-span-1" onClick={regCons}>+</button>
            </div>
            <table className="table">
              <thead><tr><th>Producto</th><th>Lote</th><th>Cant</th><th>Costo</th><th>Facturado</th></tr></thead>
              <tbody>
                {consumosCir.lista.map((c) => (
                  <tr key={c.id}>
                    <td>{c.producto}</td>
                    <td>{c.numero_lote ?? "-"}</td>
                    <td>{c.cantidad}</td>
                    <td>{Number(c.costo_unitario_snapshot).toFixed(4)}</td>
                    <td>{c.consumo_id ? "Si" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500">
              Al marcar la cirugia como "realizada" los consumos se vuelcan automaticamente al episodio del paciente para facturacion.
            </p>
          </div>
        </div>
      )}

      {show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-xl space-y-3 max-h-[90vh] overflow-auto">
            <h2 className="font-semibold text-lg">Programar cirugia</h2>

            <div>
              <label className="text-xs font-medium text-slate-700">Quirofano *</label>
              <select className="input" value={form.quirofano_id} onChange={(e) => setForm({ ...form, quirofano_id: e.target.value })}>
                <option value="">-- Seleccionar --</option>
                {quirofanos.map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-slate-700">Inicio (fecha y hora, 24h) *</label>
                <input className="input" type="datetime-local" step="60" value={form.inicio_at} onChange={(e) => setForm({ ...form, inicio_at: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Fin (fecha y hora, 24h) *</label>
                <input className="input" type="datetime-local" step="60" value={form.fin_at} onChange={(e) => setForm({ ...form, fin_at: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-slate-500 -mt-2">Soporta cirugias que cruzan medianoche (ej. inicio 23:00 - fin 02:00 del dia siguiente).</p>

            <div>
              <label className="text-xs font-medium text-slate-700">Paciente (de la lista de pacientes registrados)</label>
              <select className="input" value={form.paciente_id} onChange={(e) => setForm({ ...form, paciente_id: e.target.value })}>
                <option value="">-- Sin asignar (asociar despues) --</option>
                {pacientes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.expediente} - {p.nombres} {p.apellidos}
                    {p.documento_numero ? ` (${p.documento_numero})` : ""}
                  </option>
                ))}
              </select>
            </div>
            {!form.paciente_id && (
              <input className="input" placeholder="O nombre temporal si aun no esta registrado" value={form.paciente_pendiente_nombre} onChange={(e) => setForm({ ...form, paciente_pendiente_nombre: e.target.value })} />
            )}

            <div>
              <label className="text-xs font-medium text-slate-700">Tipo de cirugia</label>
              <input className="input" placeholder="ej. Apendicectomia" value={form.tipo_cirugia} onChange={(e) => setForm({ ...form, tipo_cirugia: e.target.value })} />
            </div>

            <div className="pt-2 border-t">
              <h3 className="text-sm font-semibold mb-2">Equipo medico</h3>

              <div>
                <label className="text-xs font-medium text-slate-700">Cirujano *</label>
                <select className="input" value={form.medico_principal_id} onChange={(e) => setForm({ ...form, medico_principal_id: e.target.value })}>
                  <option value="">-- Seleccionar cirujano --</option>
                  {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombres} {m.apellidos}{m.especialidad ? ` - ${m.especialidad}` : ""}</option>)}
                </select>
              </div>

              <div className="mt-2">
                <label className="text-xs font-medium text-slate-700">Ayudante (opcional)</label>
                <select className="input" value={form.cirujano_ayudante_id} onChange={(e) => setForm({ ...form, cirujano_ayudante_id: e.target.value })}>
                  <option value="">-- Sin ayudante --</option>
                  {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombres} {m.apellidos}{m.especialidad ? ` - ${m.especialidad}` : ""}</option>)}
                </select>
              </div>

              <div className="mt-2">
                <label className="text-xs font-medium text-slate-700">Anestesiologo (opcional)</label>
                <select className="input" value={form.anestesiologo_id} onChange={(e) => setForm({ ...form, anestesiologo_id: e.target.value })}>
                  <option value="">-- Sin anestesiologo --</option>
                  {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombres} {m.apellidos}{m.especialidad ? ` - ${m.especialidad}` : ""}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Observaciones</label>
              <textarea className="input" value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => { setShow(false); setForm(blankCirugia); }}>Cancelar</button>
              <button className="btn" onClick={submit}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
