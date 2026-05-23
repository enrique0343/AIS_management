import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type Producto = {
  id: number;
  codigo: string;
  nombre: string;
  principio_activo: string | null;
  registro_sanitario: string | null;
  es_controlado: number;
  categoria: string;
  unidad: string;
  precio_venta: number;
  costo_promedio_ponderado: number;
  punto_reorden: number;
  existencia_total: number;
  requiere_lote_vencimiento: number;
};

type Cat = { id: number; nombre: string; prefijo: string; requiere_lote_vencimiento: number; es_servicio: number };
type Unidad = { id: number; nombre: string; abreviatura: string };

type SrsEntry = {
  id: number;
  registro_sanitario: string;
  nombre_comercial: string;
  principio_activo: string | null;
  concentracion: string | null;
  forma_farmaceutica: string | null;
  fabricante: string | null;
  pvmp: number | null;
};

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
    unidad_compra_id: "",
    factor_conversion: 1,
    registro_sanitario: "",
    es_controlado: false,
    requiere_receta_especial: false,
    precio_venta: "" as string | number,
    punto_reorden: 0,
    pvmp_srs: null as number | null,
  };
  const [form, setForm] = useState<any>(blankForm);

  // SRS search state
  const [srsQ, setSrsQ] = useState("");
  const [srsResults, setSrsResults] = useState<SrsEntry[]>([]);
  const [srsLoading, setSrsLoading] = useState(false);
  const [srsSelected, setSrsSelected] = useState<SrsEntry | null>(null);
  const srsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () =>
    api.get<{ data: Producto[] }>(`/api/productos${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) =>
      setItems(r.data)
    );

  useEffect(() => {
    load();
    api.get<{ data: Cat[] }>("/api/catalogos/categorias").then((r) => setCats(r.data));
    api.get<{ data: Unidad[] }>("/api/catalogos/unidades-medida").then((r) => setUnidades(r.data));
  }, []);

  const onSrsSearch = (val: string) => {
    setSrsQ(val);
    if (srsTimer.current) clearTimeout(srsTimer.current);
    if (val.length < 2) { setSrsResults([]); return; }
    srsTimer.current = setTimeout(async () => {
      setSrsLoading(true);
      try {
        const r = await api.get<{ data: SrsEntry[] }>(`/api/catalogos/srs?q=${encodeURIComponent(val)}`);
        setSrsResults(r.data);
      } finally {
        setSrsLoading(false);
      }
    }, 300);
  };

  const onSrsSelect = async (entry: SrsEntry) => {
    setSrsSelected(entry);
    setSrsQ(entry.nombre_comercial);
    setSrsResults([]);

    const factor = Number(form.factor_conversion) > 1 ? Number(form.factor_conversion) : 1;
    const precioVenta = entry.pvmp !== null ? Math.round((entry.pvmp / factor) * 100) / 100 : "";

    setForm((f: any) => ({
      ...f,
      nombre: entry.nombre_comercial.trim(),
      principio_activo: entry.principio_activo ?? "",
      registro_sanitario: entry.registro_sanitario,
      pvmp_srs: entry.pvmp,
      precio_venta: precioVenta,
    }));

    // Buscar o crear laboratorio si hay fabricante
    if (entry.fabricante) {
      try {
        const labs = await api.get<{ data: { id: number; nombre: string }[] }>("/api/catalogos/laboratorios");
        const match = labs.data.find(
          (l) => l.nombre.toLowerCase() === entry.fabricante!.toLowerCase()
        );
        if (match) {
          setForm((f: any) => ({ ...f, laboratorio_id: String(match.id) }));
        }
      } catch {}
    }
  };

  const recalcPrecioSrs = (factor: number) => {
    if (srsSelected?.pvmp !== null && srsSelected?.pvmp !== undefined) {
      const f = factor > 0 ? factor : 1;
      const precio = Math.round((srsSelected.pvmp / f) * 100) / 100;
      setForm((prev: any) => ({ ...prev, precio_venta: precio, factor_conversion: f }));
    }
  };

  const submit = async () => {
    const factor = Number(form.factor_conversion) || 1;
    const precio = Number(form.precio_venta);

    if (!form.pvmp_srs && precio <= 0) {
      alert("El precio de venta es obligatorio cuando el producto no tiene PVMP regulado del SRS.");
      return;
    }

    const payload = {
      ...form,
      categoria_id: Number(form.categoria_id),
      unidad_medida_id: Number(form.unidad_medida_id),
      unidad_compra_id: form.unidad_compra_id ? Number(form.unidad_compra_id) : null,
      factor_conversion: factor,
      precio_venta: precio,
      punto_reorden: Number(form.punto_reorden),
      pvmp_srs: form.pvmp_srs ?? null,
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
      setSrsQ("");
      setSrsSelected(null);
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
    setSrsSelected(null);
    setSrsQ("");
    setForm({
      codigo: prod.codigo,
      nombre: prod.nombre,
      principio_activo: prod.principio_activo ?? "",
      categoria_id: String(prod.categoria_id),
      unidad_medida_id: String(prod.unidad_medida_id),
      unidad_compra_id: prod.unidad_compra_id ? String(prod.unidad_compra_id) : "",
      factor_conversion: prod.factor_conversion ?? 1,
      registro_sanitario: prod.registro_sanitario ?? "",
      es_controlado: !!prod.es_controlado,
      requiere_receta_especial: !!prod.requiere_receta_especial,
      precio_venta: prod.precio_venta,
      punto_reorden: prod.punto_reorden,
      pvmp_srs: prod.pvmp_srs ?? null,
    });
    setEditId(p.id);
    setShow(true);
  };

  const factor = Number(form.factor_conversion) || 1;
  const tieneConversion = factor > 1 && form.unidad_compra_id;
  const pvmpReguladoPorunidad = srsSelected?.pvmp !== null && srsSelected?.pvmp !== undefined && tieneConversion
    ? Math.round((srsSelected.pvmp / factor) * 100) / 100
    : null;
  const precioEsRegulado = !!form.pvmp_srs && factor === 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Productos</h1>
        <div className="flex gap-2">
          <input className="input w-64" placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-secondary" onClick={load}>Buscar</button>
          <button className="btn" onClick={() => { setEditId(null); setForm(blankForm); setSrsQ(""); setSrsSelected(null); setShow(true); }}>Nuevo</button>
        </div>
      </div>
      <div className="card overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Codigo</th><th>Nombre</th><th>Reg. Sanitario</th><th>Categoria</th><th>Unidad venta</th>
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
                <td className="font-mono text-xs text-slate-600">{p.registro_sanitario ?? "—"}</td>
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 overflow-y-auto py-4">
          <div className="card w-full max-w-lg space-y-3 my-auto">
            <h2 className="font-semibold">{editId ? "Editar producto" : "Nuevo producto"}</h2>

            {/* Buscador SRS */}
            {!editId && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 space-y-2">
                <label className="text-xs font-semibold text-blue-800 block">Buscar en catalogo SRS (opcional)</label>
                <div className="relative">
                  <input
                    className="input w-full"
                    placeholder="Nombre, principio activo o registro sanitario..."
                    value={srsQ}
                    onChange={(e) => onSrsSearch(e.target.value)}
                  />
                  {srsLoading && <span className="absolute right-2 top-2 text-xs text-slate-400">Buscando...</span>}
                  {srsResults.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border rounded shadow-lg max-h-52 overflow-y-auto mt-1">
                      {srsResults.map((e) => (
                        <button
                          key={e.id}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b last:border-0"
                          onClick={() => onSrsSelect(e)}
                        >
                          <div className="text-sm font-medium">{e.nombre_comercial.trim()}</div>
                          <div className="text-xs text-slate-500">
                            {e.principio_activo && <span>{e.principio_activo}</span>}
                            {e.concentracion && <span> · {e.concentracion}</span>}
                            {e.pvmp !== null ? (
                              <span className="ml-1 text-green-700 font-medium">PVMP: ${e.pvmp.toFixed(2)}</span>
                            ) : (
                              <span className="ml-1 text-amber-600">Sin PVMP</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {srsSelected && (
                  <div className="text-xs text-blue-700 bg-blue-100 rounded px-2 py-1">
                    Seleccionado: <strong>{srsSelected.nombre_comercial.trim()}</strong>
                    {srsSelected.pvmp !== null
                      ? ` · PVMP $${srsSelected.pvmp.toFixed(2)} por presentacion`
                      : " · Sin precio regulado (PVMP)"}
                  </div>
                )}
              </div>
            )}

            <select className="input" value={form.categoria_id} onChange={(e) => onChangeCategoria(e.target.value)}>
              <option value="">-- Categoria --</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.nombre} [{c.prefijo}]{c.requiere_lote_vencimiento ? " (lote)" : ""}</option>)}
            </select>
            <input className="input font-mono" placeholder="Codigo (autosugerido)" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })} />
            <p className="text-xs text-slate-500 -mt-2">El codigo debe iniciar con el prefijo de la categoria seleccionada.</p>
            <input className="input" placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            <input className="input" placeholder="Principio activo" value={form.principio_activo} onChange={(e) => setForm({ ...form, principio_activo: e.target.value })} />
            <div>
              <label className="text-xs font-medium text-slate-700">Registro sanitario</label>
              <input className="input font-mono" placeholder="Ej: F035608072009" value={form.registro_sanitario} onChange={(e) => setForm({ ...form, registro_sanitario: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.es_controlado} onChange={(e) => setForm({ ...form, es_controlado: e.target.checked, requiere_receta_especial: e.target.checked })} />
              Producto controlado (SRS)
            </label>

            {/* Unidades */}
            <div className="pt-2 border-t space-y-2">
              <h3 className="text-sm font-semibold">Unidades de medida</h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-700">Unidad de venta *</label>
                  <select className="input" value={form.unidad_medida_id} onChange={(e) => setForm({ ...form, unidad_medida_id: e.target.value })}>
                    <option value="">-- Como se vende --</option>
                    {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({u.abreviatura})</option>)}
                  </select>
                  <p className="text-xs text-slate-500">Como se dispensa al paciente.</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Unidad de compra</label>
                  <select className="input" value={form.unidad_compra_id}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm({ ...form, unidad_compra_id: val, factor_conversion: val ? form.factor_conversion : 1 });
                    }}>
                    <option value="">Misma que venta</option>
                    {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({u.abreviatura})</option>)}
                  </select>
                  <p className="text-xs text-slate-500">Como llega del proveedor.</p>
                </div>
              </div>
              {form.unidad_compra_id && (
                <div>
                  <label className="text-xs font-medium text-slate-700">
                    Factor de conversion (unidades de venta por unidad de compra)
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.001"
                    min="0.001"
                    placeholder="Ej: 30"
                    value={form.factor_conversion}
                    onChange={(e) => {
                      const f = parseFloat(e.target.value) || 1;
                      recalcPrecioSrs(f);
                    }}
                  />
                  {form.unidad_compra_id && form.unidad_medida_id && (
                    <p className="text-xs text-slate-500">
                      1 {unidades.find((u) => String(u.id) === String(form.unidad_compra_id))?.nombre ?? "unidad de compra"} = {form.factor_conversion} {unidades.find((u) => String(u.id) === String(form.unidad_medida_id))?.abreviatura ?? "u.venta"}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Costos y precio */}
            <div className="pt-2 border-t space-y-2">
              <h3 className="text-sm font-semibold">Costos y precio</h3>
              <div className="bg-slate-50 rounded p-2">
                <label className="text-xs font-medium text-slate-700">Costo unitario (CPP) - automatico</label>
                <input className="input bg-white" type="text" disabled value="Se calcula automaticamente al recibir compras" />
                <p className="text-xs text-slate-500 mt-1">
                  El costo se mantiene como promedio ponderado por unidad de venta.
                  {tieneConversion && " Al recibir, se divide el costo de compra entre el factor de conversion."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-700 flex items-center gap-1">
                    Precio de venta ($) *
                    {form.pvmp_srs && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-1 rounded font-normal">
                        {tieneConversion ? "PVMP/factor" : "PVMP regulado"}
                      </span>
                    )}
                  </label>
                  {form.pvmp_srs !== null && form.pvmp_srs !== undefined ? (
                    <>
                      <input
                        className={`input ${precioEsRegulado ? "bg-blue-50 text-blue-900" : ""}`}
                        type="number"
                        step="0.01"
                        min="0.01"
                        readOnly={precioEsRegulado}
                        value={form.precio_venta}
                        onChange={(e) => !precioEsRegulado && setForm({ ...form, precio_venta: e.target.value })}
                      />
                      <p className="text-xs text-blue-600">
                        {tieneConversion
                          ? `PVMP $${form.pvmp_srs.toFixed(2)} / factor ${factor} = $${pvmpReguladoPorunidad?.toFixed(2)} por ${unidades.find((u) => String(u.id) === String(form.unidad_medida_id))?.abreviatura ?? "u.venta"}`
                          : `Precio maximo regulado por SRS: $${form.pvmp_srs.toFixed(2)}`}
                      </p>
                    </>
                  ) : (
                    <>
                      <input
                        className={`input ${!form.pvmp_srs && srsSelected ? "border-amber-400 bg-amber-50" : ""}`}
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={form.precio_venta}
                        onChange={(e) => setForm({ ...form, precio_venta: e.target.value })}
                      />
                      {srsSelected && !form.pvmp_srs && (
                        <p className="text-xs text-amber-700">Este medicamento no tiene precio regulado. Ingrese el precio por {unidades.find((u) => String(u.id) === String(form.unidad_medida_id))?.abreviatura ?? "unidad de venta"}.</p>
                      )}
                      {!srsSelected && (
                        <p className="text-xs text-slate-500">Lo que se cobra al paciente por unidad de venta.</p>
                      )}
                    </>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Punto de reorden</label>
                  <input className="input" type="number" step="0.01" min="0" value={form.punto_reorden} onChange={(e) => setForm({ ...form, punto_reorden: e.target.value })} />
                  <p className="text-xs text-slate-500">Stock minimo antes de sugerir OC.</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setShow(false); setEditId(null); setSrsQ(""); setSrsSelected(null); }}>Cancelar</button>
              <button className="btn" onClick={submit}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
