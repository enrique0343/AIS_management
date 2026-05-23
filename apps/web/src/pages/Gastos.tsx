import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Cat = { id: number; nombre: string };
type Gasto = { id: number; fecha: string; categoria: string; proveedor: string | null; descripcion: string; monto: number; doc_r2_key: string | null; usuario: string | null };

export default function Gastos() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [items, setItems] = useState<Gasto[]>([]);
  const [desde, setDesde] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<any>({ fecha: new Date().toISOString().slice(0, 10), categoria_id: "", proveedor: "", descripcion: "", monto: 0 });
  const [soporte, setSoporte] = useState<File | null>(null);

  const load = () => api.get<{ data: Gasto[] }>(`/api/gastos?desde=${desde}&hasta=${hasta}`).then((r) => setItems(r.data));
  useEffect(() => {
    api.get<{ data: Cat[] }>("/api/gastos/categorias").then((r) => setCats(r.data));
  }, []);
  useEffect(() => { load(); }, [desde, hasta]);

  const submit = async () => {
    if (!form.categoria_id || !form.descripcion || !form.monto) { alert("Categoria, descripcion y monto requeridos"); return; }
    try {
      const r = await api.post<{ id: number }>("/api/gastos", {
        ...form, categoria_id: Number(form.categoria_id), monto: Number(form.monto),
      });
      if (soporte) {
        const fd = new FormData();
        fd.append("file", soporte);
        await fetch(`/api/gastos/${r.id}/soporte`, { method: "POST", body: fd, credentials: "include" });
      }
      setShow(false);
      setForm({ fecha: new Date().toISOString().slice(0, 10), categoria_id: "", proveedor: "", descripcion: "", monto: 0 });
      setSoporte(null);
      load();
    } catch (e: any) { alert(e.message); }
  };

  const total = items.reduce((s, g) => s + Number(g.monto), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Gastos operativos</h1>
        <div className="flex gap-2 items-end">
          <div><label className="text-xs">Desde</label><input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div><label className="text-xs">Hasta</label><input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          <button className="btn" onClick={() => setShow(true)}>Nuevo gasto</button>
        </div>
      </div>
      <div className="card">
        <div className="text-sm mb-2">Total del periodo: <span className="text-lg font-semibold">${total.toFixed(2)}</span></div>
        <table className="table">
          <thead><tr><th>Fecha</th><th>Categoria</th><th>Descripcion</th><th>Proveedor</th><th>Monto</th><th>Soporte</th><th>Usuario</th></tr></thead>
          <tbody>
            {items.map((g) => (
              <tr key={g.id}>
                <td>{g.fecha}</td>
                <td>{g.categoria}</td>
                <td>{g.descripcion}</td>
                <td>{g.proveedor ?? "-"}</td>
                <td className="font-medium">${Number(g.monto).toFixed(2)}</td>
                <td>{g.doc_r2_key ? <a className="text-blue-600 text-xs hover:underline" href={`/api/gastos/${g.id}/soporte`} target="_blank" rel="noreferrer">Ver</a> : "-"}</td>
                <td className="text-xs">{g.usuario ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-md space-y-3">
            <h2 className="font-semibold">Nuevo gasto</h2>
            <input className="input" type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
            <select className="input" value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}>
              <option value="">-- Categoria --</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input className="input" placeholder="Descripcion" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
            <input className="input" placeholder="Proveedor (opcional)" value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value })} />
            <input className="input" type="number" step="0.01" placeholder="Monto" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
            <div>
              <label className="text-xs">Soporte (recibo/factura, PDF o imagen, max 10MB)</label>
              <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setSoporte(e.target.files?.[0] ?? null)} />
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
