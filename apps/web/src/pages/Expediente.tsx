import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth, hasRole } from "../lib/auth";

/* ── tipos ── */
type SignoVital = {
  id: number; fecha: string; fc?: number; ta_sistolica?: number; ta_diastolica?: number;
  spo2?: number; temperatura?: number; fr?: number; glucosa?: number;
  peso?: number; talla?: number; notas?: string; registrado_por_nombre?: string;
};
type NotaClinica = {
  id: number; tipo: string; cuerpo: string; firmada: number; fecha_firma?: string;
  firmado_por_nombre?: string; creado_por_nombre?: string; creado_en: string;
};
type Diagnostico = {
  id: number; cie10_codigo?: string; cie10_nombre?: string; descripcion: string;
  tipo: string; creado_por_nombre?: string; creado_en: string;
};
type Prescripcion = {
  id: number; producto_nombre: string; dosis: string; frecuencia_horas: number;
  dias: number; via: string; estado: string; prescrito_por_nombre?: string;
  administraciones: number; creado_en: string; notas?: string;
};
type Cie10Opt = { codigo: string; nombre: string; categoria?: string };
type Producto = { id: number; nombre: string };

const TIPO_NOTA = ["ingreso", "evolucion", "interconsulta", "egreso"] as const;
const TIPO_DX   = ["principal", "secundario", "procedimiento"] as const;
const VIA_ADM   = ["oral", "IV", "IM", "SC", "sublingual", "topica", "inhalatoria"] as const;

/* ── mini sparkline SVG ── */
function Sparkline({ values, color = "#3b82f6" }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 80; const h = 28;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  );
}

