import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Factura = { id: number; numero: string; fecha: string; total: number; estado: string; paciente: string };
type Detalle = { id: number; descripcion: string; cantidad: number; precio_unitario: number; subtotal: number };
type Pago = { id: number; metodo: string; monto: number; fecha: string; referencia: string | null };

export default function Facturacion() {
  const [items, setItems] = useState<Factura[]>([]);
  const [episodios, setEpisodios] = useState<any[]>([]);
  const [episodioId, setEpisodioId] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [ivaPct, setIvaPct] = useState("13");
  const [reporte, setReporte] = useState<any[]>([]);
  const [detalle, setDetalle] = useState<{ factura: any; detalles: Detalle[]; pagos: Pago[] } | null>(null);
  const [cargos, setCargos] = useState<{ descripcion: string; cantidad: number; precio_unitario: number }[]>([]);

  const load = () => api.get<{ data: Factura[] }>("/api/facturacion/facturas").then((r) => setItems(r.data));
  const loadEpisodios = () => api.get<{ data: any[] }>("/api/pacientes/episodios/list").then((r) => setEpisodios(r.data));

  useEffect(() => { load(); loadEpisodios(); }, []);

  const emitir = async () => {
    if (!episodioId) return;
    try {
      await api.post("/api/facturacion/facturas", {
        episodio_id: Number(episodioId),
        iva_pct: Number(ivaPct),
        cargos_extra: cargos.length ? cargos : undefined,
      });
      setEpisodioId("");
      setCargos([]);
      load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const [repDesde, setRepDesde] = useState(() => new Date().toISOString().slice(0, 10));
  const [repHasta, setRepHasta] = useState(() => new Date().toISOString().slice(0, 10));

  const verReporte = async () => {
    const r = await api.get<{ data: any[] }>(`/api/facturacion/reporte-ingresos?desde=${repDesde}&hasta=${repHasta}`);
    setReporte(r.data);
  };

  const exportarCSV = () => {
    if (!reporte.length) return;
    const headers = "dia,metodo,cantidad,total\n";
    const rows = reporte.map((r) => `${r.dia},${r.metodo},${r.cantidad},${r.total}`).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ingresos_${repDesde}_${repHasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const abrir = async (id: number) => {
    const r = await api.get<any>(`/api/facturacion/facturas/${id}`);
    setDetalle(r);
  };

  const pagar = async (id: number) => {
    const monto = prompt("Monto del pago:");
    if (!monto) return;
    const metodo = prompt("Metodo (efectivo/tarjeta/transferencia):") ?? "efectivo";
    await api.post(`/api/facturacion/facturas/${id}/pagos`, { metodo, monto: Number(monto) });
    load();
    if (detalle?.factura.id === id) abrir(id);
  };

  const anular = async (id: number) => {
    if (!confirm("Anular factura?")) return;
    await api.post(`/api/facturacion/facturas/${id}/anular`);
    setDetalle(null);
    load();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Facturacion</h1>

      <div className="card space-y-2">
        <h2 className="font-semibold">Emitir factura desde episodio</h2>
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[300px]">
            <label className="text-xs">Episodio</label>
            <select className="input" value={episodioId} onChange={(e) => setEpisodioId(e.target.value)}>
              <option value="">-- Seleccionar --</option>
              {episodios
                .filter((e) => !soloPendientes || e.consumos_pendientes > 0)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    #{e.id} - {e.paciente} ({e.expediente}) - {e.fecha_inicio} [{e.estado}] - {e.consumos_pendientes} consumos pend
                  </option>
                ))}
            </select>
          </div>
          <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} /> Solo con pendientes</label>
          <div><label className="text-xs">IVA %</label><input className="input w-24" type="number" step="0.01" value={ivaPct} onChange={(e) => setIvaPct(e.target.value)} /></div>
          <button className="btn" onClick={emitir}>Emitir</button>
          <button className="btn-secondary" onClick={() => { load(); loadEpisodios(); }}>Refrescar</button>
        </div>
        <div className="flex gap-2 items-end flex-wrap border-t pt-2 mt-2">
          <div><label className="text-xs">Reporte desde</label><input className="input" type="date" value={repDesde} onChange={(e) => setRepDesde(e.target.value)} /></div>
          <div><label className="text-xs">hasta</label><input className="input" type="date" value={repHasta} onChange={(e) => setRepHasta(e.target.value)} /></div>
          <button className="btn-secondary" onClick={verReporte}>Generar</button>
          {!!reporte.length && <button className="btn-secondary" onClick={exportarCSV}>Exportar CSV</button>}
        </div>
        <div className="text-xs font-medium text-slate-500 mt-2">Cargos extra (servicios, quirofano, etc)</div>
        {cargos.map((c, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <input className="input col-span-6" placeholder="Descripcion" value={c.descripcion} onChange={(e) => { const cs = [...cargos]; cs[i].descripcion = e.target.value; setCargos(cs); }} />
            <input className="input col-span-2" type="number" placeholder="Cant" value={c.cantidad} onChange={(e) => { const cs = [...cargos]; cs[i].cantidad = Number(e.target.value); setCargos(cs); }} />
            <input className="input col-span-3" type="number" step="0.01" placeholder="Precio" value={c.precio_unitario} onChange={(e) => { const cs = [...cargos]; cs[i].precio_unitario = Number(e.target.value); setCargos(cs); }} />
            <button className="btn-secondary col-span-1" onClick={() => setCargos(cargos.filter((_, idx) => idx !== i))}>x</button>
          </div>
        ))}
        <button className="btn-secondary text-xs" onClick={() => setCargos([...cargos, { descripcion: "", cantidad: 1, precio_unitario: 0 }])}>+ Cargo extra</button>

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
                <td className="space-x-1">
                  <button className="btn-secondary text-xs" onClick={() => abrir(f.id)}>Ver</button>
                  {f.estado === "pendiente" && <button className="btn text-xs" onClick={() => pagar(f.id)}>Pago</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detalle && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-3xl space-y-3 max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="font-semibold">Factura {detalle.factura.numero}</h2>
                <div className="text-sm text-slate-500">{detalle.factura.fecha} - Estado: {detalle.factura.estado}</div>
              </div>
              <button className="btn-secondary" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
            <table className="table">
              <thead><tr><th>Descripcion</th><th>Cant</th><th>Precio</th><th>Subtotal</th></tr></thead>
              <tbody>
                {detalle.detalles.map((d) => (
                  <tr key={d.id}><td>{d.descripcion}</td><td>{d.cantidad}</td><td>{Number(d.precio_unitario).toFixed(2)}</td><td>{Number(d.subtotal).toFixed(2)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3} className="text-right font-medium">Subtotal</td><td>{Number(detalle.factura.subtotal).toFixed(2)}</td></tr>
                <tr><td colSpan={3} className="text-right font-medium">IVA</td><td>{Number(detalle.factura.iva).toFixed(2)}</td></tr>
                <tr><td colSpan={3} className="text-right font-semibold">Total</td><td className="font-semibold">{Number(detalle.factura.total).toFixed(2)}</td></tr>
              </tfoot>
            </table>
            <h3 className="font-semibold">Pagos</h3>
            {!detalle.pagos.length ? (
              <div className="text-sm text-slate-500">Sin pagos registrados</div>
            ) : (
              <table className="table">
                <thead><tr><th>Fecha</th><th>Metodo</th><th>Monto</th><th>Referencia</th></tr></thead>
                <tbody>
                  {detalle.pagos.map((p) => (
                    <tr key={p.id}><td>{p.fecha}</td><td>{p.metodo}</td><td>{Number(p.monto).toFixed(2)}</td><td>{p.referencia ?? "-"}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex justify-end gap-2 pt-2">
              {detalle.factura.estado === "pendiente" && <button className="btn" onClick={() => pagar(detalle.factura.id)}>Registrar pago</button>}
              {detalle.factura.estado !== "anulada" && <button className="btn-danger" onClick={() => anular(detalle.factura.id)}>Anular</button>}
              <a className="btn-secondary" target="_blank" rel="noreferrer" href={`/facturas/${detalle.factura.id}/print`}>Imprimir / PDF</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
