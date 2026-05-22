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

export default function Inventario() {
  const [tab, setTab] = useState<"stock" | "valorizacion" | "movimientos">("stock");
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
        {(tab === "stock" || tab === "valorizacion") && (
          <select className="input w-64" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">Todas las areas</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        )}
      </div>
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
