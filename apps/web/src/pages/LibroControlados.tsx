import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Row = {
  fecha: string;
  tipo: string;
  codigo: string;
  producto: string;
  numero_lote: string | null;
  fecha_vencimiento: string | null;
  area_origen: string | null;
  area_destino: string | null;
  cantidad: number;
  n_autorizacion_srs: string | null;
  responsable: string | null;
};

export default function LibroControlados() {
  const [rows, setRows] = useState<Row[]>([]);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const load = () => {
    const q = new URLSearchParams();
    if (desde) q.set("desde", desde);
    if (hasta) q.set("hasta", hasta);
    api.get<{ data: Row[] }>(`/api/inventario/libro-controlados?${q.toString()}`).then((r) => setRows(r.data));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Libro de controlados (SRS)</h1>
      <p className="text-sm text-slate-500">
        Trazabilidad de medicamentos controlados conforme lineamiento 05.01.04.LIN.20250702.01 §7.4 y §7.6.
      </p>
      <div className="card flex gap-2 items-end">
        <div>
          <label className="text-xs">Desde</label>
          <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div>
          <label className="text-xs">Hasta</label>
          <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <button className="btn" onClick={load}>Filtrar</button>
      </div>
      <div className="card overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th><th>Tipo</th><th>Producto</th><th>Lote</th><th>Vence</th>
              <th>Origen</th><th>Destino</th><th>Cant</th><th>Aut. SRS</th><th>Responsable</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.fecha}</td>
                <td>{r.tipo}</td>
                <td><div>{r.producto}</div><div className="text-xs text-slate-400">{r.codigo}</div></td>
                <td>{r.numero_lote ?? "-"}</td>
                <td>{r.fecha_vencimiento ?? "-"}</td>
                <td>{r.area_origen ?? "-"}</td>
                <td>{r.area_destino ?? "-"}</td>
                <td>{r.cantidad}</td>
                <td>{r.n_autorizacion_srs ?? "-"}</td>
                <td>{r.responsable ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
