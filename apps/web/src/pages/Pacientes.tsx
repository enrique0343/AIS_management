import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Pac = {
  id: number;
  expediente: string;
  nombres: string;
  apellidos: string;
  documento_tipo: string | null;
  documento_numero: string | null;
  telefono: string | null;
  fecha_nacimiento: string | null;
  sexo: string | null;
  direccion: string | null;
  alergias: string | null;
  observaciones: string | null;
};

type Episodio = { id: number; estado: string; fecha_inicio: string; fecha_fin: string | null; motivo: string | null };

export default function Pacientes() {
  const [items, setItems] = useState<Pac[]>([]);
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [detalle, setDetalle] = useState<{ paciente: Pac; episodios: Episodio[] } | null>(null);
  const [form, setForm] = useState<any>({ nombres: "", apellidos: "", documento_tipo: "dui", documento_numero: "", sexo: "M" });

  const load = () => api.get<{ data: Pac[] }>(`/api/pacientes${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => setItems(r.data));
  const abrir = async (id: number) => {
    const r = await api.get<{ paciente: Pac; episodios: Episodio[] }>(`/api/pacientes/${id}`);
    setDetalle(r);
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    await api.post("/api/pacientes", form);
    setShow(false);
    setForm({ nombres: "", apellidos: "", documento_tipo: "dui", documento_numero: "", sexo: "M" });
    load();
  };

  const cerrarEpisodio = async (epId: number) => {
    if (!confirm("Cerrar episodio? Despues podra facturarse.")) return;
    await api.post(`/api/pacientes/episodios/${epId}/cerrar`, {});
    if (detalle) abrir(detalle.paciente.id);
  };

  const abrirEpisodio = async () => {
    if (!detalle) return;
    const motivo = prompt("Motivo del episodio:") ?? "Atencion";
    await api.post(`/api/pacientes/${detalle.paciente.id}/episodios`, { motivo });
    abrir(detalle.paciente.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pacientes</h1>
        <div className="flex gap-2">
          <input className="input w-64" placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
          <button className="btn-secondary" onClick={load}>Buscar</button>
          <button className="btn" onClick={() => setShow(true)}>Nuevo</button>
        </div>
      </div>
      <div className="card overflow-auto">
        <table className="table">
          <thead><tr><th>Expediente</th><th>Nombres</th><th>Apellidos</th><th>Documento</th><th>Telefono</th><th></th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{p.expediente}</td>
                <td>{p.nombres}</td>
                <td>{p.apellidos}</td>
                <td>{p.documento_tipo}: {p.documento_numero ?? "-"}</td>
                <td>{p.telefono ?? "-"}</td>
                <td><button className="btn-secondary text-xs" onClick={() => abrir(p.id)}>Ver</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-md space-y-3">
            <h2 className="font-semibold">Nuevo paciente</h2>
            <input className="input" placeholder="Nombres" value={form.nombres} onChange={(e) => setForm({ ...form, nombres: e.target.value })} />
            <input className="input" placeholder="Apellidos" value={form.apellidos} onChange={(e) => setForm({ ...form, apellidos: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select className="input" value={form.documento_tipo} onChange={(e) => setForm({ ...form, documento_tipo: e.target.value })}>
                <option value="dui">DUI</option><option value="pasaporte">Pasaporte</option>
                <option value="residencia">Residencia</option><option value="menor">Menor</option>
              </select>
              <input className="input" placeholder="No. documento" value={form.documento_numero} onChange={(e) => setForm({ ...form, documento_numero: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" type="date" value={form.fecha_nacimiento ?? ""} onChange={(e) => setForm({ ...form, fecha_nacimiento: e.target.value })} />
              <select className="input" value={form.sexo} onChange={(e) => setForm({ ...form, sexo: e.target.value })}>
                <option value="M">M</option><option value="F">F</option><option value="O">O</option>
              </select>
            </div>
            <input className="input" placeholder="Telefono" value={form.telefono ?? ""} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
            <textarea className="input" placeholder="Alergias" value={form.alergias ?? ""} onChange={(e) => setForm({ ...form, alergias: e.target.value })} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShow(false)}>Cancelar</button>
              <button className="btn" onClick={submit}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {detalle && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-2xl space-y-3 max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="font-semibold text-lg">{detalle.paciente.nombres} {detalle.paciente.apellidos}</h2>
                <div className="text-sm text-slate-500">Expediente: {detalle.paciente.expediente}</div>
              </div>
              <button className="btn-secondary" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-slate-500">Documento:</span> {detalle.paciente.documento_tipo}: {detalle.paciente.documento_numero ?? "-"}</div>
              <div><span className="text-slate-500">Sexo:</span> {detalle.paciente.sexo ?? "-"}</div>
              <div><span className="text-slate-500">Nacimiento:</span> {detalle.paciente.fecha_nacimiento ?? "-"}</div>
              <div><span className="text-slate-500">Telefono:</span> {detalle.paciente.telefono ?? "-"}</div>
              {detalle.paciente.direccion && <div className="col-span-2"><span className="text-slate-500">Direccion:</span> {detalle.paciente.direccion}</div>}
              {detalle.paciente.alergias && <div className="col-span-2 text-red-700"><span className="text-slate-500">Alergias:</span> {detalle.paciente.alergias}</div>}
            </div>

            <div className="flex justify-between items-center pt-2 border-t">
              <h3 className="font-semibold">Episodios</h3>
              <button className="btn text-xs" onClick={abrirEpisodio}>+ Nuevo episodio</button>
            </div>
            {!detalle.episodios.length ? (
              <div className="text-sm text-slate-500">Sin episodios</div>
            ) : (
              <table className="table">
                <thead><tr><th>ID</th><th>Inicio</th><th>Fin</th><th>Motivo</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {detalle.episodios.map((e) => (
                    <tr key={e.id}>
                      <td>#{e.id}</td>
                      <td>{e.fecha_inicio}</td>
                      <td>{e.fecha_fin ?? "-"}</td>
                      <td>{e.motivo ?? "-"}</td>
                      <td><span className={e.estado === "activo" ? "text-blue-600 font-medium" : "text-slate-500"}>{e.estado}</span></td>
                      <td>{e.estado === "activo" && <button className="btn-danger text-xs" onClick={() => cerrarEpisodio(e.id)}>Cerrar</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
