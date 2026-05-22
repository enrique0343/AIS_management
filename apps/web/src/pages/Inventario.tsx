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

type Area = { id: number; nombre: string; tipo: string };

export default function Inventario() {
  const [stock, setStock] = useState<Stock[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [areaId, setAreaId] = useState<string>("");

  const load = () => {
    const url = areaId ? `/api/inventario/stock?area_id=${areaId}` : "/api/inventario/stock";
    api.get<{ data: Stock[] }>(url).then((r) => setStock(r.data));
  };

  useEffect(() => {
    api.get<{ data: Area[] }>("/api/catalogos/areas").then((r) => setAreas(r.data));
  }, []);
  useEffect(() => { load(); }, [areaId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Inventario</h1>
        <select className="input w-64" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          <option value="">Todas las areas</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </div>
      <div className="card overflow-auto">
        <table className="table">
          <thead>
            <tr><th>Codigo</th><th>Producto</th><th>Area</th><th>Lote</th><th>Vence</th><th>Cantidad</th></tr>
          </thead>
          <tbody>
            {stock.map((s, i) => (
              <tr key={i} className={s.es_controlado ? "bg-amber-50" : ""}>
                <td>{s.codigo}</td>
                <td>{s.nombre}</td>
                <td>{s.area}</td>
                <td>{s.numero_lote ?? "-"}</td>
                <td>{s.fecha_vencimiento ?? "-"}</td>
                <td>{s.cantidad}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
