import { useEffect, useState } from "react";
import { api } from "../lib/api";

/* ── tipos ── */
type CuentaPagar = {
  id: number; proveedor_nombre: string; concepto: string; monto: number;
  fecha_emision: string; fecha_vencimiento?: string; estado: string; estado_real: string;
  dias_vencido?: number; referencia_pago?: string; fecha_pago?: string;
};
type AgingCP = { corriente: number; d0_30: number; d31_60: number; d61_90: number; mas90: number; total: number };
type Deposito = {
  id: number; paciente_nombre: string; expediente: string; monto: number;
  fecha: string; concepto?: string; aplicado: number;
};
type NotaCredito = { id: number; factura_numero: string; numero: string; monto: number; motivo: string; creado_en: string };
type CierreCaja  = { id: number; usuario_nombre: string; fecha_inicio: string; fecha_fin: string; efectivo_apertura: number; efectivo_cierre: number; total_cobrado: number; observaciones?: string };
type EstadoRes   = { periodo: { desde: string; hasta: string }; ingresos: number; cogs: number; utilidad_bruta: number; gastos_operativos: number; utilidad_operativa: number; honorarios_paso: number; nota: string };
type Proveedor   = { id: number; nombre: string };
type Factura     = { id: number; numero_factura: string };
type Paciente    = { id: number; expediente: string; nombres: string; apellidos: string };

function fmt(n: number) { return `$${n.toFixed(2)}`; }
function mesActual() {
  const hoy = new Date();
  return {
    desde: new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10),
    hasta: hoy.toISOString().slice(0, 10),
  };
}

