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
  const [editId, setEditId] = useState<number | null>(null);
  const blankForm = {
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
  };
  const [form, setForm] = useState<any>(blankForm);

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
    const payload = {
      ...form,
      categoria_id: Number(form.categoria_id),
      unidad_medida_id: Number(form.unidad_medida_id),
      precio_venta: Number(form.precio_venta),
      punto_reorden: Number(form.punto_reorden),
    };
    try {
      if (editId) {
        await api.put(`/api/productos/${editId}`, payload);
      } else {
        await api.post("/api/productos", payload);
      }
      setShow(false);
      setEditId(null);
      setForm(blankForm);
      load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const onChangeCategoria = async (catId: string) => {
    setForm((f: any) => ({ ...f, categoria_id: catId }));
    if (catId && !editId) {
      try {
        const r = await api.get<{ siguiente: string }>(`/api/productos/_siguiente-codigo?categoria_id=${catId}`);
        setForm((f: any) => ({ ...f, codigo: r.siguiente }));
      } catch {}
    }
  };

  const editar = async (p: Producto) => {
    const r = await api.get<{ producto: any }>(`/api/productos/${p.id}`);
    const prod = r.producto;
    setForm({
      codigo: prod.codigo,
      nombre: prod.nombre,
      principio_activo: prod.principio_activo ?? "",
      categoria_id: String(prod.categoria_id),
      unidad_medida_id: String(prod.unidad_medida_id),
      registro_sanitario: prod.registro_sanitario ?? "",
      es_controlado: !!prod.es_controlado,
      requiere_receta_especial: !!prod.requiere_receta_especial,
      precio_venta: prod.precio_venta,
      punto_reorden: prod.punto_reorden,
    });
    setEditId(p.id);
    setShow(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Productos</h1>
        <div className="flex gap-2">
          <input className="input w-64" placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-secondary" onClick={load}>Buscar</button>
          <button className="btn" onClick={() => { setEditId(null); setForm(blankForm); setShow(true); }}>Nuevo</button>
        </div>
      </div>
      <div className="card overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Codigo</th><th>Nombre</th><th>Categoria</th><th>Unidad</th>
              <th>CPP</th><th>Precio</th><th>Stock</th><th>Reorden</th><th>Ctrl</th><th></th>
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
                <td><button className="btn-secondary text-xs" onClick={() => editar(p)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-lg space-y-3">
            <h2 className="font-semibold">{editId ? "Editar producto" : "Nuevo producto"}</h2>
            <select className="input" value={form.categoria_id} onChange={(e) => onChangeCategoria(e.target.value)}>
              <option value="">-- Categoria --</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.nombre} [{(c as any).prefijo}]{c.requiere_lote_vencimiento ? " (lote)" : ""}</option>)}
            </select>
            <input className="input font-mono" placeholder="Codigo (autosugerido)" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })} />
            <p className="text-xs text-slate-500 -mt-2">El codigo debe iniciar con el prefijo de la categoria seleccionada.</p>
            <input className="input" placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            <input className="input" placeholder="Principio activo" value={form.principio_activo} onChange={(e) => setForm({ ...form, principio_activo: e.target.value })} />
            <select className="input" value={form.unidad_medida_id} onChange={(e) => setForm({ ...form, unidad_medida_id: e.target.value })}>
              <option value="">-- Unidad --</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({u.abreviatura})</option>)}
            </select>
            <input className="input" placeholder="Registro sanitario" value={form.registro_sanitario} onChange={(e) => setForm({ ...form, registro_sanitario: e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.es_controlado} onChange={(e) => setForm({ ...form, es_controlado: e.target.checked, requiere_receta_especial: e.target.checked })} />
              Producto controlado (SRS)
            </label>

            <div className="pt-2 border-t">
              <h3 className="text-sm font-semibold mb-2">Costos y precio</h3>

              <div className="bg-slate-50 rounded p-2 mb-2">
                <label className="text-xs font-medium text-slate-700">Costo unitario (CPP) - automatico</label>
                <input className="input bg-white" type="text" disabled value="Se calcula automaticamente al recibir compras" />
                <p className="text-xs text-slate-500 mt-1">
                  El costo se mantiene como promedio ponderado de las compras recibidas
                  (no se ingresa manualmente).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-700">Precio de venta ($) *</label>
                  <input className="input" type="number" step="0.01" min="0" value={form.precio_venta} onChange={(e) => setForm({ ...form, precio_venta: e.target.value })} />
                  <p className="text-xs text-slate-500">Lo que se cobra al paciente.</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Punto de reorden</label>
                  <input className="input" type="number" step="0.01" min="0" value={form.punto_reorden} onChange={(e) => setForm({ ...form, punto_reorden: e.target.value })} />
                  <p className="text-xs text-slate-500">Stock minimo antes de sugerir OC.</p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setShow(false); setEditId(null); }}>Cancelar</button>
              <button className="btn" onClick={submit}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
