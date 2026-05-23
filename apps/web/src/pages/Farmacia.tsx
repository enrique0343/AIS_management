import { useEffect, useState } from "react";
import { api } from "../lib/api";
import Productos from "./Productos";
import Inventario from "./Inventario";
import Compras from "./Compras";

type Tab = "pendientes" | "productos" | "inventario" | "compras";

export default function Farmacia() {
  const [tab, setTab] = useState<Tab>("pendientes");
  const [pendientesCount, setPendientesCount] = useState<number>(0);

  useEffect(() => {
    api.get<{ n: number }>("/api/requisiciones/_pendientes_count").then((r) => setPendientesCount(r.n)).catch(() => {});
  }, [tab]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Farmacia interna</h1>
      <p className="text-sm text-slate-500">
        Modulo unificado: bandeja de requisiciones de enfermeria, productos, inventario y compras a proveedores.
      </p>
      <div className="flex gap-2 border-b flex-wrap">
        {([
          ["pendientes", `Pendientes${pendientesCount ? ` (${pendientesCount})` : ""}`],
          ["productos", "Productos"],
          ["inventario", "Inventario / stock"],
          ["compras", "Compras a proveedores"],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 ${
              tab === t
                ? "border-blue-600 text-blue-600 font-medium"
                : "border-transparent text-slate-600"
            } ${t === "pendientes" && pendientesCount > 0 ? "font-medium" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "pendientes" && <PendientesRequisiciones onChange={() => api.get<{ n: number }>("/api/requisiciones/_pendientes_count").then((r) => setPendientesCount(r.n))} />}
      {tab === "productos" && <Productos />}
      {tab === "inventario" && <Inventario />}
      {tab === "compras" && <Compras />}
    </div>
  );
}

function PendientesRequisiciones({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [estado, setEstado] = useState("pendiente");
  const [det, setDet] = useState<{ requisicion: any; detalles: any[] } | null>(null);
  const [items2, setItems2] = useState<Record<number, string>>({});

  const load = () => api.get<{ data: any[] }>(`/api/requisiciones?estado=${estado}`).then((r) => setItems(r.data));
  useEffect(() => { load(); }, [estado]);

  const abrir = async (id: number) => {
    const r = await api.get<any>(`/api/requisiciones/${id}`);
    setDet(r);
    setItems2(Object.fromEntries(r.detalles.map((d: any) => [d.id, String(d.cantidad_solicitada - d.cantidad_despachada)])));
  };

  const despachar = async () => {
    if (!det) return;
    try {
      const r = await api.post<any>(`/api/requisiciones/${det.requisicion.id}/despachar`, {
        items: Object.entries(items2)
          .filter(([_, v]) => Number(v) > 0)
          .map(([id, v]) => ({ id: Number(id), cantidad_despachada: Number(v) })),
      });
      const fallos = r.resultados.filter((x: any) => !x.ok);
      if (fallos.length) {
        alert("Despacho con errores:\n" + fallos.map((f: any) => `Linea ${f.detalle_id}: ${f.error}`).join("\n"));
      }
      setDet(null);
      load();
      onChange();
    } catch (e: any) { alert(e.message); }
  };

  const rechazar = async () => {
    if (!det) return;
    const motivo = prompt("Motivo del rechazo:");
    if (!motivo) return;
    await api.post(`/api/requisiciones/${det.requisicion.id}/rechazar`, { motivo });
    setDet(null);
    load();
    onChange();
  };

  const prioridadColor = (p: string) =>
    p === "stat" ? "bg-red-100 text-red-700" : p === "urgente" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end">
        <div>
          <label className="text-xs">Estado</label>
          <select className="input" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="pendiente">Pendientes</option>
            <option value="despachada_parcial">Parciales</option>
            <option value="despachada">Despachadas</option>
            <option value="rechazada">Rechazadas</option>
            <option value="cancelada">Canceladas</option>
          </select>
        </div>
        <button className="btn-secondary" onClick={load}>Refrescar</button>
      </div>

      {!items.length && <div className="card text-sm text-slate-500">Sin requisiciones en este estado.</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((r) => (
          <button
            key={r.id}
            onClick={() => abrir(r.id)}
            className={`card text-left hover:shadow-md transition border-l-4 ${
              r.prioridad === "stat" ? "border-red-500" : r.prioridad === "urgente" ? "border-amber-500" : "border-slate-300"
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="font-semibold">{r.numero}</div>
                <div className="text-xs text-slate-500">{r.fecha_solicitud}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${prioridadColor(r.prioridad)}`}>{r.prioridad.toUpperCase()}</span>
            </div>
            <div className="mt-2 text-sm">
              <div><span className="text-slate-500">Paciente:</span> {r.paciente} ({r.expediente})</div>
              <div className="text-xs text-slate-500">Por: {r.solicitante} {r.area_solicitante ? `(${r.area_solicitante})` : ""}</div>
              <div className="text-xs">Para despacho desde: <strong>{r.area_farmacia}</strong></div>
              <div className="text-xs mt-1">{r.lineas} producto(s)</div>
              {r.observaciones && <div className="text-xs italic mt-1">{r.observaciones}</div>}
              {r.motivo_rechazo && <div className="text-xs text-red-600 mt-1">Rechazo: {r.motivo_rechazo}</div>}
            </div>
          </button>
        ))}
      </div>

      {det && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-3xl space-y-3 max-h-[90vh] overflow-auto">
            <div className="flex justify-between">
              <div>
                <h2 className="font-semibold">{det.requisicion.numero}</h2>
                <div className="text-xs text-slate-500">
                  {det.requisicion.paciente} ({det.requisicion.expediente}) - {det.requisicion.fecha_solicitud}
                </div>
              </div>
              <button className="btn-secondary" onClick={() => setDet(null)}>Cerrar</button>
            </div>
            <table className="table">
              <thead><tr><th>Codigo</th><th>Producto</th><th>UM</th><th>Solic</th><th>Ya desp.</th><th>Stock</th><th>Despachar ahora</th></tr></thead>
              <tbody>
                {det.detalles.map((d: any) => {
                  const pend = Number(d.cantidad_solicitada) - Number(d.cantidad_despachada);
                  return (
                    <tr key={d.id} className={d.stock_total < pend ? "bg-red-50" : ""}>
                      <td className="font-mono text-xs">{d.codigo}</td>
                      <td>{d.producto}</td>
                      <td>{d.unidad}</td>
                      <td>{d.cantidad_solicitada}</td>
                      <td>{d.cantidad_despachada}</td>
                      <td className={d.stock_total < pend ? "text-red-600 font-medium" : ""}>{d.stock_total}</td>
                      <td>
                        <input
                          className="input w-24"
                          type="number"
                          step="0.01"
                          min="0"
                          max={pend}
                          value={items2[d.id] ?? "0"}
                          disabled={det.requisicion.estado !== "pendiente" && det.requisicion.estado !== "despachada_parcial"}
                          onChange={(e) => setItems2({ ...items2, [d.id]: e.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-slate-500">
              El sistema descontara automaticamente por FEFO (primer lote por vencer) desde {det.requisicion.area_farmacia}.
              Si el stock no alcanza, esa linea quedara como despacho parcial.
            </p>
            {["pendiente", "despachada_parcial"].includes(det.requisicion.estado) && (
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button className="btn-danger" onClick={rechazar}>Rechazar</button>
                <button className="btn" onClick={despachar}>Despachar</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
