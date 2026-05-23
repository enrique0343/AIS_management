import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAuth, hasRole } from "../lib/auth";

type EnAtencion = {
  id: number;
  expediente: string;
  nombres: string;
  apellidos: string;
  episodio_id: number;
  fecha_inicio: string;
  motivo: string | null;
  alta_solicitada_en: string | null;
  medico_cabecera_id: number | null;
  medico_cabecera_nombre: string | null;
  ocupacion_id: number | null;
  habitacion: string | null;
  habitacion_tipo: string | null;
  habitacion_desde: string | null;
  consumos_pend: number;
  cirugia_proxima: string | null;
};

type Medico = { id: number; nombres: string; apellidos: string; especialidad: string | null; activo: number };

type Habitacion = {
  id: number;
  numero: string;
  tipo: string;
  precio_diario: number;
  capacidad: number;
  ocupantes_actuales: number;
  activa: number;
};

type Pac = { id: number; expediente: string; nombres: string; apellidos: string; documento_numero: string | null };

type DevLinea = {
  consumoId: number;
  productoId: number;
  producto: string;
  loteOriginalId: number | null;
  numeroLoteOriginal: string | null;
  fechaVencOriginal: string | null;
  maxCant: number;
  seleccionado: boolean;
  cantidad: number;
  loteSeleccionadoId: string;
  lotes: { id: number; numero_lote: string; fecha_vencimiento: string }[];
};

type CargoTipo = "servicios" | "laboratorio" | "imagenes" | "medicamentos";

const cargoConfig: Record<CargoTipo, { label: string; prefijos: string; color: string; descripcion: string; tipo: "cargo" | "requisicion" }> = {
  servicios: { label: "Servicios", prefijos: "SVC,QUI", color: "bg-purple-600 hover:bg-purple-700", descripcion: "Consultas y servicios hospitalarios / quirurgicos", tipo: "cargo" },
  laboratorio: { label: "Laboratorio", prefijos: "LAB", color: "bg-teal-600 hover:bg-teal-700", descripcion: "Examenes de laboratorio clinico", tipo: "cargo" },
  imagenes: { label: "Imagenes", prefijos: "RAD", color: "bg-indigo-600 hover:bg-indigo-700", descripcion: "Radiologia y estudios de imagen", tipo: "cargo" },
  medicamentos: { label: "Solicitar a farmacia", prefijos: "MED,INS", color: "bg-emerald-600 hover:bg-emerald-700", descripcion: "Requisicion a farmacia interna (sin elegir lote)", tipo: "requisicion" },
};

