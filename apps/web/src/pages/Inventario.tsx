import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Stock = {
  producto_id: number;
  codigo: string;
  nombre: string;
  es_controlado: number;
  area_id: number;
  area: string;
  lote_id: number | null;
  numero_lote: string | null;
  fecha_vencimiento: string | null;
  cantidad: number;
};

type Area = { id: number; nombre: string };
type Val = { producto_id: number; codigo: string; nombre: string; unidad: string; area: string; cantidad: number; cpp: number; valor: number };

type Op = "transferencia" | "descarte" | "ajuste";

export default function Inventario() {
  const [tab, setTab] = useState<"stock" | "valorizacion" | "movimientos">("stock");
  const [op, setOp] = useState<Op | null>(null);
  const [opForm, setOpForm] = useState<any>({});
  const [prods, setProds] = useState<any[]>([]);

  useEffect(() => {
    api.get<{ data: any[] }>("/api/productos").then((r) => setProds(r.data));
  }, []);

  const submitOp = async () => {
    try {
      if (op === "transferencia") {
        await api.post("/api/inventario/transferencias", {
          producto_id: Number(opForm.producto_id),
          area_origen_id: Number(opForm.area_origen_id),
          area_destino_id: Number(opForm.area_destino_id),
          cantidad: Number(opForm.cantidad),
          observaciones: opForm.observaciones || null,
        });
      } else if (op === "descarte") {
        await api.post("/api/inventario/descartes", {
          producto_id: Number(opForm.producto_id),
          area_id: Number(opForm.area_id),
          cantidad: Number(opForm.cantidad),
          motivo: opForm.motivo,
          observaciones: opForm.observaciones || null,
        });
      } else if (op === "ajuste") {
        const cant = Number(opForm.cantidad);
        const prod = prods.find((p) => p.id === Number(opForm.producto_id));
        const reqLote = prod?.requiere_lote_vencimiento === 1;
        const payload: any = {
          producto_id: Number(opForm.producto_id),
          area_id: Number(opForm.area_id),
          cantidad: cant,
          observaciones: opForm.observaciones,
        };
        if (reqLote) {
          if (opForm.lote_modo === "existente") {
            if (!opForm.lote_id) { alert("Seleccione el lote"); return; }
            payload.lote_id = Number(opForm.lote_id);
          } else if (opForm.lote_modo === "nuevo") {
            if (cant < 0) { alert("No se puede crear lote nuevo con cantidad negativa"); return; }
            if (!opForm.lote_numero || !opForm.fecha_vencimiento) {
              alert("Numero de lote y fecha de vencimiento requeridos"); return;
            }
            payload.lote_numero = opForm.lote_numero;
            payload.fecha_vencimiento = opForm.fecha_vencimiento;
          } else {
            alert("Esta categoria requiere lote/vencimiento. Selecciona lote existente o crea uno nuevo.");
            return;
          }
        }
        await api.post("/api/inventario/ajustes", payload);
      }
      setOp(null);
      setOpForm({});
      setLotesAjuste([]);
      if (tab === "stock") {
        const url = areaId ? `/api/inventario/stock?area_id=${areaId}` : "/api/inventario/stock";
        api.get<{ data: Stock[] }>(url).then((r) => setStock(r.data));
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Cargar lotes disponibles del producto en el area seleccionada para el ajuste
  const [lotesAjuste, setLotesAjuste] = useState<any[]>([]);
  useEffect(() => {
    if (op === "ajuste" && opForm.producto_id && opForm.area_id) {
      api.get<{ data: any[] }>(`/api/productos/${opForm.producto_id}/lotes-disponibles?area_id=${opForm.area_id}`)
        .then((r) => setLotesAjuste(r.data))
        .catch(() => setLotesAjuste([]));
    } else {
      setLotesAjuste([]);
    }
  }, [op, opForm.producto_id, opForm.area_id]);

  const productoSel = prods.find((p) => p.id === Number(opForm.producto_id));
  const ajusteRequiereLote = op === "ajuste" && productoSel?.requiere_lote_vencimiento === 1;
  const [stock, setStock] = useState<Stock[]>([]);
  const [val, setVal] = useState<{ data: Val[]; total: number }>({ data: [], total: 0 });
  const [movs, setMovs] = useState<any[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [areaId, setAreaId] = useState<string>("");

  useEffect(() => {
    api.get<{ data: Area[] }>("/api/catalogos/areas").then((r) => setAreas(r.data));
  }, []);

  useEffect(() => {
    if (tab === "stock") {
      const url = areaId ? `/api/inventario/stock?area_id=${areaId}` : "/api/inventario/stock";
      api.get<{ data: Stock[] }>(url).then((r) => setStock(r.data));
    } else if (tab === "valorizacion") {
      const url = areaId ? `/api/inventario/valorizacion?area_id=${areaId}` : "/api/inventario/valorizacion";
      api.get<{ data: Val[]; total: number }>(url).then(setVal);
    } else if (tab === "movimientos") {
      api.get<{ data: any[] }>("/api/inventario/movimientos").then((r) => setMovs(r.data));
    }
  }, [tab, areaId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Inventario</h1>
        <div className="flex gap-2 items-center">
          {(tab === "stock" || tab === "valorizacion") && (
            <select className="input w-48" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">Todas las areas</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          )}
          <button className="btn-secondary text-sm" onClick={() => { setOp("transferencia"); setOpForm({}); }}>Transferir</button>
          <button className="btn-secondary text-sm" onClick={() => { setOp("descarte"); setOpForm({ motivo: "vencido" }); }}>Descarte</button>
          <button className="btn-secondary text-sm" onClick={() => { setOp("ajuste"); setOpForm({}); }}>Ajuste</button>
        </div>
      </div>

      {op && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-md space-y-3 max-h-[90vh] overflow-auto">
            <h2 className="font-semibold capitalize">{op}</h2>

            <div>
              <label className="text-xs font-medium">Producto</label>
              <select className="input" value={opForm.producto_id ?? ""} onChange={(e) => setOpForm({ ...opForm, producto_id: e.target.value, lote_id: "", lote_modo: "" })}>
                <option value="">-- Seleccionar --</option>
                {prods.map((p) => <option key={p.id} value={p.id}>{p.codigo} - {p.nombre}</option>)}
              </select>
            </div>

            {op === "transferencia" ? (
              <>
                <div>
                  <label className="text-xs font-medium">Area origen</label>
                  <select className="input" value={opForm.area_origen_id ?? ""} onChange={(e) => setOpForm({ ...opForm, area_origen_id: e.target.value })}>
                    <option value="">-- Seleccionar --</option>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium">Area destino</label>
                  <select className="input" value={opForm.area_destino_id ?? ""} onChange={(e) => setOpForm({ ...opForm, area_destino_id: e.target.value })}>
                    <option value="">-- Seleccionar --</option>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <div>
                <label className="text-xs font-medium">Area</label>
                <select className="input" value={opForm.area_id ?? ""} onChange={(e) => setOpForm({ ...opForm, area_id: e.target.value, lote_id: "" })}>
                  <option value="">-- Seleccionar --</option>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs font-medium">{op === "ajuste" ? "Cantidad (+/-)" : "Cantidad"}</label>
              <input className="input" type="number" step="0.01" value={opForm.cantidad ?? ""} onChange={(e) => setOpForm({ ...opForm, cantidad: e.target.value })} />
              {op === "ajuste" && <p className="text-xs text-slate-500">Positivo agrega stock, negativo lo reduce.</p>}
            </div>

            {/* Lote para AJUSTE de productos que requieren lote/vencimiento */}
            {ajusteRequiereLote && (
              <div className="border rounded p-2 space-y-2 bg-amber-50">
                <p className="text-xs font-medium text-amber-800">
                  Esta categoria requiere lote y fecha de vencimiento.
                </p>
                <div className="flex gap-2 text-sm">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={opForm.lote_modo === "existente"}
                      onChange={() => setOpForm({ ...opForm, lote_modo: "existente" })}
                    /> Lote existente
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={opForm.lote_modo === "nuevo"}
                      onChange={() => setOpForm({ ...opForm, lote_modo: "nuevo" })}
                      disabled={Number(opForm.cantidad) < 0}
                    /> Crear lote nuevo
                  </label>
                </div>
                {opForm.lote_modo === "existente" && (
                  <select className="input" value={opForm.lote_id ?? ""} onChange={(e) => setOpForm({ ...opForm, lote_id: e.target.value })}>
                    <option value="">-- Lote en stock --</option>
                    {lotesAjuste.length === 0 && <option disabled>No hay lotes con stock en este area</option>}
                    {lotesAjuste.map((l) => (
                      <option key={l.lote_id ?? "null"} value={l.lote_id ?? ""}>
                        {l.numero_lote ?? "(sin lote)"} - vence {l.fecha_vencimiento ?? "-"} - stock {l.cantidad}
                      </option>
                    ))}
                  </select>
                )}
                {opForm.lote_modo === "nuevo" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs">Numero de lote</label>
                      <input className="input" value={opForm.lote_numero ?? ""} onChange={(e) => setOpForm({ ...opForm, lote_numero: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs">Vencimiento</label>
                      <input className="input" type="date" value={opForm.fecha_vencimiento ?? ""} onChange={(e) => setOpForm({ ...opForm, fecha_vencimiento: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {op === "descarte" && (
              <div>
                <label className="text-xs font-medium">Motivo</label>
                <select className="input" value={opForm.motivo ?? "vencido"} onChange={(e) => setOpForm({ ...opForm, motivo: e.target.value })}>
                  <option value="vencido">Vencido</option>
                  <option value="deteriorado">Deteriorado</option>
                  <option value="defuncion">Defuncion</option>
                  <option value="sobrante">Sobrante</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
            )}

            <div>
              <label className="text-xs font-medium">{op === "ajuste" ? "Justificacion (obligatoria)" : "Observaciones"}</label>
              <textarea className="input" value={opForm.observaciones ?? ""} onChange={(e) => setOpForm({ ...opForm, observaciones: e.target.value })} />
            </div>

            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setOp(null); setOpForm({}); }}>Cancelar</button>
              <button className="btn" onClick={submitOp}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
      <div className="flex gap-2 border-b">
        {(["stock", "valorizacion", "movimientos"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 ${tab === t ? "border-blue-600 text-blue-600 font-medium" : "border-transparent text-slate-600"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "stock" && (
        <div className="card overflow-auto">
          <table className="table">
            <thead><tr><th>Codigo</th><th>Producto</th><th>Area</th><th>Lote</th><th>Vence</th><th>Cantidad</th></tr></thead>
            <tbody>
              {stock.map((s, i) => (
                <tr key={i} className={s.es_controlado ? "bg-amber-50" : ""}>
                  <td>{s.codigo}</td><td>{s.nombre}</td><td>{s.area}</td>
                  <td>{s.numero_lote ?? "-"}</td><td>{s.fecha_vencimiento ?? "-"}</td><td>{s.cantidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "valorizacion" && (
        <div className="card overflow-auto">
          <div className="mb-2 text-sm">Valor total: <span className="font-semibold text-lg">${Number(val.total).toFixed(2)}</span></div>
          <table className="table">
            <thead><tr><th>Area</th><th>Codigo</th><th>Producto</th><th>Cant</th><th>UM</th><th>CPP</th><th>Valor</th></tr></thead>
            <tbody>
              {val.data.map((v, i) => (
                <tr key={i}>
                  <td>{v.area}</td><td>{v.codigo}</td><td>{v.nombre}</td>
                  <td>{v.cantidad}</td><td>{v.unidad}</td>
                  <td>{Number(v.cpp).toFixed(4)}</td>
                  <td className="font-medium">${Number(v.valor).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "movimientos" && (
        <div className="card overflow-auto">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Lote</th><th>Origen</th><th>Destino</th><th>Cant</th><th>Costo</th><th>Usuario</th></tr></thead>
            <tbody>
              {movs.map((m) => (
                <tr key={m.id}>
                  <td className="text-xs">{m.fecha}</td>
                  <td><span className="text-xs px-1 rounded bg-slate-100">{m.tipo}</span></td>
                  <td>{m.producto}</td>
                  <td>{m.numero_lote ?? "-"}</td>
                  <td>{m.area_origen ?? "-"}</td>
                  <td>{m.area_destino ?? "-"}</td>
                  <td>{m.cantidad}</td>
                  <td>{Number(m.costo_unitario).toFixed(4)}</td>
                  <td className="text-xs">{m.usuario ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