export default function Finanzas() {
  const [tab, setTab] = useState<"cp" | "depositos" | "nc" | "caja" | "resultados">("cp");

  /* ── CxP ── */
  const [cuentas,    setCuentas]    = useState<CuentaPagar[]>([]);
  const [aging,      setAging]      = useState<AgingCP | null>(null);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cpModal,    setCpModal]    = useState(false);
  const [cpForm,     setCpForm]     = useState({ proveedor_id: "", concepto: "", monto: "", fecha_emision: new Date().toISOString().slice(0, 10), fecha_vencimiento: "", notas: "" });
  const [pagarModal, setPagarModal] = useState<CuentaPagar | null>(null);
  const [refPago,    setRefPago]    = useState("");
  const [filtroCpEstado, setFiltroCpEstado] = useState("pendiente");

  /* ── Depósitos ── */
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [depModal,  setDepModal]  = useState(false);
  const [depForm,   setDepForm]   = useState({ paciente_id: "", monto: "", fecha: new Date().toISOString().slice(0, 10), concepto: "" });
  const [pacDeposQ, setPacDeposQ] = useState("");
  const [pacDeposOpts, setPacDeposOpts] = useState<Paciente[]>([]);

  /* ── Notas Crédito ── */
  const [notas,    setNotas]    = useState<NotaCredito[]>([]);
  const [ncModal,  setNcModal]  = useState(false);
  const [ncForm,   setNcForm]   = useState({ factura_id: "", monto: "", motivo: "" });
  const [factBusqQ, setFactBusqQ] = useState("");
  const [factOpts,  setFactOpts]  = useState<Factura[]>([]);

  /* ── Caja ── */
  const [cierres,    setCierres]    = useState<CierreCaja[]>([]);
  const [cajaModal,  setCajaModal]  = useState(false);
  const [cajaForm,   setCajaForm]   = useState({ efectivo_apertura: "", efectivo_cierre: "", observaciones: "" });

  /* ── Estado de Resultados ── */
  const [erPeriodo, setErPeriodo] = useState(mesActual());
  const [er,        setEr]        = useState<EstadoRes | null>(null);
  const [erLoading, setErLoading] = useState(false);

  const [loading, setLoading] = useState(false);

  useEffect(() => { cargarTab(tab); }, [tab]);

  async function cargarTab(t: typeof tab) {
    setLoading(true);
    if (t === "cp") {
      const [c, a, p] = await Promise.all([
        api.get<CuentaPagar[]>(`/api/finanzas/cuentas-pagar?estado=${filtroCpEstado}`).catch(() => [] as CuentaPagar[]),
        api.get<AgingCP>("/api/finanzas/cuentas-pagar/_aging").catch(() => null),
        api.get<Proveedor[]>("/api/catalogos/proveedores").catch(() => [] as Proveedor[]),
      ]);
      setCuentas(c); setAging(a); setProveedores(p);
    } else if (t === "depositos") {
      setDepositos(await api.get<Deposito[]>("/api/finanzas/depositos").catch(() => [] as Deposito[]));
    } else if (t === "nc") {
      setNotas(await api.get<NotaCredito[]>("/api/finanzas/notas-credito").catch(() => [] as NotaCredito[]));
    } else if (t === "caja") {
      setCierres(await api.get<CierreCaja[]>("/api/finanzas/cierre-caja").catch(() => [] as CierreCaja[]));
    } else if (t === "resultados") {
      await cargarER();
    }
    setLoading(false);
  }

  async function cargarER() {
    setErLoading(true);
    const r = await api.get<EstadoRes>(`/api/finanzas/estado-resultados?desde=${erPeriodo.desde}&hasta=${erPeriodo.hasta}`).catch(() => null);
    setEr(r); setErLoading(false);
  }

  /* CxP */
  async function guardarCP(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/api/finanzas/cuentas-pagar", { ...cpForm, proveedor_id: +cpForm.proveedor_id, monto: +cpForm.monto });
    setCpModal(false);
    setCpForm({ proveedor_id: "", concepto: "", monto: "", fecha_emision: new Date().toISOString().slice(0, 10), fecha_vencimiento: "", notas: "" });
    cargarTab("cp");
  }
  async function confirmarPago() {
    if (!pagarModal) return;
    await api.post(`/api/finanzas/cuentas-pagar/${pagarModal.id}/pagar`, { referencia: refPago });
    setPagarModal(null); setRefPago(""); cargarTab("cp");
  }

  /* Depósitos */
  async function buscarPacDep(q: string) {
    setPacDeposQ(q);
    if (q.length < 2) { setPacDeposOpts([]); return; }
    const r = await api.get<Paciente[]>(`/api/pacientes?q=${encodeURIComponent(q)}&limit=8`).catch(() => [] as Paciente[]);
    setPacDeposOpts(r);
  }
  async function guardarDeposito(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/api/finanzas/depositos", { ...depForm, paciente_id: +depForm.paciente_id, monto: +depForm.monto });
    setDepModal(false);
    setDepForm({ paciente_id: "", monto: "", fecha: new Date().toISOString().slice(0, 10), concepto: "" });
    setPacDeposQ(""); setPacDeposOpts([]);
    cargarTab("depositos");
  }

  /* NC */
  async function buscarFactura(q: string) {
    setFactBusqQ(q);
    if (q.length < 2) { setFactOpts([]); return; }
    const r = await api.get<{ results: Factura[] }>(`/api/facturacion/facturas?q=${encodeURIComponent(q)}&limit=10`).catch(() => ({ results: [] as Factura[] }));
    setFactOpts(r.results ?? []);
  }
  async function guardarNC(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/api/finanzas/notas-credito", { ...ncForm, factura_id: +ncForm.factura_id, monto: +ncForm.monto });
    setNcModal(false);
    setNcForm({ factura_id: "", monto: "", motivo: "" });
    setFactBusqQ(""); setFactOpts([]);
    cargarTab("nc");
  }

  /* Caja */
  async function guardarCierre(e: React.FormEvent) {
    e.preventDefault();
    const r = await api.post<{ total_cobrado: number }>("/api/finanzas/cierre-caja", {
      efectivo_apertura: +cajaForm.efectivo_apertura,
      efectivo_cierre:   +cajaForm.efectivo_cierre,
      observaciones: cajaForm.observaciones,
    });
    alert(`Arqueo registrado. Total cobrado en el período: ${fmt(r.total_cobrado)}`);
    setCajaModal(false);
    setCajaForm({ efectivo_apertura: "", efectivo_cierre: "", observaciones: "" });
    cargarTab("caja");
  }

  const tabs = [
    { k: "cp",          label: "Cuentas por pagar" },
    { k: "depositos",   label: "Depósitos pacientes" },
    { k: "nc",          label: "Notas de crédito" },
    { k: "caja",        label: "Arqueo de caja" },
    { k: "resultados",  label: "Estado de resultados" },
  ] as const;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Finanzas</h1>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.k ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ════ CUENTAS POR PAGAR ════ */}
      {tab === "cp" && (
        <div className="space-y-4">
          {/* Aging */}
          {aging && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
              {[
                { label: "Corriente",  v: aging.corriente, color: "bg-green-50 text-green-700" },
                { label: "1-30 días",  v: aging.d0_30,    color: "bg-amber-50 text-amber-700" },
                { label: "31-60 días", v: aging.d31_60,   color: "bg-orange-50 text-orange-700" },
                { label: "61-90 días", v: aging.d61_90,   color: "bg-red-100 text-red-700" },
                { label: "> 90 días",  v: aging.mas90,    color: "bg-red-200 text-red-900" },
              ].map((a) => (
                <div key={a.label} className={`${a.color} rounded-lg p-3`}>
                  <div className="text-base font-bold">{fmt(a.v)}</div>
                  <div>{a.label}</div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <select className="input-sm" value={filtroCpEstado} onChange={(e) => { setFiltroCpEstado(e.target.value); }}>
              <option value="pendiente">Pendientes</option>
              <option value="pagada">Pagadas</option>
            </select>
            <button onClick={() => cargarTab("cp")} className="btn-secondary text-xs">Actualizar</button>
            <button onClick={() => setCpModal(true)} className="btn-primary text-sm ml-auto">+ Nueva CxP</button>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-slate-600 text-xs">
                {["Proveedor", "Concepto", "Monto", "Emisión", "Vence", "Estado", ""].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={7} className="p-4 text-center text-slate-400">Cargando...</td></tr> :
                  cuentas.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium">{c.proveedor_nombre}</td>
                      <td className="px-3 py-2">{c.concepto}</td>
                      <td className="px-3 py-2 font-mono">{fmt(c.monto)}</td>
                      <td className="px-3 py-2">{c.fecha_emision}</td>
                      <td className={`px-3 py-2 ${(c.dias_vencido ?? 0) > 0 && c.estado === "pendiente" ? "text-red-600 font-medium" : ""}`}>
                        {c.fecha_vencimiento ?? "—"}
                        {(c.dias_vencido ?? 0) > 0 && c.estado === "pendiente" && <span className="ml-1 text-xs">({c.dias_vencido}d)</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${c.estado_real === "vencida" ? "bg-red-100 text-red-700" : c.estado === "pagada" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                          {c.estado_real ?? c.estado}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {c.estado === "pendiente" && (
                          <button onClick={() => { setPagarModal(c); setRefPago(""); }} className="text-blue-600 hover:underline text-xs">Pagar</button>
                        )}
                      </td>
                    </tr>
                  ))
                }
                {!loading && cuentas.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-400">Sin cuentas</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════ DEPÓSITOS ════ */}
      {tab === "depositos" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setDepModal(true)} className="btn-primary text-sm">+ Registrar depósito</button>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-slate-600 text-xs">
                {["Paciente", "Expediente", "Monto", "Fecha", "Concepto", "Estado"].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {depositos.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">{d.paciente_nombre}</td>
                    <td className="px-3 py-2 font-mono text-xs">{d.expediente}</td>
                    <td className="px-3 py-2 font-mono">{fmt(d.monto)}</td>
                    <td className="px-3 py-2">{d.fecha}</td>
                    <td className="px-3 py-2 text-slate-500">{d.concepto ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${d.aplicado ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                        {d.aplicado ? "Aplicado" : "Disponible"}
                      </span>
                    </td>
                  </tr>
                ))}
                {depositos.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">Sin depósitos</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════ NOTAS DE CRÉDITO ════ */}
      {tab === "nc" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setNcModal(true)} className="btn-primary text-sm">+ Nueva nota de crédito</button>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-slate-600 text-xs">
                {["Número", "Factura original", "Monto", "Motivo", "Fecha"].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {notas.map((n) => (
                  <tr key={n.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{n.numero}</td>
                    <td className="px-3 py-2">{n.factura_numero}</td>
                    <td className="px-3 py-2 font-mono">{fmt(n.monto)}</td>
                    <td className="px-3 py-2 text-slate-600">{n.motivo}</td>
                    <td className="px-3 py-2">{n.creado_en.slice(0, 10)}</td>
                  </tr>
                ))}
                {notas.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-400">Sin notas de crédito</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════ ARQUEO DE CAJA ════ */}
      {tab === "caja" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setCajaModal(true)} className="btn-primary text-sm">+ Cerrar turno</button>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-slate-600 text-xs">
                {["Usuario", "Inicio turno", "Fin turno", "Apertura", "Cierre", "Cobrado", "Diferencia"].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {cierres.map((c) => {
                  const dif = c.efectivo_cierre - c.efectivo_apertura - c.total_cobrado;
                  return (
                    <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">{c.usuario_nombre}</td>
                      <td className="px-3 py-2 text-xs">{new Date(c.fecha_inicio).toLocaleString("es-SV")}</td>
                      <td className="px-3 py-2 text-xs">{new Date(c.fecha_fin).toLocaleString("es-SV")}</td>
                      <td className="px-3 py-2 font-mono">{fmt(c.efectivo_apertura)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(c.efectivo_cierre)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(c.total_cobrado)}</td>
                      <td className={`px-3 py-2 font-mono font-semibold ${dif < 0 ? "text-red-600" : dif > 0 ? "text-green-600" : "text-slate-600"}`}>
                        {fmt(dif)}
                      </td>
                    </tr>
                  );
                })}
                {cierres.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-400">Sin cierres</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════ ESTADO DE RESULTADOS ════ */}
      {tab === "resultados" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 card p-4">
            <div>
              <label className="label-sm">Desde</label>
              <input type="date" className="input-sm" value={erPeriodo.desde} onChange={(e) => setErPeriodo((p) => ({ ...p, desde: e.target.value }))} />
            </div>
            <div>
              <label className="label-sm">Hasta</label>
              <input type="date" className="input-sm" value={erPeriodo.hasta} onChange={(e) => setErPeriodo((p) => ({ ...p, hasta: e.target.value }))} />
            </div>
            <button onClick={cargarER} className="btn-primary text-sm">Calcular</button>
          </div>

          {erLoading && <div className="text-slate-400 text-sm p-4">Calculando...</div>}
          {!erLoading && er && (
            <div className="card p-6 max-w-md space-y-3">
              <h2 className="font-semibold text-slate-700">Período: {er.periodo.desde} → {er.periodo.hasta}</h2>
              <div className="space-y-2 text-sm">
                {[
                  { label: "Ingresos facturados",  v: er.ingresos,            bold: false, border: false },
                  { label: "(-) Costo mercancía",  v: -er.cogs,               bold: false, border: false },
                  { label: "Utilidad bruta",        v: er.utilidad_bruta,      bold: true,  border: true  },
                  { label: "(-) Gastos operativos", v: -er.gastos_operativos,  bold: false, border: false },
                  { label: "UTILIDAD OPERATIVA",    v: er.utilidad_operativa,  bold: true,  border: true  },
                ].map((row) => (
                  <div key={row.label} className={`flex justify-between ${row.border ? "border-t border-slate-200 pt-2" : ""}`}>
                    <span className={`${row.bold ? "font-semibold text-slate-800" : "text-slate-600"}`}>{row.label}</span>
                    <span className={`font-mono ${row.bold ? "font-bold" : ""} ${row.v < 0 ? "text-red-600" : "text-slate-800"}`}>{fmt(row.v)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-dashed border-slate-300 pt-2 text-slate-400 text-xs">
                  <span>Honorarios médicos (paso)</span>
                  <span className="font-mono">{fmt(er.honorarios_paso)}</span>
                </div>
                <p className="text-xs text-slate-400 italic">{er.nota}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ MODALES ═══ */}

      {/* Nueva CxP */}
      {cpModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">Nueva cuenta por pagar</h2>
            <form onSubmit={guardarCP} className="space-y-3">
              <div>
                <label className="label-sm">Proveedor</label>
                <select required className="input-sm w-full" value={cpForm.proveedor_id} onChange={(e) => setCpForm((p) => ({ ...p, proveedor_id: e.target.value }))}>
                  <option value="">Seleccionar...</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="label-sm">Concepto</label>
                <input required className="input-sm w-full" value={cpForm.concepto} onChange={(e) => setCpForm((p) => ({ ...p, concepto: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-sm">Monto</label>
                  <input required type="number" step="0.01" className="input-sm w-full" value={cpForm.monto} onChange={(e) => setCpForm((p) => ({ ...p, monto: e.target.value }))} />
                </div>
                <div>
                  <label className="label-sm">Vencimiento</label>
                  <input type="date" className="input-sm w-full" value={cpForm.fecha_vencimiento} onChange={(e) => setCpForm((p) => ({ ...p, fecha_vencimiento: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setCpModal(false)} className="btn-secondary flex-1">Cancelar</button>
                <button type="submit" className="btn-primary flex-1">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmar pago CxP */}
      {pagarModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-2">Registrar pago</h2>
            <p className="text-sm text-slate-600 mb-4">{pagarModal.proveedor_nombre} — {fmt(pagarModal.monto)}</p>
            <div className="mb-4">
              <label className="label-sm">Referencia de pago</label>
              <input className="input-sm w-full" value={refPago} onChange={(e) => setRefPago(e.target.value)} placeholder="Número de cheque, transferencia, etc." />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPagarModal(null)} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={confirmarPago} className="btn-primary flex-1">Confirmar pago</button>
            </div>
          </div>
        </div>
      )}

      {/* Nuevo depósito */}
      {depModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">Registrar depósito de paciente</h2>
            <form onSubmit={guardarDeposito} className="space-y-3">
              <div className="relative">
                <label className="label-sm">Paciente</label>
                <input className="input-sm w-full" value={pacDeposQ} onChange={(e) => buscarPacDep(e.target.value)} placeholder="Buscar paciente..." />
                {pacDeposOpts.length > 0 && (
                  <ul className="absolute z-10 bg-white border border-slate-200 rounded shadow-lg w-full max-h-36 overflow-y-auto text-xs">
                    {pacDeposOpts.map((p) => (
                      <li key={p.id} className="px-3 py-2 hover:bg-blue-50 cursor-pointer"
                        onClick={() => { setDepForm((f) => ({ ...f, paciente_id: String(p.id) })); setPacDeposQ(`${p.nombres} ${p.apellidos}`); setPacDeposOpts([]); }}>
                        {p.nombres} {p.apellidos} — {p.expediente}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-sm">Monto</label>
                  <input required type="number" step="0.01" className="input-sm w-full" value={depForm.monto} onChange={(e) => setDepForm((p) => ({ ...p, monto: e.target.value }))} />
                </div>
                <div>
                  <label className="label-sm">Fecha</label>
                  <input type="date" className="input-sm w-full" value={depForm.fecha} onChange={(e) => setDepForm((p) => ({ ...p, fecha: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label-sm">Concepto</label>
                <input className="input-sm w-full" value={depForm.concepto} onChange={(e) => setDepForm((p) => ({ ...p, concepto: e.target.value }))} placeholder="Anticipo hospitalización, depósito quirófano, etc." />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setDepModal(false)} className="btn-secondary flex-1">Cancelar</button>
                <button type="submit" className="btn-primary flex-1">Registrar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Nueva nota de crédito */}
      {ncModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">Nueva nota de crédito</h2>
            <form onSubmit={guardarNC} className="space-y-3">
              <div className="relative">
                <label className="label-sm">Factura original</label>
                <input className="input-sm w-full" value={factBusqQ} onChange={(e) => buscarFactura(e.target.value)} placeholder="Buscar número de factura..." />
                {factOpts.length > 0 && (
                  <ul className="absolute z-10 bg-white border border-slate-200 rounded shadow-lg w-full max-h-36 overflow-y-auto text-xs">
                    {factOpts.map((f) => (
                      <li key={f.id} className="px-3 py-2 hover:bg-blue-50 cursor-pointer"
                        onClick={() => { setNcForm((n) => ({ ...n, factura_id: String(f.id) })); setFactBusqQ(f.numero_factura); setFactOpts([]); }}>
                        {f.numero_factura}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <label className="label-sm">Monto</label>
                <input required type="number" step="0.01" className="input-sm w-full" value={ncForm.monto} onChange={(e) => setNcForm((p) => ({ ...p, monto: e.target.value }))} />
              </div>
              <div>
                <label className="label-sm">Motivo</label>
                <input required className="input-sm w-full" value={ncForm.motivo} onChange={(e) => setNcForm((p) => ({ ...p, motivo: e.target.value }))} />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setNcModal(false)} className="btn-secondary flex-1">Cancelar</button>
                <button type="submit" className="btn-primary flex-1">Crear</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cierre de caja */}
      {cajaModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-4">Cierre de turno</h2>
            <form onSubmit={guardarCierre} className="space-y-3">
              <div>
                <label className="label-sm">Efectivo apertura</label>
                <input required type="number" step="0.01" className="input-sm w-full" value={cajaForm.efectivo_apertura} onChange={(e) => setCajaForm((p) => ({ ...p, efectivo_apertura: e.target.value }))} />
              </div>
              <div>
                <label className="label-sm">Efectivo cierre (conteo físico)</label>
                <input required type="number" step="0.01" className="input-sm w-full" value={cajaForm.efectivo_cierre} onChange={(e) => setCajaForm((p) => ({ ...p, efectivo_cierre: e.target.value }))} />
              </div>
              <div>
                <label className="label-sm">Observaciones</label>
                <input className="input-sm w-full" value={cajaForm.observaciones} onChange={(e) => setCajaForm((p) => ({ ...p, observaciones: e.target.value }))} />
              </div>
              <p className="text-xs text-slate-400">El sistema calculará automáticamente el total cobrado en el período del turno.</p>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setCajaModal(false)} className="btn-secondary flex-1">Cancelar</button>
                <button type="submit" className="btn-primary flex-1">Cerrar turno</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