export default function Atencion() {
  const { user } = useAuth();
  const [pacientes, setPacientes] = useState<EnAtencion[]>([]);
  const [habitaciones, setHabitaciones] = useState<Habitacion[]>([]);
  const [sel, setSel] = useState<EnAtencion | null>(null);
  const [estado, setEstado] = useState<any | null>(null);
  const [cargo, setCargo] = useState<CargoTipo | null>(null);
  const [productos, setProductos] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [cargoForm, setCargoForm] = useState<any>({ producto_id: "", area_id: "", cantidad: 1, observaciones: "", prioridad: "normal" });
  const [reqLineas, setReqLineas] = useState<{ producto_id: string; cantidad: number }[]>([{ producto_id: "", cantidad: 1 }]);

  // Modal de devolucion multi-producto
  const [devModal, setDevModal] = useState<{ lineas: DevLinea[]; areaId: string; obs: string } | null>(null);

  // Hospitalizar modal
  const [showHosp, setShowHosp] = useState(false);
  const [busqPac, setBusqPac] = useState("");
  const [pacientesBusq, setPacientesBusq] = useState<Pac[]>([]);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [hospForm, setHospForm] = useState<any>({ paciente_id: "", habitacion_id: "", medico_cabecera_id: "", motivo: "Hospitalizacion", observaciones: "" });

  const loadList = () => {
    api.get<{ data: EnAtencion[] }>("/api/pacientes/_en-atencion").then((r) => setPacientes(r.data));
    api.get<{ data: Habitacion[] }>("/api/habitaciones").then((r) => setHabitaciones(r.data));
  };
  const loadEstado = (pid: number) => api.get<any>(`/api/pacientes/${pid}/estado-cuenta`).then(setEstado);

  useEffect(() => {
    loadList();
    api.get<{ data: any[] }>("/api/catalogos/areas").then((r) => setAreas(r.data));
    api.get<{ data: Medico[] }>("/api/profesionales/medicos").then((r) => setMedicos(r.data.filter((m) => m.activo)));
  }, []);

  const totalCamas = habitaciones.filter((h) => h.activa).reduce((s, h) => s + h.capacidad, 0);
  const ocupadas = useMemo(() => pacientes.filter((p) => p.habitacion).length, [pacientes]);
  const libres = totalCamas - ocupadas;
  const habDisponibles = useMemo(() => habitaciones.filter((h) => h.activa && h.ocupantes_actuales < h.capacidad), [habitaciones]);

  const abrir = async (p: EnAtencion) => {
    setSel(p);
    loadEstado(p.id);
  };

  const refrescar = () => {
    if (sel) loadEstado(sel.id);
    loadList();
  };

  // === Cargos / Requisiciones ===
  const abrirCargo = async (tipo: CargoTipo) => {
    setCargo(tipo);
    const r = await api.get<{ data: any[] }>(`/api/productos?categoria_prefijo=${cargoConfig[tipo].prefijos}`);
    setProductos(r.data);
    setCargoForm({ producto_id: "", area_id: "", cantidad: 1, observaciones: "", prioridad: "normal" });
    setReqLineas([{ producto_id: "", cantidad: 1 }]);
  };

  const submitCargo = async () => {
    if (!sel || !cargo) return;
    try {
      if (cargoConfig[cargo].tipo === "requisicion") {
        const detalles = reqLineas
          .filter((l) => l.producto_id && Number(l.cantidad) > 0)
          .map((l) => ({ producto_id: Number(l.producto_id), cantidad_solicitada: Number(l.cantidad) }));
        if (!detalles.length) { alert("Agrega al menos un producto con cantidad."); return; }
        await api.post("/api/requisiciones", {
          paciente_id: sel.id,
          episodio_id: sel.episodio_id,
          area_solicitante_id: cargoForm.area_id ? Number(cargoForm.area_id) : null,
          prioridad: cargoForm.prioridad ?? "normal",
          observaciones: cargoForm.observaciones || null,
          detalles,
        });
        alert("Requisicion enviada a farmacia interna.");
      } else {
        if (!cargoForm.area_id) { alert("Area requerida"); return; }
        await api.post("/api/enfermeria/consumos", {
          episodio_id: sel.episodio_id,
          producto_id: Number(cargoForm.producto_id),
          area_id: Number(cargoForm.area_id),
          cantidad: Number(cargoForm.cantidad),
          observaciones: cargoForm.observaciones || null,
        });
      }
      setCargo(null);
      refrescar();
    } catch (e: any) { alert(e.message); }
  };

  // === Devolucion multi-producto ===
  const areasDevolucion = useMemo(
    () => areas.filter((a) => ["farmacia_central", "farmacia_periferica"].includes(a.tipo)),
    [areas]
  );

  const abrirDevolucion = async () => {
    if (!estado) return;
    const returnables = (estado.consumos as any[]).filter(
      (c) => !c.facturado && !c.es_servicio && c.cantidad > 0
    );
    if (!returnables.length) { alert("No hay consumos de productos disponibles para devolver."); return; }

    const pids = [...new Set(returnables.map((c: any) => c.producto_id as number))];
    const lotesMap: Record<number, { id: number; numero_lote: string; fecha_vencimiento: string }[]> = {};
    await Promise.all(
      pids.map(async (pid) => {
        try {
          const r = await api.get<{ data: any[] }>(`/api/catalogos/lotes-producto?producto_id=${pid}`);
          lotesMap[pid] = r.data;
        } catch {
          lotesMap[pid] = [];
        }
      })
    );

    const lineas: DevLinea[] = returnables.map((c: any) => ({
      consumoId: c.id,
      productoId: c.producto_id,
      producto: c.producto,
      loteOriginalId: c.lote_id ?? null,
      numeroLoteOriginal: c.numero_lote ?? null,
      fechaVencOriginal: c.fecha_vencimiento ?? null,
      maxCant: c.cantidad,
      seleccionado: false,
      cantidad: c.cantidad,
      loteSeleccionadoId: c.lote_id ? String(c.lote_id) : "",
      lotes: lotesMap[c.producto_id] ?? [],
    }));

    setDevModal({
      lineas,
      areaId: areasDevolucion.length === 1 ? String(areasDevolucion[0].id) : "",
      obs: "",
    });
  };

  const updateDevLinea = (i: number, patch: Partial<DevLinea>) => {
    if (!devModal) return;
    const lineas = [...devModal.lineas];
    lineas[i] = { ...lineas[i], ...patch };
    setDevModal({ ...devModal, lineas });
  };

  const submitDevolucion = async () => {
    if (!devModal || !devModal.areaId) { alert("Selecciona la farmacia destino"); return; }
    const sel2 = devModal.lineas.filter((l) => l.seleccionado && Number(l.cantidad) > 0);
    if (!sel2.length) { alert("Selecciona al menos un producto"); return; }
    let ok = 0;
    let err = 0;
    for (const linea of sel2) {
      try {
        await api.post(`/api/enfermeria/consumos/${linea.consumoId}/solicitar-devolucion`, {
          cantidad: Number(linea.cantidad),
          area_destino_id: Number(devModal.areaId),
          ...(linea.loteSeleccionadoId ? { lote_id: Number(linea.loteSeleccionadoId) } : {}),
          observaciones: devModal.obs || `Devolucion de ${linea.producto} - no utilizado`,
        });
        ok++;
      } catch { err++; }
    }
    if (err) alert(`${ok} enviada(s), ${err} con error.`);
    else alert(`${ok} solicitud(es) enviada(s) a farmacia.`);
    setDevModal(null);
    refrescar();
  };

  // === Hospitalizar ===
  const buscarPacientes = async (q: string) => {
    setBusqPac(q);
    if (!q.trim()) { setPacientesBusq([]); return; }
    const r = await api.get<{ data: Pac[] }>(`/api/pacientes?q=${encodeURIComponent(q)}`);
    setPacientesBusq(r.data);
  };

  const hospitalizar = async () => {
    if (!hospForm.paciente_id || !hospForm.habitacion_id || !hospForm.medico_cabecera_id) {
      alert("Selecciona paciente, habitacion y medico de cabecera");
      return;
    }
    try {
      await api.post("/api/habitaciones/asignar", {
        paciente_id: Number(hospForm.paciente_id),
        habitacion_id: Number(hospForm.habitacion_id),
        medico_cabecera_id: Number(hospForm.medico_cabecera_id),
        motivo: hospForm.motivo || "Hospitalizacion",
        observaciones: hospForm.observaciones || null,
      });
      setShowHosp(false);
      setHospForm({ paciente_id: "", habitacion_id: "", medico_cabecera_id: "", motivo: "Hospitalizacion", observaciones: "" });
      setBusqPac("");
      setPacientesBusq([]);
      loadList();
    } catch (e: any) { alert(e.message); }
  };

  // === Alta / cierre ===
  const solicitarAlta = async () => {
    if (!sel) return;
    if (!confirm("Solicitar alta? Administracion lo revisara antes de cerrar la cuenta.")) return;
    try {
      await api.post(`/api/pacientes/episodios/${sel.episodio_id}/solicitar-alta`, {});
      refrescar();
    } catch (e: any) {
      alert(e.message ?? "Error al solicitar alta");
    }
  };

  const cancelarAlta = async () => {
    if (!sel) return;
    await api.post(`/api/pacientes/episodios/${sel.episodio_id}/cancelar-alta`, {});
    refrescar();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Atencion de pacientes</h1>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={loadList}>Refrescar</button>
          <button className="btn" onClick={() => setShowHosp(true)}>+ Hospitalizar paciente</button>
        </div>
      </div>

      {/* KPIs de camas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card"><div className="text-xs text-slate-500">Hospitalizados</div><div className="text-2xl font-semibold text-blue-600">{ocupadas}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Camas libres</div><div className="text-2xl font-semibold text-green-600">{libres}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Capacidad total</div><div className="text-2xl font-semibold">{totalCamas}</div></div>
        <div className="card"><div className="text-xs text-slate-500">% ocupacion actual</div><div className="text-2xl font-semibold">{totalCamas ? Math.round((ocupadas / totalCamas) * 100) : 0}%</div></div>
      </div>

      {!sel ? (
        <>
          {!pacientes.length ? (
            <div className="card text-sm text-slate-500">No hay pacientes en atencion. Use "+ Hospitalizar paciente" para iniciar.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pacientes.map((p) => (
                <button
                  key={p.episodio_id}
                  onClick={() => abrir(p)}
                  className={`card text-left hover:shadow-md transition border-l-4 ${p.alta_solicitada_en ? "border-amber-500" : p.habitacion ? "border-blue-500" : "border-slate-300"}`}
                >
                  <div className="flex justify-between">
                    <div className="font-semibold">{p.nombres} {p.apellidos}</div>
                    {p.alta_solicitada_en && <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded">ALTA SOLICITADA</span>}
                  </div>
                  <div className="text-xs text-slate-500">Exp: {p.expediente} - Episodio #{p.episodio_id}</div>
                  <div className="mt-2 text-sm">
                    {p.habitacion ? (
                      <div>Habitacion: <strong>{p.habitacion}</strong> ({p.habitacion_tipo})</div>
                    ) : (
                      <div className="text-slate-400">Sin habitacion - ambulatorio</div>
                    )}
                    {p.medico_cabecera_nombre && (
                      <div className="text-xs"><span className="text-slate-500">Dr/a. de cabecera:</span> {p.medico_cabecera_nombre}</div>
                    )}
                    {p.cirugia_proxima && <div className="text-xs">Cirugia: {p.cirugia_proxima}</div>}
                    <div className="text-xs text-slate-500 mt-1">Inicio: {p.fecha_inicio}</div>
                    <div className="text-xs">{p.consumos_pend} cargos pendientes de facturar</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-4">
          {/* Panel del paciente seleccionado */}
          <div className="card">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-semibold">{sel.nombres} {sel.apellidos}</h2>
                <div className="text-sm text-slate-500">Exp: {sel.expediente} - Episodio #{sel.episodio_id} - desde {sel.fecha_inicio}</div>
                <div className="text-sm mt-1">
                  {sel.habitacion ? (
                    <>Habitacion <strong>{sel.habitacion}</strong> ({sel.habitacion_tipo}) desde {sel.habitacion_desde}</>
                  ) : (
                    <span className="text-slate-400">Sin habitacion asignada</span>
                  )}
                </div>
                {sel.medico_cabecera_nombre && (
                  <div className="text-sm mt-1"><span className="text-slate-500">Medico de cabecera:</span> <strong>{sel.medico_cabecera_nombre}</strong></div>
                )}
                {sel.cirugia_proxima && <div className="text-sm mt-1">Cirugia vinculada: <strong>{sel.cirugia_proxima}</strong></div>}
                {sel.alta_solicitada_en && (
                  <div className="mt-2 inline-block px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs">
                    ALTA SOLICITADA en {sel.alta_solicitada_en} - administracion debe cerrar la cuenta
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 items-end">
                <button className="btn-secondary" onClick={() => { setSel(null); setEstado(null); }}>Volver</button>
              </div>
            </div>
          </div>

          {/* Botones de cargos */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(Object.keys(cargoConfig) as CargoTipo[]).map((t) => (
              <button
                key={t}
                onClick={() => abrirCargo(t)}
                disabled={!!sel.alta_solicitada_en}
                className={`p-4 rounded-lg text-white font-semibold ${cargoConfig[t].color} disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div>{cargoConfig[t].label}</div>
                <div className="text-xs font-normal mt-1 opacity-80">{cargoConfig[t].descripcion}</div>
              </button>
            ))}
          </div>

          {/* Estado de cuenta */}
          {estado && (
            <div className="card">
              <h3 className="font-semibold mb-2">Cuenta hospitalaria</h3>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="card !p-2"><div className="text-xs text-slate-500">Consumos pendientes</div><div className="text-lg font-semibold text-amber-600">${Number(estado.totales.consumos_pendientes).toFixed(2)}</div></div>
                <div className="card !p-2"><div className="text-xs text-slate-500">Habitacion en curso</div><div className="text-lg font-semibold text-blue-600">${Number(estado.totales.habitacion_en_curso).toFixed(2)}</div></div>
                <div className="card !p-2"><div className="text-xs text-slate-500">Habitacion facturable</div><div className="text-lg font-semibold text-amber-600">${Number(estado.totales.habitacion_pendiente).toFixed(2)}</div></div>
              </div>
              <table className="table">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripcion</th><th>Cant</th><th>Precio</th><th>Subtotal</th><th>Fact</th></tr></thead>
                <tbody>
                  {estado.ocupaciones.map((o: any) => (
                    <tr key={`o${o.id}`} className={!o.fecha_egreso ? "bg-blue-50/40" : ""}>
                      <td className="text-xs">{o.fecha_ingreso}</td>
                      <td><span className="text-xs px-1 rounded bg-purple-100">habitacion</span></td>
                      <td>Habitacion {o.habitacion} ({o.habitacion_tipo}){!o.fecha_egreso && " - en curso"}</td>
                      <td>{o.dias}</td>
                      <td>{Number(o.precio_diario_snapshot).toFixed(2)}</td>
                      <td>${Number(o.subtotal).toFixed(2)}</td>
                      <td>{o.facturado ? "Si" : "No"}</td>
                    </tr>
                  ))}
                  {estado.consumos.map((c: any) => (
                    <tr key={`c${c.id}`}>
                      <td className="text-xs">{c.fecha}</td>
                      <td><span className={`text-xs px-1 rounded ${c.es_servicio ? "bg-green-100" : "bg-slate-100"}`}>{c.es_servicio ? "servicio" : "producto"}</span></td>
                      <td>{c.producto}</td>
                      <td>{c.cantidad}</td>
                      <td>{Number(c.precio_venta_snapshot).toFixed(2)}</td>
                      <td>${Number(c.subtotal).toFixed(2)}</td>
                      <td>{c.facturado ? "Si" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!sel.alta_solicitada_en && estado.consumos.some((c: any) => !c.facturado && !c.es_servicio && c.cantidad > 0) && (
                <div className="flex justify-end mt-2">
                  <button className="btn-secondary text-xs" onClick={abrirDevolucion}>
                    Solicitar devolucion de productos
                  </button>
                </div>
              )}
              <p className="text-xs text-slate-500 mt-1">La devolucion crea una solicitud en farmacia. El dependiente confirma el lote y el area antes de ajustar el inventario.</p>
            </div>
          )}

          <div className="card flex flex-wrap gap-2 justify-end">
            {!sel.alta_solicitada_en && hasRole(user, "enfermeria", "medico") && (
              <button className="btn" onClick={solicitarAlta}>Solicitar alta</button>
            )}
            {sel.alta_solicitada_en && hasRole(user, "enfermeria", "medico") && (
              <button className="btn-secondary" onClick={cancelarAlta}>Cancelar alta</button>
            )}
          </div>
        </div>
      )}

      {/* Modal Hospitalizar paciente */}
      {showHosp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-lg space-y-3 max-h-[90vh] overflow-auto">
            <h2 className="font-semibold text-lg">Hospitalizar paciente</h2>
            <p className="text-xs text-slate-500">
              Asignar habitacion no requiere registrar cargos previos. Si el paciente no tiene episodio activo se abre uno automaticamente.
            </p>

            <div>
              <label className="text-xs font-medium">Paciente *</label>
              <input
                className="input"
                placeholder="Buscar por nombre, expediente o documento..."
                value={busqPac}
                onChange={(e) => buscarPacientes(e.target.value)}
              />
              {pacientesBusq.length > 0 && (
                <div className="border rounded mt-1 max-h-40 overflow-auto">
                  {pacientesBusq.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setHospForm({ ...hospForm, paciente_id: p.id }); setBusqPac(`${p.nombres} ${p.apellidos} (${p.expediente})`); setPacientesBusq([]); }}
                      className={`block w-full text-left px-2 py-1 text-sm hover:bg-blue-50 ${hospForm.paciente_id == p.id ? "bg-blue-100" : ""}`}
                    >
                      {p.expediente} - {p.nombres} {p.apellidos} {p.documento_numero ? `(${p.documento_numero})` : ""}
                    </button>
                  ))}
                </div>
              )}
              {hospForm.paciente_id && pacientesBusq.length === 0 && (
                <div className="text-xs text-green-700 mt-1">Paciente seleccionado.</div>
              )}
              <p className="text-xs text-slate-500 mt-1">Si no esta registrado, ve primero al modulo <strong>Pacientes</strong>.</p>
            </div>

            <div>
              <label className="text-xs font-medium">Habitacion disponible *</label>
              <select className="input" value={hospForm.habitacion_id} onChange={(e) => setHospForm({ ...hospForm, habitacion_id: e.target.value })}>
                <option value="">-- Seleccionar --</option>
                {habDisponibles.length === 0 && <option disabled>No hay habitaciones disponibles</option>}
                {habDisponibles.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.numero} - {h.tipo} (${Number(h.precio_diario).toFixed(2)}/dia) - {h.ocupantes_actuales}/{h.capacidad}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium">Medico de cabecera *</label>
              <select className="input" value={hospForm.medico_cabecera_id} onChange={(e) => setHospForm({ ...hospForm, medico_cabecera_id: e.target.value })}>
                <option value="">-- Seleccionar medico --</option>
                {medicos.length === 0 && <option disabled>No hay medicos registrados</option>}
                {medicos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombres} {m.apellidos}{m.especialidad ? ` - ${m.especialidad}` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">Si el medico no aparece, registrarlo primero en <strong>Profesionales</strong>.</p>
            </div>

            <div>
              <label className="text-xs font-medium">Motivo de ingreso</label>
              <input className="input" value={hospForm.motivo} onChange={(e) => setHospForm({ ...hospForm, motivo: e.target.value })} />
            </div>

            <div>
              <label className="text-xs font-medium">Observaciones</label>
              <textarea className="input" value={hospForm.observaciones} onChange={(e) => setHospForm({ ...hospForm, observaciones: e.target.value })} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setShowHosp(false)}>Cancelar</button>
              <button className="btn" onClick={hospitalizar} disabled={!hospForm.paciente_id || !hospForm.habitacion_id}>Hospitalizar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de cargo / requisicion */}
      {cargo && sel && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-2xl space-y-3 max-h-[90vh] overflow-auto">
            <div className="flex justify-between">
              <h2 className="font-semibold">{cargoConfig[cargo].label}</h2>
              <button className="btn-secondary" onClick={() => setCargo(null)}>Cerrar</button>
            </div>
            <p className="text-xs text-slate-500">{cargoConfig[cargo].descripcion}</p>

            {cargoConfig[cargo].tipo === "cargo" ? (
              <>
                <div>
                  <label className="text-xs font-medium">Producto</label>
                  <select className="input" value={cargoForm.producto_id} onChange={(e) => setCargoForm({ ...cargoForm, producto_id: e.target.value })}>
                    <option value="">-- Seleccionar --</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>{p.codigo} - {p.nombre} (${Number(p.precio_venta).toFixed(2)})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium">Area donde se presta el servicio</label>
                  <select className="input" value={cargoForm.area_id} onChange={(e) => setCargoForm({ ...cargoForm, area_id: e.target.value })}>
                    <option value="">-- Seleccionar --</option>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium">Cantidad</label>
                  <input className="input" type="number" step="0.01" value={cargoForm.cantidad} onChange={(e) => setCargoForm({ ...cargoForm, cantidad: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium">Observaciones</label>
                  <input className="input" value={cargoForm.observaciones} onChange={(e) => setCargoForm({ ...cargoForm, observaciones: e.target.value })} />
                </div>
                <p className="text-xs text-slate-500">Servicio: se registra como cargo directo al paciente. No descuenta stock.</p>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium">Area solicitante (opcional)</label>
                    <select className="input" value={cargoForm.area_id} onChange={(e) => setCargoForm({ ...cargoForm, area_id: e.target.value })}>
                      <option value="">-- No especificada --</option>
                      {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium">Prioridad</label>
                    <select className="input" value={cargoForm.prioridad ?? "normal"} onChange={(e) => setCargoForm({ ...cargoForm, prioridad: e.target.value })}>
                      <option value="normal">Normal</option>
                      <option value="urgente">Urgente</option>
                      <option value="stat">STAT (inmediato)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium">Productos solicitados</label>
                    <button
                      className="text-xs text-emerald-700 font-medium hover:underline"
                      onClick={() => setReqLineas([...reqLineas, { producto_id: "", cantidad: 1 }])}
                    >
                      + Agregar producto
                    </button>
                  </div>
                  <div className="space-y-2">
                    {reqLineas.map((linea, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <select
                          className="input flex-1"
                          value={linea.producto_id}
                          onChange={(e) => {
                            const copia = [...reqLineas];
                            copia[idx] = { ...copia[idx], producto_id: e.target.value };
                            setReqLineas(copia);
                          }}
                        >
                          <option value="">-- Seleccionar --</option>
                          {productos.map((p) => (
                            <option key={p.id} value={p.id}>{p.codigo} - {p.nombre}</option>
                          ))}
                        </select>
                        <input
                          className="input w-20 text-center"
                          type="number"
                          min="1"
                          step="1"
                          value={linea.cantidad}
                          onChange={(e) => {
                            const copia = [...reqLineas];
                            copia[idx] = { ...copia[idx], cantidad: Number(e.target.value) };
                            setReqLineas(copia);
                          }}
                        />
                        {reqLineas.length > 1 && (
                          <button
                            className="text-red-500 hover:text-red-700 text-lg leading-none px-1"
                            onClick={() => setReqLineas(reqLineas.filter((_, i) => i !== idx))}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium">Observaciones</label>
                  <input className="input" value={cargoForm.observaciones} onChange={(e) => setCargoForm({ ...cargoForm, observaciones: e.target.value })} />
                </div>
                <p className="text-xs text-amber-700">
                  Esta solicitud llegara a la bandeja de farmacia interna. Farmacia validara el lote y despachara.
                  El cargo al paciente se registra automaticamente al despachar.
                </p>
              </>
            )}

            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setCargo(null)}>Cancelar</button>
              <button className="btn" onClick={submitCargo}>
                {cargoConfig[cargo].tipo === "requisicion" ? "Enviar a farmacia" : "Registrar cargo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de devolucion multi-producto */}
      {devModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-xl space-y-4 max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold">Solicitar devolucion a farmacia</h2>
              <button className="btn-secondary text-xs" onClick={() => setDevModal(null)}>Cancelar</button>
            </div>

            <div>
              <label className="text-xs font-medium">Farmacia que recibe *</label>
              <select
                className="input"
                value={devModal.areaId}
                onChange={(e) => setDevModal({ ...devModal, areaId: e.target.value })}
              >
                <option value="">-- Seleccionar farmacia --</option>
                {areasDevolucion.map((a) => (
                  <option key={a.id} value={a.id}>{a.nombre}</option>
                ))}
              </select>
              {!areasDevolucion.length && (
                <p className="text-xs text-red-600 mt-1">No hay areas de farmacia configuradas.</p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-600">
                Selecciona los productos a devolver y confirma o corrige el lote:
              </p>
              {devModal.lineas.map((linea, i) => (
                <div
                  key={i}
                  className={`border rounded-lg p-3 transition-colors ${
                    linea.seleccionado ? "border-blue-400 bg-blue-50/30" : "border-slate-200 bg-white"
                  }`}
                >
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 shrink-0"
                      checked={linea.seleccionado}
                      onChange={(e) => updateDevLinea(i, { seleccionado: e.target.checked })}
                    />
                    <span className="font-medium text-sm">{linea.producto}</span>
                  </label>

                  {!linea.seleccionado && (
                    <div className="text-xs text-slate-400 mt-1 ml-5">
                      Cant: {linea.maxCant}
                      {linea.numeroLoteOriginal && ` · Lote: ${linea.numeroLoteOriginal}`}
                      {linea.fechaVencOriginal && ` · Vence: ${linea.fechaVencOriginal}`}
                    </div>
                  )}

                  {linea.seleccionado && (
                    <div className="mt-2 ml-5 grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">Cantidad (max {linea.maxCant})</label>
                        <input
                          className="input text-sm"
                          type="number"
                          min="0.01"
                          step="0.01"
                          max={linea.maxCant}
                          value={linea.cantidad}
                          onChange={(e) => updateDevLinea(i, { cantidad: Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Lote a devolver</label>
                        <select
                          className="input text-sm"
                          value={linea.loteSeleccionadoId}
                          onChange={(e) => updateDevLinea(i, { loteSeleccionadoId: e.target.value })}
                        >
                          <option value="">Sin lote</option>
                          {linea.lotes.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.numero_lote} — {l.fecha_vencimiento}
                              {l.id === linea.loteOriginalId ? " ★" : ""}
                            </option>
                          ))}
                        </select>
                        {linea.loteOriginalId && (
                          <p className="text-xs text-slate-400 mt-0.5">★ lote original del despacho</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div>
              <label className="text-xs font-medium">Observaciones (opcional)</label>
              <input
                className="input"
                placeholder="ej. Medicamentos no administrados"
                value={devModal.obs}
                onChange={(e) => setDevModal({ ...devModal, obs: e.target.value })}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setDevModal(null)}>Cancelar</button>
              <button
                className="btn"
                onClick={submitDevolucion}
                disabled={!devModal.areaId || !devModal.lineas.some((l) => l.seleccionado)}
              >
                Enviar solicitud a farmacia
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
