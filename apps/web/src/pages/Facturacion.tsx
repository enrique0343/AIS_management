import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Factura = { id: number; numero: string; fecha: string; total: number; estado: string; paciente: string };

export default function Facturacion() {
  const [items, setItems] = useState<Factura[]>([]);
  const [episodioId, setEpisodioId] = useState("");
  const [ivaPct, setIvaPct] = useState("13");
  const [reporte, setReporte] = useState<any[]>([]);

  const load = () => api.get<{ data: Factura[] }>("/api/facturacion/facturas").then((r) => setItems(r.data));

  useEffect(() => { load(); }, []);

  const emitir = async () => {
    if (!episodioId) return;
    await api.post("/api/facturacion/facturas", { episodio_id: Number(episodioId), iva_pct: Number(ivaPct) });
    setEpisodioId("");
    load();
  };

  const verReporte = async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const r = await api.get<{ data: any[] }>(`/api/facturacion/reporte-ingresos?desde=${hoy}&hasta=${hoy}`);
    setReporte(r.data);
  };

  const pagar = async (id: number) => {
    const monto = prompt("Monto del pago:");
    if (!monto) return;
    const metodo = prompt("Metodo (efectivo/tarjeta/transferencia):") ?? "efectivo";
    await api.post(`/api/facturacion/facturas/${id}/pagos`, { metodo, monto: Number(monto) });
    load();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Facturacion</h1>

      <div className="card space-y-2">
        <h2 className="font-semibold">Emitir factura desde episodio</h2>
        <div className="flex gap-2">
          <input className="input w-32" type="number" placeholder="ID Episodio" value={episodioId} onChange={(e) => setEpisodioId(e.target.value)} />
          <input className="input w-24" type="number" step="0.01" placeholder="IVA %" value={ivaPct} onChange={(e) => setIvaPct(e.target.value)} />
          <button className="btn" onClick={emitir}>Emitir</button>
          <button className="btn-secondary" onClick={verReporte}>Ingresos de hoy</button>
        </div>
        {!!reporte.length && (
          <table className="table mt-2">
            <thead><tr><th>Dia</th><th>Metodo</th><th>Cantidad</th><th>Total</th></tr></thead>
            <tbody>
              {reporte.map((r, i) => (
                <tr key={i}><td>{r.dia}</td><td>{r.metodo}</td><td>{r.cantidad}</td><td>{Number(r.total).toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card overflow-auto">
        <table className="table">
          <thead><tr><th>Numero</th><th>Fecha</th><th>Paciente</th><th>Total</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {items.map((f) => (
              <tr key={f.id}>
                <td>{f.numero}</td>
                <td>{f.fecha}</td>
                <td>{f.paciente}</td>
                <td>{Number(f.total).toFixed(2)}</td>
                <td>{f.estado}</td>
                <td>{f.estado === "pendiente" && <button className="btn-secondary text-xs" onClick={() => pagar(f.id)}>Pago</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
