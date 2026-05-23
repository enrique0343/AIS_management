import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Factura = { id: number; numero: string; fecha: string; total: number; subtotal: number; iva: number; estado: string; paciente: string };
type Detalle = { id: number; descripcion: string; cantidad: number; precio_unitario: number; subtotal: number };
type Pago = { id: number; metodo: string; monto: number; fecha: string; referencia: string | null };
type AltaPend = {
  episodio_id: number; paciente_id: number; expediente: string;
  nombres: string; apellidos: string; fecha_inicio: string; alta_solicitada_en: string;
  habitacion: string | null; habitacion_tipo: string | null; medico_cabecera: string | null;
  cargos_consumos: number; cargos_habitacion: number;
  devoluciones_pendientes: number; requisiciones_activas: number;
};
type ConsumoPend = {
  id: number; producto_id: number; producto: string; codigo: string;
  cantidad: number; precio_venta_snapshot: number;
  lote_id: number | null; lote_numero: string | null; lote_vencimiento: string | null;
  requiere_lote_vencimiento: number; es_servicio: number; area_id: number;
};
type LoteDisp = { id: number; numero_lote: string; fecha_vencimiento: string; stock_total: number };
type ResumenCuenta = {
  episodio: any;
  categorias: Array<{ categoria_id: number; categoria: string; subtotal: number; items: number }>;
  habitacion: { subtotal: number; registros: number } | null;
  subtotal_consumos: number; subtotal_total: number;
};
type DescInput = { tipo: "pct" | "monto"; valor: string };
type CargoExtra = { desc: string; cant: number; precio: number };
type CierreModal = {
  ep: AltaPend; ivaPct: number; cargosExtra: CargoExtra[];
  resumen: ResumenCuenta | null; resumenLoading: boolean;
  descGlobal: DescInput;
  descPorCat: Record<string, DescInput>;
};

const calcDescMonto = (base: number, d: DescInput): number => {
  const v = Number(d.valor) || 0;
  if (!v) return 0;
  return d.tipo === "pct" ? +(base * v / 100).toFixed(2) : +Math.min(v, base).toFixed(2);
};

