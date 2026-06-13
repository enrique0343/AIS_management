import { useEffect, useState } from "react";
import { api } from "../lib/api";
import Productos from "./Productos";
import Inventario from "./Inventario";
import Compras from "./Compras";

type Tab = "requisiciones" | "devoluciones" | "productos" | "inventario" | "compras";

export default function Farmacia() {
  const [tab, setTab] = useState<Tab>("requisiciones");
  const [pendientesCount, setPendientesCount] = useState<number>(0);
  const [devPendCount, setDevPendCount] = useState<number>(0);

  const refrescarCount = () => {
    api.get<{ n: number }>("/api/requisiciones/_pendientes_count").then((r) => setPendientesCount(r.n)).catch(() => {});
    api.get<{ data: any[] }>("/api/enfermeria/devoluciones-pendientes?estado=pendiente").then((r) => setDevPendCount(r.data.length)).catch(() => {});
  };
  useEffect(() => { refrescarCount(); }, [tab]);

  const tabs: [Tab, string][] = [
    ["requisiciones", `Requisiciones${pendientesCount ? ` (${pendientesCount})` : ""}`],
    ["devoluciones", `Devoluciones${devPendCount ? ` (${devPendCount})` : ""}`],
    ["productos", "Productos"],
    ["inventario", "Inventario / stock"],
    ["compras", "Compras a proveedores"],
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Farmacia interna</h1>
      <p className="text-sm text-slate-500">
        Modulo unificado: bandeja de requisiciones de enfermeria, productos, inventario y compras a proveedores.
      </p>
      <div className="flex gap-2 border-b flex-wrap">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 ${
              tab === t ? "border-blue-600 text-blue-600 font-medium" : "border-transparent text-slate-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "requisiciones" && <PanelRequisiciones onChange={refrescarCount} />}
      {tab === "devoluciones" && <PanelDevoluciones onChange={refrescarCount} />}
      {tab === "productos" && <Productos />}
      {tab === "inventario" && <Inventario />}
      {tab === "compras" && <Compras />}
    </div>
  );
}

type Estado = "pendiente" | "despachada_parcial" | "despachada" | "rechazada" | "cancelada";

function PanelRequisiciones({ onChange }: { onChange: () => void }) {
  const [estado, setEstado] = useState<Estado>("pendiente");
  const [items, setItems] = useState<any[]>([]);
  const [conteos, setConteos] = useState<{ pendiente: number; despachada_parcial: number }>({ pendiente: 0, despachada_parcial: 0 });
  const [det, setDet] = useState<{ requisicion: any; detalles: any[] } | null>(null);
  // assignations[detalle_id] = { lotes: [{ lote_id, cantidad }] }
  const [assign, setAssign] = useState<Record<number, { lote_id: number | null; cantidad: number }[]>>({});
  // catalogo de lotes disponibles cargado por linea
  const [lotesPorLinea, setLotesPorLinea] = useState<Record<number, any[]>>({});

  const loadConteos = () =>
    api.get<{ pendiente: number; despachada_parcial: number }>("/api/requisiciones/_pendientes_count")
      .then((r) => setConteos({ pendiente: r.pendiente, despachada_parcial: r.despachada_parcial }));

  const load = () => api.get<{ data: any[] }>(`/api/requisiciones?estado=${estado}`).then((r) => setItems(r.data));
  useEffect(() => { load(); }, [estado]);
  useEffect(() => {
    loadConteos();
    const t = setInterval(loadConteos, 30000);
    return () => clearInterval(t);
  }, []);

  const abrir = async (id: number) => {
    const r = await api.get<any>(`/api/requisiciones/${id}`);
    setDet(r);
    // Pre-cargar lotes disponibles por cada linea (en el area de farmacia)
    const lotes: Record<number, any[]> = {};
    const asg: Record<number, { lote_id: number | null; cantidad: number }[]> = {};
    for (const d of r.detalles) {
      const lr = await api.get<{ data: any[] }>(`/api/productos/${d.producto_id}/lotes-disponibles?area_id=${r.requisicion.area_farmacia_id}`);
      lotes[d.id] = lr.data;
      asg[d.id] = []; // farmacia decide cuanto de cada lote
    }
    setLotesPorLinea(lotes);
    setAssign(asg);
  };

  const setLoteCant = (detalleId: number, loteId: number | null, cantidad: number) => {
    const actuales = assign[detalleId] ?? [];
    const sin = actuales.filter((l) => l.lote_id !== loteId);
    const nuevo = cantidad > 0 ? [...sin, { lote_id: loteId, cantidad }] : sin;
    setAssign({ ...assign, [detalleId]: nuevo });
  };

  const fefoAuto = (detalleId: number, pendiente: number) => {
    const lotes = lotesPorLinea[detalleId] ?? [];
    let restante = pendiente;
    const plan: { lote_id: number | null; cantidad: number }[] = [];
    for (const l of lotes) {
      if (restante <= 0) break;
      const tomar = Math.min(restante, Number(l.cantidad));
      plan.push({ lote_id: l.lote_id, cantidad: tomar });
      restante -= tomar;
    }
    setAssign({ ...assign, [detalleId]: plan });
  };

  const despachar = async () => {
    if (!det) return;
    const items = det.detalles
      .map((d: any) => ({
        id: d.id,
        lotes: (assign[d.id] ?? []).filter((l) => Number(l.cantidad) > 0),
      }))
      .filter((it) => it.lotes.length > 0);
    if (!items.length) {
      alert("Asigne al menos un lote a despachar (use 'FEFO automatico' o capture manual).");
      return;
    }
    try {
      const r = await api.post<any>(`/api/requisiciones/${det.requisicion.id}/despachar`, { items });
      const fallos = r.resultados.filter((x: any) => !x.ok);
      if (fallos.length) {
        alert("Despacho con errores:\n" + fallos.map((f: any) => `Linea ${f.detalle_id}: ${f.error}`).join("\n"));
      } else {
        alert("Despacho registrado. La cuenta hospitalaria del paciente fue actualizada.");
      }
      setDet(null);
      load();
      loadConteos();
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
    loadConteos();
    onChange();
  };

  const estados: { key: Estado; label: string; color: string; ring: string }[] = [
    { key: "pendiente", label: "Por despachar", color: "bg-red-600 text-white hover:bg-red-700", ring: "border-red-500" },
    { key: "despachada_parcial", label: "Parciales", color: "bg-blue-600 text-white hover:bg-blue-700", ring: "border-blue-500" },
    { key: "despachada", label: "Despachadas", color: "bg-green-600 text-white hover:bg-green-700", ring: "border-green-500" },
    { key: "rechazada", label: "Rechazadas", color: "bg-slate-500 text-white hover:bg-slate-600", ring: "border-slate-400" },
    { key: "cancelada", label: "Canceladas", color: "bg-slate-400 text-white hover:bg-slate-500", ring: "border-slate-300" },
  ];
  const conf = estados.find((e) => e.key === estado)!;

  const prioridadColor = (p: string) =>
    p === "stat" ? "bg-red-100 text-red-700" : p === "urgente" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";

  return (
    <div className="space-y-3">
      {/* Botones de estado con colores fuertes */}
      <div className="flex flex-wrap gap-2">
        {estados.map((e) => {
          const count = e.key === "pendiente" ? conteos.pendiente : e.key === "despachada_parcial" ? conteos.despachada_parcial : 0;
          return (
            <button
              key={e.key}
              onClick={() => setEstado(e.key)}
              className={`relative px-4 py-2 rounded-md text-sm font-medium ${estado === e.key ? e.color : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
            >
              {e.label}
              {count > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[1.2rem] h-5 px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold leading-none shadow">
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <button className="btn-secondary ml-auto" onClick={() => { load(); loadConteos(); }}>Refrescar</button>
      </div>

      {!items.length && (
        <div className="card text-sm text-slate-500">Sin requisiciones en este estado.</div>
      )}

      {/* Cards (rojo/azul) o tabla compacta (verde) */}
      {(estado === "despachada" || estado === "rechazada" || estado === "cancelada") ? (
        <div className="card overflow-auto">
          <table className="table">
            <thead><tr><th>Numero</th><th>Fecha</th><th>Paciente</th><th>Solicitante</th><th>Despachada por</th><th>Fecha desp.</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className={
                  estado === "despachada" ? "bg-green-50" : estado === "rechazada" ? "bg-red-50/30" : "bg-slate-50"
                }>
                  <td className="font-mono text-xs">{r.numero}</td>
                  <td className="text-xs">{r.fecha_solicitud}</td>
                  <td>{r.paciente} <span className="text-xs text-slate-500">({r.expediente})</span></td>
                  <td className="text-xs">{r.solicitante}</td>
                  <td className="text-xs">{r.despachador ?? "-"}</td>
                  <td className="text-xs">{r.fecha_despacho ?? "-"}</td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      estado === "despachada" ? "bg-green-100 text-green-700"
                      : estado === "rechazada" ? "bg-red-100 text-red-700"
                      : "bg-slate-100 text-slate-600"
                    }`}>{r.estado}</span>
                  </td>
                  <td>
                    <button className="btn-secondary text-xs" onClick={() => abrir(r.id)}>Ver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((r) => (
            <button
              key={r.id}
              onClick={() => abrir(r.id)}
              className={`card text-left hover:shadow-md transition border-l-4 ${conf.ring}`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold font-mono text-sm">{r.numero}</div>
                  <div className="text-xs text-slate-500">{r.fecha_solicitud}</div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${prioridadColor(r.prioridad)}`}>{r.prioridad.toUpperCase()}</span>
              </div>
              <div className="mt-2 text-sm">
                <div><span className="text-slate-500">Paciente:</span> {r.paciente} ({r.expediente})</div>
                <div className="text-xs text-slate-500">Por: {r.solicitante} {r.area_solicitante ? `(${r.area_solicitante})` : ""}</div>
                <div className="text-xs">Despacho desde: <strong>{r.area_farmacia}</strong></div>
                <div className="text-xs mt-1">{r.lineas} producto(s)</div>
                {r.observaciones && <div className="text-xs italic mt-1">{r.observaciones}</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Modal detalle / despachar */}
      {det && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-4xl space-y-3 max-h-[90vh] overflow-auto">
            <div className="flex justify-between">
              <div>
                <h2 className="font-semibold">{det.requisicion.numero}</h2>
                <div className="text-xs text-slate-500">
                  {det.requisicion.paciente} ({det.requisicion.expediente}) - {det.requisicion.fecha_solicitud}
                </div>
                <div className="text-xs">Despacho desde: <strong>{det.requisicion.area_farmacia}</strong></div>
              </div>
              <button className="btn-secondary" onClick={() => setDet(null)}>Cerrar</button>
            </div>

            {det.detalles.map((d: any) => {
              const pend = Number(d.cantidad_solicitada) - Number(d.cantidad_despachada);
              const lotes = lotesPorLinea[d.id] ?? [];
              const asg = assign[d.id] ?? [];
              const sumaAsignada = asg.reduce((s, a) => s + Number(a.cantidad), 0);
              const isReadonly = !["pendiente", "despachada_parcial"].includes(det.requisicion.estado);

              return (
                <div key={d.id} className="border rounded p-3 space-y-2">
                  <div className="flex justify-between items-baseline">
                    <div>
                      <div className="font-medium">{d.producto} <span className="text-xs font-mono text-slate-500">({d.codigo})</span></div>
                      <div className="text-xs text-slate-500">Solicitado: {d.cantidad_solicitada} {d.unidad} | Ya despachado: {d.cantidad_despachada} | Pendiente: <strong>{pend}</strong></div>
                    </div>
                    {!isReadonly && pend > 0 && (
                      <button className="btn-secondary text-xs" onClick={() => fefoAuto(d.id, pend)}>
                        Auto FEFO ({pend})
                      </button>
                    )}
                  </div>

                  {pend > 0 && !isReadonly && (
                    <>
                      <div className="text-xs font-medium text-slate-700">Lotes disponibles en {det.requisicion.area_farmacia}:</div>
                      {!lotes.length ? (
                        <div className="text-xs text-red-600">No hay stock en esta farmacia.</div>
                      ) : (
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Lote</th>
                              <th>Vencimiento</th>
                              <th>Disponible</th>
                              <th>A despachar</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lotes.map((l: any) => {
                              const asignacion = asg.find((a) => a.lote_id === l.lote_id);
                              const cantidadAsig = asignacion?.cantidad ?? 0;
                              const venceProximo = l.fecha_vencimiento && new Date(l.fecha_vencimiento) < new Date(Date.now() + 90 * 86400000);
                              return (
                                <tr key={`${d.id}-${l.lote_id ?? "null"}`} className={venceProximo ? "bg-amber-50" : ""}>
                                  <td className="font-mono text-xs">{l.numero_lote ?? "(sin lote)"}</td>
                                  <td className={venceProximo ? "text-amber-700 font-medium" : ""}>
                                    {l.fecha_vencimiento ?? "-"}
                                  </td>
                                  <td>{l.cantidad}</td>
                                  <td>
                                    <input
                                      className="input w-24"
                                      type="number"
                                      min="0"
                                      max={Math.min(l.cantidad, pend)}
                                      step="0.01"
                                      value={cantidadAsig}
                                      onChange={(e) => setLoteCant(d.id, l.lote_id, Number(e.target.value || 0))}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="bg-slate-50">
                              <td colSpan={3} className="text-right font-medium">Total asignado</td>
                              <td className={sumaAsignada > pend ? "text-red-600 font-semibold" : sumaAsignada === pend ? "text-green-600 font-semibold" : "font-semibold"}>
                                {sumaAsignada} / {pend}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            <p className="text-xs text-slate-500">
              Use "Auto FEFO" para asignar automaticamente los lotes proximos a vencer, o capture manualmente
              la cantidad por lote. Lotes proximos a vencer (90 dias) en amarillo. Al despachar, la cuenta
              hospitalaria del paciente se actualiza automaticamente.
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

// ─── Panel de devoluciones pendientes de enfermeria ───────────────────────────
function PanelDevoluciones({ onChange }: { onChange: () => void }) {
  const [filtro, setFiltro] = useState<"pendiente" | "procesada" | "rechazada">("pendiente");
  const [items, setItems] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [proc, setProc] = useState<any | null>(null); // devolucion seleccionada para procesar
  const [procForm, setProcForm] = useState({ area_id: "", observaciones: "" });

  const load = () =>
    api.get<{ data: any[] }>(`/api/enfermeria/devoluciones-pendientes?estado=${filtro}`)
      .then((r) => setItems(r.data));

  useEffect(() => { load(); }, [filtro]);
  useEffect(() => {
    api.get<{ data: any[] }>("/api/catalogos/areas").then((r) => setAreas(r.data));
  }, []);

  const abrirProcesar = (item: any) => {
    setProc(item);
    setProcForm({ area_id: String(item.area_destino_id ?? ""), observaciones: "" });
  };

  const procesarDev = async () => {
    if (!proc || !procForm.area_id) { alert("Selecciona el area de reingreso"); return; }
    try {
      await api.post(`/api/enfermeria/devoluciones/${proc.id}/procesar`, {
        area_id: Number(procForm.area_id),
        observaciones: procForm.observaciones || undefined,
      });
      setProc(null);
      load();
      onChange();
    } catch (e: any) { alert(e.message); }
  };

  const rechazarDev = async (item: any) => {
    const motivo = prompt("Motivo del rechazo:");
    if (!motivo) return;
    try {
      await api.post(`/api/enfermeria/devoluciones/${item.id}/rechazar`, { motivo });
      load();
      onChange();
    } catch (e: any) { alert(e.message); }
  };

  const estadoBadge: Record<string, string> = {
    pendiente: "bg-amber-100 text-amber-700",
    procesada: "bg-green-100 text-green-700",
    rechazada: "bg-red-100 text-red-600",
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        {(["pendiente", "procesada", "rechazada"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize ${filtro === f ? estadoBadge[f] + " ring-1 ring-current" : "bg-white border border-slate-300 text-slate-600"}`}
          >
            {f === "pendiente" ? "Por procesar" : f === "procesada" ? "Procesadas" : "Rechazadas"}
          </button>
        ))}
        <button className="btn-secondary ml-auto text-xs" onClick={load}>Refrescar</button>
      </div>

      {!items.length ? (
        <div className="card text-sm text-slate-500">Sin devoluciones en este estado.</div>
      ) : (
        <div className="space-y-2">
          {items.map((d) => (
            <div key={d.id} className="card space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{d.producto}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${estadoBadge[d.estado]}`}>{d.estado}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-0.5 text-xs text-slate-600">
                    <div><span className="text-slate-400">Paciente: </span>{d.paciente}</div>
                    <div><span className="text-slate-400">Cant: </span><strong>{d.cantidad}</strong></div>
                    <div>
                      <span className="text-slate-400">Lote: </span>
                      {d.numero_lote
                        ? <span className="font-mono font-semibold">{d.numero_lote}</span>
                        : <span className="text-slate-400">—</span>}
                      {d.fecha_vencimiento && <span className="text-slate-400"> vence {d.fecha_vencimiento}</span>}
                    </div>
                    <div><span className="text-slate-400">Area sugerida: </span>{d.area_sugerida ?? "—"}</div>
                    <div><span className="text-slate-400">Solicitante: </span>{d.solicitante}</div>
                    <div><span className="text-slate-400">Fecha: </span>{d.created_at?.slice(0, 16)}</div>
                    {d.procesado_por && <div><span className="text-slate-400">Procesado por: </span>{d.procesado_por}</div>}
                    {d.motivo_rechazo && <div className="col-span-2 text-red-600"><span className="text-slate-400">Motivo rechazo: </span>{d.motivo_rechazo}</div>}
                  </div>
                  {d.observaciones && <div className="text-xs text-slate-500 italic">{d.observaciones}</div>}
                </div>
                {d.estado === "pendiente" && (
                  <div className="flex gap-1 shrink-0">
                    <button className="btn text-xs" onClick={() => abrirProcesar(d)}>Procesar</button>
                    <button className="btn-secondary text-xs" onClick={() => rechazarDev(d)}>Rechazar</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal procesar devolucion */}
      {proc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold">Procesar devolucion</h2>
              <button className="btn-secondary text-xs" onClick={() => setProc(null)}>Cancelar</button>
            </div>

            {/* Resumen del producto */}
            <div className="rounded-lg bg-slate-50 border p-3 space-y-1 text-sm">
              <div className="font-medium">{proc.producto} <span className="text-slate-400 font-mono text-xs">{proc.codigo}</span></div>
              <div className="flex flex-wrap gap-4 text-xs text-slate-600">
                <span><span className="text-slate-400">Paciente: </span>{proc.paciente}</span>
                <span><span className="text-slate-400">Cantidad: </span><strong>{proc.cantidad}</strong></span>
                <span>
                  <span className="text-slate-400">Lote: </span>
                  {proc.numero_lote
                    ? <span className="font-mono font-semibold text-slate-800">{proc.numero_lote}</span>
                    : <span className="text-slate-400">Sin lote</span>}
                  {proc.fecha_vencimiento && <span className="text-slate-400"> · vence {proc.fecha_vencimiento}</span>}
                </span>
              </div>
              <div className="text-xs text-slate-500">Solicitado por: {proc.solicitante} — {proc.created_at?.slice(0, 16)}</div>
            </div>

            <div>
              <label className="text-xs font-medium">Area donde reingresa el stock *</label>
              <select className="input" value={procForm.area_id} onChange={(e) => setProcForm({ ...procForm, area_id: e.target.value })}>
                <option value="">-- Seleccionar area --</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
              <p className="text-xs text-slate-400 mt-1">Area sugerida por enfermeria: <strong>{proc.area_sugerida ?? "—"}</strong>. Puedes cambiarla si corresponde a otra ubicacion.</p>
            </div>

            <div>
              <label className="text-xs font-medium">Observaciones (opcional)</label>
              <input className="input" placeholder="Notas del dependiente" value={procForm.observaciones} onChange={(e) => setProcForm({ ...procForm, observaciones: e.target.value })} />
            </div>

            <div className="flex justify-end gap-2 pt-1 border-t">
              <button className="btn-secondary" onClick={() => setProc(null)}>Cancelar</button>
              <button className="btn" onClick={procesarDev} disabled={!procForm.area_id}>
                Confirmar reingreso al stock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

