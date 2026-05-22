import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Producto = {
  id: number;
  codigo: string;
  nombre: string;
  principio_activo: string | null;
  es_controlado: number;
  categoria: string;
  unidad: string;
  precio_venta: number;
  costo_promedio_ponderado: number;
  punto_reorden: number;
  existencia_total: number;
  requiere_lote_vencimiento: number;
};

type Cat = { id: number; nombre: string; requiere_lote_vencimiento: number; es_servicio: number };
type Unidad = { id: number; nombre: string; abreviatura: string };

export default function Productos() {
  const [items, setItems] = useState<Producto[]>([]);
  const [q, setQ] = useState("");
  const [cats, setCats] = useState<Cat[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<any>({
    codigo: "",
    nombre: "",
    principio_activo: "",
    categoria_id: "",
    unidad_medida_id: "",
    registro_sanitario: "",
    es_controlado: false,
    requiere_receta_especial: false,
    precio_venta: 0,
    punto_reorden: 0,
  });

  const load = () =>
    api.get<{ data: Producto[] }>(`/api/productos${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) =>
      setItems(r.data)
    );

  useEffect(() => {
    load();
    api.get<{ data: Cat[] }>("/api/catalogos/categorias").then((r) => setCats(r.data));
    api.get<{ data: Unidad[] }>("/api/catalogos/unidades-medida").then((r) => setUnidades(r.data));
  }, []);

  const submit = async () => {
    await api.post("/api/productos", {
      ...form,
      categoria_id: Number(form.categoria_id),
      unidad_medida_id: Number(form.unidad_medida_id),
      precio_venta: Number(form.precio_venta),
      punto_reorden: Number(form.punto_reorden),
    });
    setShow(false);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Productos</h1>
        <div className="flex gap-2">
          <input className="input w-64" placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-secondary" onClick={load}>Buscar</button>
          <button className="btn" onClick={() => setShow(true)}>Nuevo</button>
        </div>
      </div>
      <div className="card overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Codigo</th><th>Nombre</th><th>Categoria</th><th>Unidad</th>
              <th>CPP</th><th>Precio</th><th>Stock</th><th>Reorden</th><th>Ctrl</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className={p.es_controlado ? "bg-amber-50" : ""}>
                <td>{p.codigo}</td>
                <td>
                  <div>{p.nombre}</div>
                  {p.principio_activo && <div className="text-xs text-slate-500">{p.principio_activo}</div>}
                </td>
                <td>{p.categoria}</td>
                <td>{p.unidad}</td>
                <td>{Number(p.costo_promedio_ponderado).toFixed(4)}</td>
                <td>{Number(p.precio_venta).toFixed(2)}</td>
                <td>{p.existencia_total}</td>
                <td>{p.punto_reorden}</td>
                <td>{p.es_controlado ? "Si" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-lg space-y-3">
            <h2 className="font-semibold">Nuevo producto</h2>
            <input className="input" placeholder="Codigo" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
            <input className="input" placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            <input className="input" placeholder="Principio activo" value={form.principio_activo} onChange={(e) => setForm({ ...form, principio_activo: e.target.value })} />
            <select className="input" value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}>
              <option value="">-- Categoria --</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.requiere_lote_vencimiento ? " (lote)" : ""}</option>)}
            </select>
            <select className="input" value={form.unidad_medida_id} onChange={(e) => setForm({ ...form, unidad_medida_id: e.target.value })}>
              <option value="">-- Unidad --</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({u.abreviatura})</option>)}
            </select>
            <input className="input" placeholder="Registro sanitario" value={form.registro_sanitario} onChange={(e) => setForm({ ...form, registro_sanitario: e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.es_controlado} onChange={(e) => setForm({ ...form, es_controlado: e.target.checked, requiere_receta_especial: e.target.checked })} />
              Producto controlado (SRS)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" type="number" step="0.01" placeholder="Precio venta" value={form.precio_venta} onChange={(e) => setForm({ ...form, precio_venta: e.target.value })} />
              <input className="input" type="number" step="0.01" placeholder="Punto reorden" value={form.punto_reorden} onChange={(e) => setForm({ ...form, punto_reorden: e.target.value })} />
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
