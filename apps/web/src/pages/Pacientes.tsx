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
};

export default function Pacientes() {
  const [items, setItems] = useState<Pac[]>([]);
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<any>({ nombres: "", apellidos: "", documento_tipo: "dui", documento_numero: "", sexo: "M" });

  const load = () => api.get<{ data: Pac[] }>(`/api/pacientes${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => setItems(r.data));

  useEffect(() => { load(); }, []);

  const submit = async () => {
    await api.post("/api/pacientes", form);
    setShow(false);
    setForm({ nombres: "", apellidos: "", documento_tipo: "dui", documento_numero: "", sexo: "M" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pacientes</h1>
        <div className="flex gap-2">
          <input className="input w-64" placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-secondary" onClick={load}>Buscar</button>
          <button className="btn" onClick={() => setShow(true)}>Nuevo</button>
        </div>
      </div>
      <div className="card overflow-auto">
        <table className="table">
          <thead><tr><th>Expediente</th><th>Nombres</th><th>Apellidos</th><th>Documento</th><th>Telefono</th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{p.expediente}</td>
                <td>{p.nombres}</td>
                <td>{p.apellidos}</td>
                <td>{p.documento_tipo}: {p.documento_numero ?? "-"}</td>
                <td>{p.telefono ?? "-"}</td>
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
    </div>
  );
}
