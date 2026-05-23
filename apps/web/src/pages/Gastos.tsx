import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type Cat = { id: number; nombre: string };
type Prov = { id: number; nombre: string };
type Gasto = { id: number; fecha: string; categoria: string; proveedor: string | null; descripcion: string; monto: number; doc_r2_key: string | null; usuario: string | null };

export default function Gastos() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [proveedores, setProveedores] = useState<Prov[]>([]);
  const [items, setItems] = useState<Gasto[]>([]);
  const [desde, setDesde] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<any>({ fecha: new Date().toISOString().slice(0, 10), categoria_id: "", proveedor: "", descripcion: "", monto: "" });
  const [soporte, setSoporte] = useState<File | null>(null);

  // Proveedor combobox state
  const [provSearch, setProvSearch] = useState("");
  const [provOpen, setProvOpen] = useState(false);
  const [provCreando, setProvCreando] = useState(false);
  const provRef = useRef<HTMLDivElement>(null);

  const loadProveedores = () =>
    api.get<{ data: Prov[] }>("/api/gastos/proveedores").then((r) => setProveedores(r.data));

  const load = () => api.get<{ data: Gasto[] }>(`/api/gastos?desde=${desde}&hasta=${hasta}`).then((r) => setItems(r.data));

  useEffect(() => {
    api.get<{ data: Cat[] }>("/api/gastos/categorias").then((r) => setCats(r.data));
    loadProveedores();
  }, []);
  useEffect(() => { load(); }, [desde, hasta]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (provRef.current && !provRef.current.contains(e.target as Node)) setProvOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtProveedores = proveedores.filter((p) =>
    p.nombre.toLowerCase().includes(provSearch.toLowerCase())
  );
  const exactMatch = proveedores.some((p) => p.nombre.toLowerCase() === provSearch.trim().toLowerCase());

  const selProv = (nombre: string) => {
    setProvSearch(nombre);
    setForm((f: any) => ({ ...f, proveedor: nombre }));
    setProvOpen(false);
  };

  const crearProveedor = async () => {
    const nombre = provSearch.trim();
    if (!nombre) return;
    setProvCreando(true);
    try {
      await api.post<{ id: number; nombre: string }>("/api/gastos/proveedores", { nombre });
      await loadProveedores();
      selProv(nombre);
    } catch { alert("Error al crear proveedor"); }
    setProvCreando(false);
  };

  const limpiarForm = () => {
    setForm({ fecha: new Date().toISOString().slice(0, 10), categoria_id: "", proveedor: "", descripcion: "", monto: "" });
    setProvSearch("");
    setProvOpen(false);
    setSoporte(null);
  };

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
      limpiarForm();
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md space-y-3">
            <h2 className="font-semibold">Nuevo gasto</h2>
            <input className="input" type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
            <select className="input" value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}>
              <option value="">-- Categoria --</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input className="input" placeholder="Descripcion" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />

            {/* Proveedor combobox */}
            <div className="relative" ref={provRef}>
              <label className="text-xs font-medium text-slate-600">Proveedor (opcional)</label>
              <input
                className="input mt-0.5"
                placeholder="Buscar o crear proveedor..."
                value={provSearch}
                onChange={(e) => {
                  setProvSearch(e.target.value);
                  setForm((f: any) => ({ ...f, proveedor: e.target.value }));
                  setProvOpen(true);
                }}
                onFocus={() => setProvOpen(true)}
                autoComplete="off"
              />
              {provSearch && (
                <button
                  type="button"
                  className="absolute right-2 top-8 text-slate-400 hover:text-slate-600 text-sm"
                  onClick={() => { setProvSearch(""); setForm((f: any) => ({ ...f, proveedor: "" })); setProvOpen(false); }}
                >
                  ✕
                </button>
              )}
              {provOpen && (filtProveedores.length > 0 || (provSearch.trim() && !exactMatch)) && (
                <div className="absolute z-20 w-full bg-white border border-slate-200 rounded-md shadow-lg mt-1 max-h-52 overflow-auto">
                  {filtProveedores.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      onMouseDown={(e) => { e.preventDefault(); selProv(p.nombre); }}
                    >
                      {p.nombre}
                    </button>
                  ))}
                  {provSearch.trim() && !exactMatch && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 border-t border-slate-100 font-medium"
                      onMouseDown={(e) => { e.preventDefault(); crearProveedor(); }}
                      disabled={provCreando}
                    >
                      {provCreando ? "Creando..." : `+ Crear "${provSearch.trim()}"`}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600">Monto ($)</label>
              <input className="input mt-0.5" type="number" step="0.01" min="0" placeholder="0.00" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
            </div>
            <div>
              <label className="text-xs">Soporte (recibo/factura, PDF o imagen, max 10MB)</label>
              <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setSoporte(e.target.files?.[0] ?? null)} />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setShow(false); limpiarForm(); }}>Cancelar</button>
              <button className="btn" onClick={submit}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