export default function Facturacion() {
  const [tab, setTab] = useState<"cola" | "facturas" | "reporte">("cola");
  const [altaPend, setAltaPend] = useState<AltaPend[]>([]);
  const [items, setItems] = useState<Factura[]>([]);
  const [detalle, setDetalle] = useState<{ factura: Factura; detalles: Detalle[]; pagos: Pago[] } | null>(null);
  const [cierreModal, setCierreModal] = useState<CierreModal | null>(null);
  const [facturaCreada, setFacturaCreada] = useState<{ id: number; numero: string; total: number } | null>(null);
  const [pagoModal, setPagoModal] = useState<{ facturaId: number; total: number } | null>(null);
  const [pagoForm, setPagoForm] = useState({ metodo: "efectivo", monto: "", referencia: "" });
  const [reporte, setReporte] = useState<any[]>([]);
  const [repDesde, setRepDesde] = useState(() => new Date().toISOString().slice(0, 10));
  const [repHasta, setRepHasta] = useState(() => new Date().toISOString().slice(0, 10));

  // Edicion de cargos
  const [consumosPorEp, setConsumosPorEp] = useState<Record<number, ConsumoPend[]>>({});
  const [editInline, setEditInline] = useState<{ consumoId: number; cantidad: string; precio: string } | null>(null);
  const [editLoteModal, setEditLoteModal] = useState<{
    consumo: ConsumoPend; epId: number; cantidad: string;
    lotes: LoteDisp[]; loteId: number | null; justificacion: string;
  } | null>(null);

  const loadCola = () =>
    api.get<{ data: AltaPend[] }>("/api/facturacion/pendientes-alta").then((r) => setAltaPend(r.data)).catch(() => {});
  const loadFacturas = () =>
    api.get<{ data: Factura[] }>("/api/facturacion/facturas").then((r) => setItems(r.data)).catch(() => {});

  useEffect(() => { loadCola(); loadFacturas(); }, []);

  const abrirCierre = async (ep: AltaPend) => {
    const modal: CierreModal = {
      ep, ivaPct: 13, cargosExtra: [], resumen: null, resumenLoading: true,
      descGlobal: { tipo: "pct", valor: "" }, descPorCat: {},
    };
    setCierreModal(modal);
    try {
      const r = await api.get<ResumenCuenta>(`/api/facturacion/episodios/${ep.episodio_id}/resumen-cuenta`);
      setCierreModal((prev) => prev ? { ...prev, resumen: r, resumenLoading: false } : null);
    } catch {
      setCierreModal((prev) => prev ? { ...prev, resumenLoading: false } : null);
    }
  };

  const confirmarCierre = async () => {
    if (!cierreModal) return;
    const descuentos_categoria = Object.entries(cierreModal.descPorCat)
      .filter(([, d]) => Number(d.valor) > 0)
      .map(([categoria, d]) => ({ categoria, tipo: d.tipo, valor: Number(d.valor) }));
    const descuento_global = Number(cierreModal.descGlobal.valor) > 0
      ? { tipo: cierreModal.descGlobal.tipo, valor: Number(cierreModal.descGlobal.valor) }
      : undefined;
    try {
      const r = await api.post<any>(
        `/api/facturacion/episodios/${cierreModal.ep.episodio_id}/cerrar-y-facturar`,
        {
          iva_pct: cierreModal.ivaPct,
          permitir_cero: true,
          cargos_extra: cierreModal.cargosExtra.map((c) => ({
            descripcion: c.desc, cantidad: c.cant, precio_unitario: c.precio,
          })),
          descuento_global,
          descuentos_categoria: descuentos_categoria.length ? descuentos_categoria : undefined,
        }
      );
      setCierreModal(null);
      setFacturaCreada({ id: r.factura_id, numero: r.numero, total: r.total });
      loadCola();
      loadFacturas();
    } catch (e: any) {
      alert(e.message ?? "Error al cerrar cuenta");
    }
  };

  const abrir = async (id: number) => {
    const r = await api.get<any>(`/api/facturacion/facturas/${id}`);
    setDetalle(r);
  };
  const abrirPago = (facturaId: number, total: number) => {
    setPagoModal({ facturaId, total });
    setPagoForm({ metodo: "efectivo", monto: String(total), referencia: "" });
  };
  const confirmarPago = async () => {
    if (!pagoModal) return;
    try {
      await api.post(`/api/facturacion/facturas/${pagoModal.facturaId}/pagos`, {
        metodo: pagoForm.metodo, monto: Number(pagoForm.monto), referencia: pagoForm.referencia || null,
      });
      setPagoModal(null);
      loadFacturas();
      if (detalle?.factura.id === pagoModal.facturaId) abrir(pagoModal.facturaId);
    } catch (e: any) { alert(e.message ?? "Error"); }
  };
  const anular = async (id: number) => {
    if (!confirm("Anular factura?")) return;
    await api.post(`/api/facturacion/facturas/${id}/anular`);
    setDetalle(null); loadFacturas();
  };
  const verReporte = async () => {
    const r = await api.get<{ data: any[] }>(`/api/facturacion/reporte-ingresos?desde=${repDesde}&hasta=${repHasta}`);
    setReporte(r.data);
  };
  const exportarCSV = () => {
    if (!reporte.length) return;
    const blob = new Blob(["dia,metodo,cantidad,total\n" + reporte.map((r) => `${r.dia},${r.metodo},${r.cantidad},${r.total}`).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `ingresos_${repDesde}_${repHasta}.csv`; a.click();
  };
  const updateCargoExtra = (i: number, field: keyof CargoExtra, val: string | number) => {
    if (!cierreModal) return;
    const updated = [...cierreModal.cargosExtra]; updated[i] = { ...updated[i], [field]: val };
    setCierreModal({ ...cierreModal, cargosExtra: updated });
  };

  // Edicion de consumos
  const toggleConsumos = async (epId: number) => {
    if (consumosPorEp[epId] !== undefined) {
      setConsumosPorEp((prev) => { const n = { ...prev }; delete n[epId]; return n; });
      setEditInline(null);
    } else {
      try {
        const r = await api.get<{ data: ConsumoPend[] }>(`/api/facturacion/episodios/${epId}/consumos-pendientes`);
        setConsumosPorEp((prev) => ({ ...prev, [epId]: r.data }));
      } catch { alert("Error al cargar consumos"); }
    }
  };
  const recargarConsumos = async (epId: number) => {
    const r = await api.get<{ data: ConsumoPend[] }>(`/api/facturacion/episodios/${epId}/consumos-pendientes`);
    setConsumosPorEp((prev) => ({ ...prev, [epId]: r.data }));
  };
  const guardarEdicionSimple = async (c: ConsumoPend, epId: number) => {
    if (!editInline || editInline.consumoId !== c.id) return;
    try {
      await api.put(`/api/facturacion/consumos/${c.id}`, { nueva_cantidad: Number(editInline.cantidad), nuevo_precio: Number(editInline.precio) });
      setEditInline(null); await recargarConsumos(epId); loadCola();
    } catch (e: any) { alert(e.message ?? "Error"); }
  };
  const abrirEditarLote = async (consumo: ConsumoPend, epId: number) => {
    try {
      const r = await api.get<{ data: LoteDisp[]; lote_actual_id: number | null }>(`/api/facturacion/consumos/${consumo.id}/lotes-producto`);
      setEditLoteModal({ consumo, epId, cantidad: String(consumo.cantidad), lotes: r.data, loteId: r.lote_actual_id, justificacion: "" });
    } catch { alert("Error al cargar lotes"); }
  };
  const confirmarEditarLote = async () => {
    if (!editLoteModal) return;
    if (editLoteModal.justificacion.trim().length < 15) { alert("La justificacion debe tener al menos 15 caracteres"); return; }
    try {
      await api.put(`/api/facturacion/consumos/${editLoteModal.consumo.id}`, { nueva_cantidad: Number(editLoteModal.cantidad), ajuste_lote_id: editLoteModal.loteId, justificacion: editLoteModal.justificacion });
      const epId = editLoteModal.epId; setEditLoteModal(null);
      await recargarConsumos(epId); loadCola();
    } catch (e: any) { alert(e.message ?? "Error"); }
  };

  // Live total calculation for cierre modal
  const calcTotalesCierre = (m: CierreModal) => {
    const r = m.resumen;
    let subtotalCats = 0;
    if (r) {
      for (const cat of r.categorias) {
        const d = m.descPorCat[cat.categoria];
        const neto = Number(cat.subtotal) - (d ? calcDescMonto(Number(cat.subtotal), d) : 0);
        subtotalCats += neto;
      }
    } else {
      subtotalCats = Number(m.ep.cargos_consumos);
    }
    const subtotalHab = r ? Number(r.habitacion?.subtotal ?? 0) : Number(m.ep.cargos_habitacion);
    const subtotalExtra = m.cargosExtra.reduce((s, ce) => s + ce.cant * ce.precio, 0);
    const subtotalBruto = subtotalCats + subtotalHab + subtotalExtra;
    const descGlobalCalc = calcDescMonto(subtotalBruto, m.descGlobal);
    const subtotalNeto = subtotalBruto - descGlobalCalc;
    const iva = subtotalNeto * m.ivaPct / 100;
    return { subtotalBruto, descGlobalCalc, subtotalNeto, iva, total: subtotalNeto + iva };
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Facturacion</h1>

      <div className="flex gap-1 border-b">
        {(["cola", "facturas", "reporte"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t === "cola" ? "Cola de alta" : t === "facturas" ? "Facturas emitidas" : "Reporte de ingresos"}
            {t === "cola" && altaPend.length > 0 && (
              <span className="ml-2 bg-amber-500 text-white text-xs px-1.5 rounded-full">{altaPend.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "cola" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-sm text-slate-500">Pacientes con alta solicitada pendientes de revision y facturacion.</p>
            <button className="btn-secondary text-xs" onClick={loadCola}>Refrescar</button>
          </div>
          {!altaPend.length && <div className="card text-sm text-slate-500">No hay pacientes en cola de alta.</div>}
          {altaPend.map((ep) => {
            const bloqueado = ep.devoluciones_pendientes > 0 || ep.requisiciones_activas > 0;
            const total = Number(ep.cargos_consumos) + Number(ep.cargos_habitacion);
            const consumosAbiertos = consumosPorEp[ep.episodio_id];
            return (
              <div key={ep.episodio_id} className={`card border-l-4 ${bloqueado ? "border-red-400" : "border-amber-400"}`}>
                <div className="flex justify-between items-start flex-wrap gap-2">
                  <div>
                    <div className="font-semibold text-lg">{ep.nombres} {ep.apellidos}</div>
                    <div className="text-xs text-slate-500">Exp: {ep.expediente} — Episodio #{ep.episodio_id}</div>
                    <div className="text-xs mt-1">
                      {ep.habitacion ? <span>Habitacion <strong>{ep.habitacion}</strong> ({ep.habitacion_tipo})</span> : <span className="text-slate-400">Sin habitacion</span>}
                      {ep.medico_cabecera && <span className="ml-3 text-slate-500">Dr/a. {ep.medico_cabecera}</span>}
                    </div>
                    <div className="text-xs text-slate-500">Ingreso: {ep.fecha_inicio} — Alta solicitada: {ep.alta_solicitada_en}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-slate-800">${total.toFixed(2)}</div>
                    <div className="text-xs text-slate-500">Consumos: ${Number(ep.cargos_consumos).toFixed(2)}</div>
                    <div className="text-xs text-slate-500">Habitacion est.: ${Number(ep.cargos_habitacion).toFixed(2)}</div>
                  </div>
                </div>

                {/* Edicion consumos */}
                <div className="mt-2 border-t pt-2">
                  <button className="text-xs text-blue-600 hover:underline" onClick={() => toggleConsumos(ep.episodio_id)}>
                    {consumosAbiertos !== undefined ? "Ocultar cargos" : "Ver / Editar cargos"}
                  </button>
                  {consumosAbiertos !== undefined && (
                    <div className="mt-2 space-y-1">
                      {!consumosAbiertos.length && <div className="text-xs text-slate-400">Sin consumos pendientes</div>}
                      {consumosAbiertos.map((c) => {
                        const editando = editInline?.consumoId === c.id;
                        const esLote = c.requiere_lote_vencimiento === 1;
                        return (
                          <div key={c.id} className="flex items-start gap-2 text-xs bg-slate-50 rounded p-2">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{c.producto}</div>
                              <div className="text-slate-400">{c.codigo}</div>
                              {c.lote_numero && <div className="text-slate-400">Lote: {c.lote_numero} — Vence: {c.lote_vencimiento}</div>}
                            </div>
                            {esLote ? (
                              <div className="shrink-0 text-right">
                                <div className="text-slate-600">{c.cantidad} × ${Number(c.precio_venta_snapshot).toFixed(2)}</div>
                                <button className="text-blue-600 hover:underline mt-0.5" onClick={() => abrirEditarLote(c, ep.episodio_id)}>Editar</button>
                              </div>
                            ) : editando ? (
                              <div className="shrink-0 flex flex-col gap-1 items-end">
                                <div className="flex gap-1">
                                  <input className="input w-16 text-xs text-center" type="number" step="0.01" min="0.01" value={editInline.cantidad} onChange={(e) => setEditInline({ ...editInline, cantidad: e.target.value })} placeholder="Cant" />
                                  <input className="input w-20 text-xs" type="number" step="0.01" min="0" value={editInline.precio} onChange={(e) => setEditInline({ ...editInline, precio: e.target.value })} placeholder="Precio" />
                                </div>
                                <div className="flex gap-1">
                                  <button className="btn text-xs py-0.5 px-2" onClick={() => guardarEdicionSimple(c, ep.episodio_id)}>Guardar</button>
                                  <button className="btn-secondary text-xs py-0.5 px-2" onClick={() => setEditInline(null)}>Cancelar</button>
                                </div>
                              </div>
                            ) : (
                              <div className="shrink-0 text-right">
                                <div className="text-slate-600">{c.cantidad} × ${Number(c.precio_venta_snapshot).toFixed(2)}</div>
                                <button className="text-blue-600 hover:underline mt-0.5" onClick={() => setEditInline({ consumoId: c.id, cantidad: String(c.cantidad), precio: String(c.precio_venta_snapshot) })}>Editar</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {bloqueado && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 space-y-0.5">
                    <div className="font-medium">Bloqueado — resolver antes de facturar:</div>
                    {ep.devoluciones_pendientes > 0 && <div>• {ep.devoluciones_pendientes} devolucion(es) pendiente(s) de procesar en farmacia</div>}
                    {ep.requisiciones_activas > 0 && <div>• {ep.requisiciones_activas} requisicion(es) activa(s) sin completar</div>}
                  </div>
                )}
                {!bloqueado && (
                  <div className="mt-3 flex justify-end">
                    <button className="btn" onClick={() => abrirCierre(ep)}>Revisar y facturar</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "facturas" && (
        <div className="card overflow-auto">
          <div className="flex justify-end mb-2">
            <button className="btn-secondary text-xs" onClick={loadFacturas}>Refrescar</button>
          </div>
          <table className="table">
            <thead><tr><th>Numero</th><th>Fecha</th><th>Paciente</th><th>Total</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.id}>
                  <td>{f.numero}</td><td>{f.fecha}</td><td>{f.paciente}</td>
                  <td>${Number(f.total).toFixed(2)}</td>
                  <td><span className={`px-1.5 py-0.5 rounded text-xs ${f.estado === "pagada" ? "bg-green-100 text-green-700" : f.estado === "anulada" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{f.estado}</span></td>
                  <td className="space-x-1">
                    <button className="btn-secondary text-xs" onClick={() => abrir(f.id)}>Ver</button>
                    {f.estado === "pendiente" && <button className="btn text-xs" onClick={() => abrirPago(f.id, f.total)}>Pago</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "reporte" && (
        <div className="card space-y-3">
          <div className="flex gap-2 items-end flex-wrap">
            <div><label className="text-xs">Desde</label><input className="input" type="date" value={repDesde} onChange={(e) => setRepDesde(e.target.value)} /></div>
            <div><label className="text-xs">Hasta</label><input className="input" type="date" value={repHasta} onChange={(e) => setRepHasta(e.target.value)} /></div>
            <button className="btn-secondary" onClick={verReporte}>Generar</button>
            {!!reporte.length && <button className="btn-secondary" onClick={exportarCSV}>Exportar CSV</button>}
          </div>
          {!!reporte.length && (
            <table className="table"><thead><tr><th>Dia</th><th>Metodo</th><th>Cantidad</th><th>Total</th></tr></thead>
              <tbody>{reporte.map((r, i) => <tr key={i}><td>{r.dia}</td><td>{r.metodo}</td><td>{r.cantidad}</td><td>${Number(r.total).toFixed(2)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}

      {/* ===== Modal revisión y cierre ===== */}
      {cierreModal && (() => {
        const m = cierreModal;
        const totales = calcTotalesCierre(m);
        const r = m.resumen;
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="card w-full max-w-2xl space-y-4 max-h-[92vh] overflow-auto">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="font-semibold text-lg">Revisar y facturar</h2>
                  <div className="text-sm text-slate-500">{m.ep.nombres} {m.ep.apellidos} — Episodio #{m.ep.episodio_id}</div>
                </div>
                <button className="btn-secondary" onClick={() => setCierreModal(null)}>Cancelar</button>
              </div>

              {/* Resumen por categoria */}
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Resumen por categoria</div>
                {m.resumenLoading ? (
                  <div className="text-sm text-slate-400 py-3 text-center">Cargando resumen...</div>
                ) : r ? (
                  <div className="space-y-1">
                    {r.categorias.map((cat) => {
                      const d = m.descPorCat[cat.categoria] ?? { tipo: "pct" as const, valor: "" };
                      const descCalc = calcDescMonto(Number(cat.subtotal), d);
                      const neto = Number(cat.subtotal) - descCalc;
                      return (
                        <div key={cat.categoria} className="rounded border bg-slate-50 p-2">
                          <div className="flex justify-between items-center">
                            <div className="font-medium text-sm">{cat.categoria}</div>
                            <div className="text-sm font-semibold">${Number(cat.subtotal).toFixed(2)}</div>
                          </div>
                          <div className="text-xs text-slate-400 mb-1">{cat.items} item(s)</div>
                          <div className="flex items-center gap-2">
                            <select
                              className="input text-xs w-20 py-1"
                              value={d.tipo}
                              onChange={(e) => setCierreModal({ ...m, descPorCat: { ...m.descPorCat, [cat.categoria]: { ...d, tipo: e.target.value as "pct" | "monto" } } })}
                            >
                              <option value="pct">%</option>
                              <option value="monto">$</option>
                            </select>
                            <input
                              className="input text-xs w-24 py-1"
                              type="number" step="0.01" min="0"
                              placeholder={d.tipo === "pct" ? "Desc %" : "Desc $"}
                              value={d.valor}
                              onChange={(e) => setCierreModal({ ...m, descPorCat: { ...m.descPorCat, [cat.categoria]: { ...d, valor: e.target.value } } })}
                            />
                            {descCalc > 0 && (
                              <span className="text-xs text-amber-700 ml-auto">
                                -${descCalc.toFixed(2)} → <span className="font-semibold">${neto.toFixed(2)}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {(r.habitacion?.subtotal ?? 0) > 0 && (
                      <div className="rounded border bg-slate-50 p-2 flex justify-between items-center">
                        <div>
                          <div className="font-medium text-sm">Habitacion</div>
                          <div className="text-xs text-slate-400">{r.habitacion?.registros} registro(s) (est.)</div>
                        </div>
                        <div className="text-sm font-semibold">${Number(r.habitacion?.subtotal ?? 0).toFixed(2)}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-slate-50 border p-3">
                      <div className="text-xs text-slate-500">Consumos</div>
                      <div className="text-lg font-semibold">${Number(m.ep.cargos_consumos).toFixed(2)}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 border p-3">
                      <div className="text-xs text-slate-500">Habitacion (est.)</div>
                      <div className="text-lg font-semibold">${Number(m.ep.cargos_habitacion).toFixed(2)}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Cargos extra */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-medium">Cargos adicionales</label>
                  <button className="text-xs text-blue-600 hover:underline"
                    onClick={() => setCierreModal({ ...m, cargosExtra: [...m.cargosExtra, { desc: "", cant: 1, precio: 0 }] })}>
                    + Agregar
                  </button>
                </div>
                {m.cargosExtra.map((ce, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1 mb-1">
                    <input className="input col-span-6" placeholder="Descripcion" value={ce.desc} onChange={(e) => updateCargoExtra(i, "desc", e.target.value)} />
                    <input className="input col-span-2 text-center" type="number" placeholder="Cant" value={ce.cant} onChange={(e) => updateCargoExtra(i, "cant", Number(e.target.value))} />
                    <input className="input col-span-3" type="number" step="0.01" placeholder="Precio" value={ce.precio} onChange={(e) => updateCargoExtra(i, "precio", Number(e.target.value))} />
                    <button className="btn-secondary col-span-1 text-xs" onClick={() => setCierreModal({ ...m, cargosExtra: m.cargosExtra.filter((_, idx) => idx !== i) })}>x</button>
                  </div>
                ))}
              </div>

              {/* IVA + Descuento global */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">IVA %</label>
                  <input className="input" type="number" step="0.01" value={m.ivaPct}
                    onChange={(e) => setCierreModal({ ...m, ivaPct: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-xs font-medium">Descuento global</label>
                  <div className="flex gap-1">
                    <select className="input text-xs w-16 py-1" value={m.descGlobal.tipo}
                      onChange={(e) => setCierreModal({ ...m, descGlobal: { ...m.descGlobal, tipo: e.target.value as "pct" | "monto" } })}>
                      <option value="pct">%</option>
                      <option value="monto">$</option>
                    </select>
                    <input className="input flex-1" type="number" step="0.01" min="0"
                      placeholder={m.descGlobal.tipo === "pct" ? "Desc %" : "Desc $"}
                      value={m.descGlobal.valor}
                      onChange={(e) => setCierreModal({ ...m, descGlobal: { ...m.descGlobal, valor: e.target.value } })} />
                  </div>
                </div>
              </div>

              {/* Resumen totales */}
              <div className="rounded-lg bg-slate-50 border p-3 text-sm space-y-1">
                {totales.descGlobalCalc > 0 && (
                  <>
                    <div className="flex justify-between text-slate-500">
                      <span>Subtotal bruto</span><span>${totales.subtotalBruto.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-amber-700">
                      <span>Descuento global</span><span>-${totales.descGlobalCalc.toFixed(2)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span>Subtotal neto</span><span>${totales.subtotalNeto.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>IVA ({m.ivaPct}%)</span><span>${totales.iva.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-base border-t pt-1 mt-1">
                  <span>Total</span><span>${totales.total.toFixed(2)}</span>
                </div>
              </div>

              <div className="border-t pt-3 flex justify-between items-center gap-3">
                <p className="text-xs text-amber-700">Se egresara la habitacion, se generara la factura y se cerrara el episodio.</p>
                <button className="btn shrink-0" onClick={confirmarCierre}>Confirmar y facturar</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== Factura creada — opciones PDF ===== */}
      {facturaCreada && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-sm space-y-4 text-center">
            <div className="text-green-600 text-3xl font-bold">✓</div>
            <div className="font-semibold text-lg">Factura emitida</div>
            <div className="text-sm text-slate-600">{facturaCreada.numero} — Total: <strong>${Number(facturaCreada.total).toFixed(2)}</strong></div>
            <div className="space-y-2">
              <a
                className="btn block text-center"
                href={`/facturas/${facturaCreada.id}/print-detalle`}
                target="_blank" rel="noreferrer"
              >
                Detalle completo (PDF)
              </a>
              <a
                className="btn-secondary block text-center"
                href={`/facturas/${facturaCreada.id}/print-resumen`}
                target="_blank" rel="noreferrer"
              >
                Resumen por categoria (PDF)
              </a>
              <button className="btn-secondary w-full" onClick={() => setFacturaCreada(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal edicion lote */}
      {editLoteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md space-y-4">
            <div className="flex justify-between items-start">
              <h2 className="font-semibold">Editar cargo con lote</h2>
              <button className="btn-secondary" onClick={() => setEditLoteModal(null)}>Cancelar</button>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-300 rounded text-xs text-amber-800 space-y-1">
              <div className="font-semibold">Advertencia</div>
              <div>Esta modificacion contraviene las buenas practicas si no cuenta con el producto fisico a ajustar. La operacion tambien afecta el inventario.</div>
            </div>
            <div className="text-sm"><div className="font-medium">{editLoteModal.consumo.producto}</div><div className="text-slate-500 text-xs">{editLoteModal.consumo.codigo}</div></div>
            <div>
              <label className="text-xs font-medium">Lote para el ajuste</label>
              <select className="input" value={editLoteModal.loteId ?? ""} onChange={(e) => setEditLoteModal({ ...editLoteModal, loteId: Number(e.target.value) || null })}>
                <option value="">— Seleccionar lote —</option>
                {editLoteModal.lotes.map((l) => (<option key={l.id} value={l.id}>{l.numero_lote} — Vence: {l.fecha_vencimiento} (stock: {Number(l.stock_total).toFixed(2)})</option>))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Nueva cantidad <span className="text-slate-400">(actual: {editLoteModal.consumo.cantidad})</span></label>
              <input className="input" type="number" step="0.01" min="0.01" value={editLoteModal.cantidad} onChange={(e) => setEditLoteModal({ ...editLoteModal, cantidad: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium">Justificacion <span className={editLoteModal.justificacion.trim().length >= 15 ? "text-green-600" : "text-red-500"}>({editLoteModal.justificacion.trim().length}/15 min)</span></label>
              <textarea className="input min-h-[70px]" placeholder="Describa el motivo del ajuste..." value={editLoteModal.justificacion} onChange={(e) => setEditLoteModal({ ...editLoteModal, justificacion: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditLoteModal(null)}>Cancelar</button>
              <button className="btn" disabled={!editLoteModal.loteId || editLoteModal.justificacion.trim().length < 15 || !Number(editLoteModal.cantidad) || Number(editLoteModal.cantidad) <= 0} onClick={confirmarEditarLote}>Guardar ajuste</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal pago */}
      {pagoModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-sm space-y-3">
            <h2 className="font-semibold">Registrar pago</h2>
            <div><label className="text-xs font-medium">Metodo</label>
              <select className="input" value={pagoForm.metodo} onChange={(e) => setPagoForm({ ...pagoForm, metodo: e.target.value })}>
                <option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option><option value="otro">Otro</option>
              </select>
            </div>
            <div><label className="text-xs font-medium">Monto</label><input className="input" type="number" step="0.01" value={pagoForm.monto} onChange={(e) => setPagoForm({ ...pagoForm, monto: e.target.value })} /></div>
            <div><label className="text-xs font-medium">Referencia (opcional)</label><input className="input" value={pagoForm.referencia} onChange={(e) => setPagoForm({ ...pagoForm, referencia: e.target.value })} /></div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setPagoModal(null)}>Cancelar</button>
              <button className="btn" onClick={confirmarPago}>Registrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal detalle factura */}
      {detalle && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-3xl space-y-3 max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="font-semibold">Factura {detalle.factura.numero}</h2>
                <div className="text-sm text-slate-500">{detalle.factura.fecha} — Estado: {detalle.factura.estado}</div>
              </div>
              <button className="btn-secondary" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
            <table className="table">
              <thead><tr><th>Descripcion</th><th>Cant</th><th>Precio</th><th>Subtotal</th></tr></thead>
              <tbody>
                {detalle.detalles.map((d) => (
                  <tr key={d.id} className={Number(d.subtotal) < 0 ? "text-amber-700 italic" : ""}>
                    <td>{d.descripcion}</td><td>{d.cantidad}</td>
                    <td>${Number(d.precio_unitario).toFixed(2)}</td>
                    <td>${Number(d.subtotal).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3} className="text-right font-medium">Subtotal</td><td>${Number(detalle.factura.subtotal).toFixed(2)}</td></tr>
                <tr><td colSpan={3} className="text-right font-medium">IVA</td><td>${Number(detalle.factura.iva).toFixed(2)}</td></tr>
                <tr><td colSpan={3} className="text-right font-semibold">Total</td><td className="font-semibold">${Number(detalle.factura.total).toFixed(2)}</td></tr>
              </tfoot>
            </table>
            <h3 className="font-semibold">Pagos</h3>
            {!detalle.pagos.length ? <div className="text-sm text-slate-500">Sin pagos registrados</div> : (
              <table className="table">
                <thead><tr><th>Fecha</th><th>Metodo</th><th>Monto</th><th>Referencia</th></tr></thead>
                <tbody>{detalle.pagos.map((p) => (<tr key={p.id}><td>{p.fecha}</td><td>{p.metodo}</td><td>${Number(p.monto).toFixed(2)}</td><td>{p.referencia ?? "-"}</td></tr>))}</tbody>
              </table>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {detalle.factura.estado === "pendiente" && (
                <button className="btn" onClick={() => { setDetalle(null); abrirPago(detalle.factura.id, detalle.factura.total); }}>Registrar pago</button>
              )}
              {detalle.factura.estado !== "anulada" && (
                <button className="btn-danger" onClick={() => anular(detalle.factura.id)}>Anular</button>
              )}
              <a className="btn-secondary" target="_blank" rel="noreferrer" href={`/facturas/${detalle.factura.id}/print-detalle`}>PDF Detalle</a>
              <a className="btn-secondary" target="_blank" rel="noreferrer" href={`/facturas/${detalle.factura.id}/print-resumen`}>PDF Resumen</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