/* ══════════════════════════════════════════════ */
export default function Expediente() {
  const [params] = useSearchParams();
  const episodioId = parseInt(params.get("episodio") ?? "0");
  const { user } = useAuth();

  const [tab, setTab] = useState<"signos" | "notas" | "diagnosticos" | "prescripciones">("signos");
  const [signos, setSignos]   = useState<SignoVital[]>([]);
  const [notas,  setNotas]    = useState<NotaClinica[]>([]);
  const [dxs,    setDxs]      = useState<Diagnostico[]>([]);
  const [prescs, setPrescs]   = useState<Prescripcion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  /* formularios */
  const [svForm, setSvForm]   = useState<Partial<SignoVital>>({});
  const [ntForm, setNtForm]   = useState<{ tipo: string; cuerpo: string }>({ tipo: "evolucion", cuerpo: "" });
  const [dxForm, setDxForm]   = useState<{ descripcion: string; tipo: string; cie10_codigo: string }>({ descripcion: "", tipo: "principal", cie10_codigo: "" });
  const [rxForm, setRxForm]   = useState<{ producto_id: string; dosis: string; frecuencia_horas: number; dias: number; via: string; notas: string }>({ producto_id: "", dosis: "", frecuencia_horas: 8, dias: 1, via: "oral", notas: "" });
  const [cie10Opts, setCie10Opts] = useState<Cie10Opt[]>([]);
  const [cie10Q, setCie10Q]   = useState("");
  const cie10Timer              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [prodQ, setProdQ]     = useState("");
  const prodTimer               = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!episodioId) return (
    <div className="p-8 text-center text-slate-400">
      Accede desde <strong>Atención</strong> seleccionando un paciente para ver su expediente.
    </div>
  );

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => { cargarTab(tab); }, [tab, episodioId]);

  async function cargarTab(t: typeof tab) {
    setLoading(true); setError("");
    try {
      if (t === "signos")        setSignos(await api.get<SignoVital[]>(`/api/expediente/episodio/${episodioId}/signos-vitales`));
      else if (t === "notas")    setNotas(await api.get<NotaClinica[]>(`/api/expediente/episodio/${episodioId}/notas`));
      else if (t === "diagnosticos") setDxs(await api.get<Diagnostico[]>(`/api/expediente/episodio/${episodioId}/diagnosticos`));
      else if (t === "prescripciones") setPrescs(await api.get<Prescripcion[]>(`/api/expediente/episodio/${episodioId}/prescripciones`));
    } catch (e: unknown) { setError((e as Error).message); }
    setLoading(false);
  }

  /* ── signos vitales ── */
  async function guardarSigno(e: React.FormEvent) {
    e.preventDefault();
    await api.post(`/api/expediente/episodio/${episodioId}/signos-vitales`, svForm);
    setSvForm({});
    cargarTab("signos");
  }

  /* ── notas clínicas ── */
  async function guardarNota(e: React.FormEvent) {
    e.preventDefault();
    if (!ntForm.cuerpo.trim()) return;
    await api.post(`/api/expediente/episodio/${episodioId}/notas`, ntForm);
    setNtForm({ tipo: "evolucion", cuerpo: "" });
    cargarTab("notas");
  }
  async function firmarNota(id: number) {
    if (!confirm("¿Firmar nota? No podrá editarse después.")) return;
    await api.post(`/api/expediente/notas/${id}/firmar`, {});
    cargarTab("notas");
  }

  /* ── diagnósticos ── */
  function buscarCie10(q: string) {
    setCie10Q(q);
    if (cie10Timer.current) clearTimeout(cie10Timer.current);
    cie10Timer.current = setTimeout(async () => {
      if (q.length >= 2) setCie10Opts(await api.get<Cie10Opt[]>(`/api/expediente/cie10?q=${encodeURIComponent(q)}`).catch(() => []));
      else setCie10Opts([]);
    }, 300);
  }
  async function guardarDx(e: React.FormEvent) {
    e.preventDefault();
    if (!dxForm.descripcion.trim()) return;
    await api.post(`/api/expediente/episodio/${episodioId}/diagnosticos`, dxForm);
    setDxForm({ descripcion: "", tipo: "principal", cie10_codigo: "" });
    setCie10Q(""); setCie10Opts([]);
    cargarTab("diagnosticos");
  }
  async function eliminarDx(id: number) {
    if (!confirm("¿Eliminar diagnóstico?")) return;
    await api.del(`/api/expediente/diagnosticos/${id}`);
    cargarTab("diagnosticos");
  }

  /* ── prescripciones ── */
  function buscarProducto(q: string) {
    setProdQ(q);
    if (prodTimer.current) clearTimeout(prodTimer.current);
    prodTimer.current = setTimeout(async () => {
      if (q.length >= 2) {
        const data = await api.get<Producto[]>(`/api/productos?q=${encodeURIComponent(q)}&limit=15`).catch(() => []);
        setProductos(data);
      } else setProductos([]);
    }, 300);
  }
  async function guardarPrescripcion(e: React.FormEvent) {
    e.preventDefault();
    if (!rxForm.producto_id || !rxForm.dosis) return;
    await api.post(`/api/expediente/episodio/${episodioId}/prescripciones`, rxForm);
    setRxForm({ producto_id: "", dosis: "", frecuencia_horas: 8, dias: 1, via: "oral", notas: "" });
    setProdQ(""); setProductos([]);
    cargarTab("prescripciones");
  }
  async function suspenderPresc(id: number) {
    if (!confirm("¿Suspender prescripción?")) return;
    await api.post(`/api/expediente/prescripciones/${id}/suspender`, {});
    cargarTab("prescripciones");
  }
  async function administrarMed(id: number) {
    const dosis = prompt("Dosis administrada (dejar vacío para usar la prescrita):");
    if (dosis === null) return;
    await api.post(`/api/expediente/prescripciones/${id}/administrar`, { dosis_administrada: dosis || undefined });
    cargarTab("prescripciones");
  }

  const tabs = [
    { k: "signos",         label: "Signos vitales" },
    { k: "notas",          label: "Notas clínicas" },
    { k: "diagnosticos",   label: "Diagnósticos" },
    { k: "prescripciones", label: "Prescripciones" },
  ] as const;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Expediente clínico — Episodio #{episodioId}</h1>

      {/* tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.k ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      {/* ════════ SIGNOS VITALES ════════ */}
      {tab === "signos" && (
        <div className="space-y-4">
          <form onSubmit={guardarSigno} className="card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <h2 className="col-span-full text-sm font-semibold text-slate-700">Registrar signos</h2>
            {[
              { k: "fc",           label: "FC (bpm)",    type: "number" },
              { k: "ta_sistolica", label: "TA Sist.",    type: "number" },
              { k: "ta_diastolica",label: "TA Diast.",   type: "number" },
              { k: "spo2",         label: "SpO2 (%)",    type: "number" },
              { k: "temperatura",  label: "Temp (°C)",   type: "number" },
              { k: "fr",           label: "FR",          type: "number" },
              { k: "glucosa",      label: "Glucosa",     type: "number" },
              { k: "peso",         label: "Peso (kg)",   type: "number" },
            ].map(({ k, label, type }) => (
              <div key={k}>
                <label className="label-sm">{label}</label>
                <input
                  type={type}
                  step="0.1"
                  className="input-sm w-full"
                  value={(svForm as Record<string, unknown>)[k] as string ?? ""}
                  onChange={(e) => setSvForm((p) => ({ ...p, [k]: e.target.value ? +e.target.value : undefined }))}
                />
              </div>
            ))}
            <div className="col-span-full">
              <label className="label-sm">Notas</label>
              <input className="input-sm w-full" value={svForm.notas ?? ""} onChange={(e) => setSvForm((p) => ({ ...p, notas: e.target.value }))} />
            </div>
            <div className="col-span-full flex justify-end">
              <button type="submit" className="btn-primary text-sm">Guardar signos</button>
            </div>
          </form>

          {/* Tabla + mini gráficas */}
          {loading ? <div className="text-slate-400 text-sm">Cargando...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-100 text-slate-600">
                  {["Fecha", "FC", "TA", "SpO2", "Temp", "FR", "Gluc.", "Registró"].map((h) => <th key={h} className="px-2 py-1 text-left">{h}</th>)}
                </tr></thead>
                <tbody>
                  {signos.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-1 whitespace-nowrap">{new Date(s.fecha).toLocaleString("es-SV")}</td>
                      <td className="px-2 py-1">{s.fc ?? "—"}</td>
                      <td className="px-2 py-1">{s.ta_sistolica && s.ta_diastolica ? `${s.ta_sistolica}/${s.ta_diastolica}` : "—"}</td>
                      <td className="px-2 py-1">{s.spo2 != null ? `${s.spo2}%` : "—"}</td>
                      <td className="px-2 py-1">{s.temperatura != null ? `${s.temperatura}°` : "—"}</td>
                      <td className="px-2 py-1">{s.fr ?? "—"}</td>
                      <td className="px-2 py-1">{s.glucosa ?? "—"}</td>
                      <td className="px-2 py-1 text-slate-500">{s.registrado_por_nombre}</td>
                    </tr>
                  ))}
                  {signos.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-center text-slate-400">Sin registros</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* mini gráficas tendencia */}
          {signos.length > 1 && (
            <div className="card p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              {[
                { label: "FC",    vals: signos.map((s) => s.fc).filter(Boolean) as number[],          color: "#ef4444" },
                { label: "SpO2",  vals: signos.map((s) => s.spo2).filter(Boolean) as number[],        color: "#3b82f6" },
                { label: "Temp",  vals: signos.map((s) => s.temperatura).filter(Boolean) as number[], color: "#f97316" },
                { label: "TA S.", vals: signos.map((s) => s.ta_sistolica).filter(Boolean) as number[], color: "#8b5cf6" },
              ].map(({ label, vals, color }) => vals.length > 1 && (
                <div key={label} className="flex flex-col gap-1">
                  <span className="text-slate-500 font-medium">{label}</span>
                  <Sparkline values={vals.slice().reverse()} color={color} />
                  <span className="text-slate-700 font-semibold">{vals[0]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════ NOTAS CLÍNICAS ════════ */}
      {tab === "notas" && (
        <div className="space-y-4">
          <form onSubmit={guardarNota} className="card p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">Nueva nota</h2>
            <div className="flex gap-3">
              <div>
                <label className="label-sm">Tipo</label>
                <select className="input-sm" value={ntForm.tipo} onChange={(e) => setNtForm((p) => ({ ...p, tipo: e.target.value }))}>
                  {TIPO_NOTA.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label-sm">Contenido</label>
              <textarea
                rows={5}
                required
                className="input-sm w-full resize-y"
                value={ntForm.cuerpo}
                onChange={(e) => setNtForm((p) => ({ ...p, cuerpo: e.target.value }))}
                placeholder="Escriba la nota clínica..."
              />
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary text-sm">Guardar nota</button>
            </div>
          </form>

          {loading ? <div className="text-slate-400 text-sm">Cargando...</div> : (
            <div className="space-y-3">
              {notas.map((n) => (
                <div key={n.id} className={`card p-4 ${n.firmada ? "border-l-4 border-green-500" : "border-l-4 border-amber-400"}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex gap-2 items-center">
                      <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded ${
                        n.tipo === "ingreso" ? "bg-blue-100 text-blue-700" :
                        n.tipo === "egreso"  ? "bg-green-100 text-green-700" :
                        n.tipo === "interconsulta" ? "bg-purple-100 text-purple-700" :
                        "bg-slate-100 text-slate-600"
                      }`}>{n.tipo}</span>
                      {n.firmada
                        ? <span className="text-xs text-green-600">✓ Firmada por {n.firmado_por_nombre} — {n.fecha_firma?.slice(0, 10)}</span>
                        : <span className="text-xs text-amber-600">Pendiente de firma</span>
                      }
                    </div>
                    {!n.firmada && hasRole(user, "admin", "medico") && (
                      <button onClick={() => firmarNota(n.id)} className="btn-secondary text-xs">Firmar</button>
                    )}
                  </div>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">{n.cuerpo}</p>
                  <p className="text-xs text-slate-400 mt-2">{n.creado_por_nombre} — {new Date(n.creado_en).toLocaleString("es-SV")}</p>
                </div>
              ))}
              {notas.length === 0 && <div className="text-center text-slate-400 py-8">Sin notas clínicas</div>}
            </div>
          )}
        </div>
      )}

      {/* ════════ DIAGNÓSTICOS ════════ */}
      {tab === "diagnosticos" && (
        <div className="space-y-4">
          <form onSubmit={guardarDx} className="card p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">Agregar diagnóstico</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 relative">
                <label className="label-sm">Buscar CIE-10</label>
                <input
                  className="input-sm w-full"
                  value={cie10Q}
                  onChange={(e) => buscarCie10(e.target.value)}
                  placeholder="Ej: K35 o apendicitis"
                />
                {cie10Opts.length > 0 && (
                  <ul className="absolute z-10 bg-white border border-slate-200 rounded shadow-lg w-full max-h-48 overflow-y-auto text-xs">
                    {cie10Opts.map((o) => (
                      <li
                        key={o.codigo}
                        className="px-3 py-2 hover:bg-blue-50 cursor-pointer"
                        onClick={() => {
                          setDxForm((p) => ({ ...p, cie10_codigo: o.codigo, descripcion: p.descripcion || o.nombre }));
                          setCie10Q(`${o.codigo} — ${o.nombre}`);
                          setCie10Opts([]);
                        }}
                      >
                        <span className="font-mono text-blue-700 mr-2">{o.codigo}</span>{o.nombre}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <label className="label-sm">Tipo</label>
                <select className="input-sm w-full" value={dxForm.tipo} onChange={(e) => setDxForm((p) => ({ ...p, tipo: e.target.value }))}>
                  {TIPO_DX.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label className="label-sm">Descripción</label>
                <input required className="input-sm w-full" value={dxForm.descripcion} onChange={(e) => setDxForm((p) => ({ ...p, descripcion: e.target.value }))} placeholder="Descripción del diagnóstico" />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary text-sm">Agregar</button>
            </div>
          </form>

          {loading ? <div className="text-slate-400 text-sm">Cargando...</div> : (
            <div className="space-y-2">
              {(["principal", "secundario", "procedimiento"] as const).map((tipo) => {
                const lista = dxs.filter((d) => d.tipo === tipo);
                if (!lista.length) return null;
                return (
                  <div key={tipo}>
                    <h3 className="text-xs font-semibold uppercase text-slate-500 mb-1">{tipo}</h3>
                    {lista.map((d) => (
                      <div key={d.id} className="flex items-center gap-3 py-1.5 border-b border-slate-100">
                        {d.cie10_codigo && <span className="font-mono text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{d.cie10_codigo}</span>}
                        <span className="text-sm text-slate-800 flex-1">{d.descripcion}</span>
                        <span className="text-xs text-slate-400">{d.creado_por_nombre}</span>
                        {hasRole(user, "admin", "medico") && (
                          <button onClick={() => eliminarDx(d.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
              {dxs.length === 0 && <div className="text-center text-slate-400 py-8">Sin diagnósticos</div>}
            </div>
          )}
        </div>
      )}

      {/* ════════ PRESCRIPCIONES ════════ */}
      {tab === "prescripciones" && (
        <div className="space-y-4">
          {hasRole(user, "admin", "medico") && (
            <form onSubmit={guardarPrescripcion} className="card p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-700">Nueva prescripción</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 relative">
                  <label className="label-sm">Medicamento</label>
                  <input
                    className="input-sm w-full"
                    value={prodQ}
                    onChange={(e) => buscarProducto(e.target.value)}
                    placeholder="Buscar producto..."
                  />
                  {productos.length > 0 && (
                    <ul className="absolute z-10 bg-white border border-slate-200 rounded shadow-lg w-full max-h-40 overflow-y-auto text-xs">
                      {productos.map((p) => (
                        <li key={p.id} className="px-3 py-2 hover:bg-blue-50 cursor-pointer"
                          onClick={() => {
                            setRxForm((f) => ({ ...f, producto_id: String(p.id) }));
                            setProdQ(p.nombre); setProductos([]);
                          }}>
                          {p.nombre}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <label className="label-sm">Vía</label>
                  <select className="input-sm w-full" value={rxForm.via} onChange={(e) => setRxForm((p) => ({ ...p, via: e.target.value }))}>
                    {VIA_ADM.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-sm">Dosis</label>
                  <input required className="input-sm w-full" value={rxForm.dosis} onChange={(e) => setRxForm((p) => ({ ...p, dosis: e.target.value }))} placeholder="500mg" />
                </div>
                <div>
                  <label className="label-sm">Cada (horas)</label>
                  <input type="number" className="input-sm w-full" value={rxForm.frecuencia_horas} onChange={(e) => setRxForm((p) => ({ ...p, frecuencia_horas: +e.target.value }))} />
                </div>
                <div>
                  <label className="label-sm">Por (días)</label>
                  <input type="number" className="input-sm w-full" value={rxForm.dias} onChange={(e) => setRxForm((p) => ({ ...p, dias: +e.target.value }))} />
                </div>
                <div className="sm:col-span-3">
                  <label className="label-sm">Notas</label>
                  <input className="input-sm w-full" value={rxForm.notas} onChange={(e) => setRxForm((p) => ({ ...p, notas: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn-primary text-sm">Prescribir</button>
              </div>
            </form>
          )}

          {loading ? <div className="text-slate-400 text-sm">Cargando...</div> : (
            <div className="space-y-2">
              {prescs.map((rx) => (
                <div key={rx.id} className={`card p-3 flex items-start gap-3 ${rx.estado !== "activa" ? "opacity-60" : ""}`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-slate-800">{rx.producto_nombre}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        rx.estado === "activa" ? "bg-green-100 text-green-700" :
                        rx.estado === "suspendida" ? "bg-red-100 text-red-700" :
                        "bg-slate-100 text-slate-500"
                      }`}>{rx.estado}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {rx.dosis} — cada {rx.frecuencia_horas}h — por {rx.dias} día(s) — vía {rx.via}
                    </p>
                    <p className="text-xs text-slate-400">
                      Prescrito por: {rx.prescrito_por_nombre ?? "—"} | Administraciones: {rx.administraciones}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {rx.estado === "activa" && hasRole(user, "admin", "enfermeria", "medico") && (
                      <button onClick={() => administrarMed(rx.id)} className="btn-secondary text-xs">Administrar</button>
                    )}
                    {rx.estado === "activa" && hasRole(user, "admin", "medico") && (
                      <button onClick={() => suspenderPresc(rx.id)} className="btn-danger text-xs">Suspender</button>
                    )}
                  </div>
                </div>
              ))}
              {prescs.length === 0 && <div className="text-center text-slate-400 py-8">Sin prescripciones</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
