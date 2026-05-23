import { useEffect, useState } from "react";
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
  ocupacion_id: number | null;
  habitacion: string | null;
  habitacion_tipo: string | null;
  habitacion_desde: string | null;
  consumos_pend: number;
  cirugia_proxima: string | null;
};

type CargoTipo = "servicios" | "laboratorio" | "imagenes" | "medicamentos";

const cargoConfig: Record<CargoTipo, { label: string; prefijos: string; color: string; descripcion: string }> = {
  servicios: { label: "Servicios", prefijos: "SVC,QUI", color: "bg-purple-600 hover:bg-purple-700", descripcion: "Consultas, servicios hospitalarios, quirurgicos" },
  laboratorio: { label: "Laboratorio", prefijos: "LAB", color: "bg-teal-600 hover:bg-teal-700", descripcion: "Examenes de laboratorio clinico" },
  imagenes: { label: "Imagenes", prefijos: "RAD", color: "bg-indigo-600 hover:bg-indigo-700", descripcion: "Radiologia y estudios de imagen" },
  medicamentos: { label: "Medicamentos / Insumos", prefijos: "MED,INS", color: "bg-emerald-600 hover:bg-emerald-700", descripcion: "Descarga del stock por FEFO con lote/vencimiento" },
};

export default function Atencion() {
  const { user } = useAuth();
  const [pacientes, setPacientes] = useState<EnAtencion[]>([]);
  const [sel, setSel] = useState<EnAtencion | null>(null);
  const [estado, setEstado] = useState<any | null>(null);
  const [cargo, setCargo] = useState<CargoTipo | null>(null);
  const [productos, setProductos] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [cargoForm, setCargoForm] = useState<any>({ producto_id: "", area_id: "", cantidad: 1, observaciones: "" });

  const loadList = () => api.get<{ data: EnAtencion[] }>("/api/pacientes/_en-atencion").then((r) => setPacientes(r.data));
  const loadEstado = (pid: number) => api.get<any>(`/api/pacientes/${pid}/estado-cuenta`).then(setEstado);

  useEffect(() => {
    loadList();
    api.get<{ data: any[] }>("/api/catalogos/areas").then((r) => setAreas(r.data));
  }, []);

  const abrir = async (p: EnAtencion) => {
    setSel(p);
    loadEstado(p.id);
  };

  const refrescar = () => {
    if (sel) loadEstado(sel.id);
    loadList();
  };

  const abrirCargo = async (tipo: CargoTipo) => {
    setCargo(tipo);
    const r = await api.get<{ data: any[] }>(`/api/productos?categoria_prefijo=${cargoConfig[tipo].prefijos}`);
    setProductos(r.data);
    setCargoForm({ producto_id: "", area_id: "", cantidad: 1, observaciones: "" });
  };

  const submitCargo = async () => {
    if (!sel || !cargoForm.producto_id || !cargoForm.area_id) {
      alert("Producto y area requeridos");
      return;
    }
    try {
      await api.post("/api/enfermeria/consumos", {
        episodio_id: sel.episodio_id,
        producto_id: Number(cargoForm.producto_id),
        area_id: Number(cargoForm.area_id),
        cantidad: Number(cargoForm.cantidad),
        observaciones: cargoForm.observaciones || null,
      });
      setCargo(null);
      refrescar();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const solicitarAlta = async () => {
    if (!sel) return;
    if (!confirm("Solicitar alta al paciente? Administracion lo revisara antes de cerrar.")) return;
    try {
      await api.post(`/api/pacientes/episodios/${sel.episodio_id}/solicitar-alta`, {});
      refrescar();
    } catch (e: any) { alert(e.message); }
  };

  const cancelarAlta = async () => {
    if (!sel) return;
    await api.post(`/api/pacientes/episodios/${sel.episodio_id}/cancelar-alta`, {});
    refrescar();
  };

  const devolver = async (consumoId: number, maxCant: number, producto: string) => {
    const cantStr = prompt(`Devolver ${producto}\nCantidad a devolver (max ${maxCant}):`, String(maxCant));
    if (!cantStr) return;
    const areaIdStr = prompt(
      "Area de farmacia interna donde reingresa el stock:\n" +
        areas.map((a) => `${a.id}: ${a.nombre}`).join("\n")
    );
    if (!areaIdStr) return;
    try {
      await api.post(`/api/enfermeria/consumos/${consumoId}/devolucion`, {
        cantidad: Number(cantStr),
        area_destino_id: Number(areaIdStr),
        observaciones: "Devolucion - no utilizado",
      });
      refrescar();
    } catch (e: any) { alert(e.message); }
  };

  const cerrarYFacturar = async () => {
    if (!sel) return;
    if (!confirm(`Cerrar cuenta de ${sel.nombres} ${sel.apellidos}?\nSe egresara la habitacion, se generara la factura interna y se cerrara el episodio.`)) return;
    try {
      const ivaStr = prompt("IVA % (0 si no aplica):", "13");
      if (ivaStr === null) return;
      const r = await api.post<any>(`/api/facturacion/episodios/${sel.episodio_id}/cerrar-y-facturar`, {
        iva_pct: Number(ivaStr || 0),
        permitir_cero: true,
      });
      alert(`Cuenta cerrada. Factura ${r.numero} por $${Number(r.total).toFixed(2)}`);
      setSel(null);
      setEstado(null);
      loadList();
    } catch (e: any) { alert(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Atencion de pacientes</h1>
        <button className="btn-secondary" onClick={loadList}>Refrescar</button>
      </div>

      {!sel ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {!pacientes.length && <div className="text-sm text-slate-500">No hay pacientes en atencion.</div>}
          {pacientes.map((p) => (
            <button
              key={p.episodio_id}
              onClick={() => abrir(p)}
              className={`card text-left hover:shadow-md transition border-l-4 ${p.alta_solicitada_en ? "border-amber-500" : "border-blue-500"}`}
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
                  <div className="text-slate-400">Sin habitacion asignada</div>
                )}
                {p.cirugia_proxima && <div className="text-xs">Cirugia: {p.cirugia_proxima}</div>}
                <div className="text-xs text-slate-500 mt-1">Inicio: {p.fecha_inicio}</div>
                <div className="text-xs">{p.consumos_pend} cargos pendientes de facturar</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-semibold">{sel.nombres} {sel.apellidos}</h2>
                <div className="text-sm text-slate-500">
                  Exp: {sel.expediente} - Episodio #{sel.episodio_id} - desde {sel.fecha_inicio}
                </div>
                <div className="text-sm mt-1">
                  {sel.habitacion ? <>Habitacion <strong>{sel.habitacion}</strong> ({sel.habitacion_tipo}) desde {sel.habitacion_desde}</> : <span className="text-slate-400">Sin habitacion asignada</span>}
                </div>
                {sel.cirugia_proxima && (
                  <div className="text-sm mt-1">Cirugia vinculada: <strong>{sel.cirugia_proxima}</strong></div>
                )}
                {sel.alta_solicitada_en && (
                  <div className="mt-2 inline-block px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs">
                    ALTA SOLICITADA en {sel.alta_solicitada_en} - administracion debe cerrar la cuenta
                  </div>
                )}
              </div>
              <button className="btn-secondary" onClick={() => { setSel(null); setEstado(null); }}>Volver</button>
            </div>
          </div>

          {/* Botones grandes de cargos */}
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
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripcion</th><th>Cant</th><th>Precio</th><th>Subtotal</th><th>Fact</th><th></th></tr></thead>
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
                      <td></td>
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
                      <td>
                        {!c.facturado && !c.es_servicio && c.cantidad > 0 && (
                          <button className="btn-secondary text-xs" onClick={() => devolver(c.id, c.cantidad, c.producto)}>Devolver</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-slate-500">
                "Devolver" reingresa el producto no utilizado al stock de la farmacia interna (preservando el lote). Solo aplica a productos no facturados.
              </p>
            </div>
          )}

          {/* Acciones de alta */}
          <div className="card flex flex-wrap gap-2 justify-end">
            {!sel.alta_solicitada_en && hasRole(user, "enfermeria", "medico") && (
              <button className="btn" onClick={solicitarAlta}>Solicitar alta</button>
            )}
            {sel.alta_solicitada_en && hasRole(user, "enfermeria", "medico") && (
              <button className="btn-secondary" onClick={cancelarAlta}>Cancelar alta</button>
            )}
            {hasRole(user, "facturacion") && (
              <button
                className="btn-danger"
                onClick={cerrarYFacturar}
                disabled={!sel.alta_solicitada_en && !confirm}
                title={!sel.alta_solicitada_en ? "Recomendado solicitar alta primero" : ""}
              >
                Cerrar cuenta y facturar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modal de cargo */}
      {cargo && sel && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-2xl space-y-3 max-h-[90vh] overflow-auto">
            <div className="flex justify-between">
              <h2 className="font-semibold">{cargoConfig[cargo].label}</h2>
              <button className="btn-secondary" onClick={() => setCargo(null)}>Cerrar</button>
            </div>
            <p className="text-xs text-slate-500">{cargoConfig[cargo].descripcion}</p>
            <select className="input" value={cargoForm.producto_id} onChange={(e) => setCargoForm({ ...cargoForm, producto_id: e.target.value })}>
              <option value="">-- Seleccionar --</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} - {p.nombre} (${Number(p.precio_venta).toFixed(2)})
                  {!p.requiere_lote_vencimiento ? "" : ` - Stock: ${p.existencia_total}`}
                </option>
              ))}
            </select>
            <select className="input" value={cargoForm.area_id} onChange={(e) => setCargoForm({ ...cargoForm, area_id: e.target.value })}>
              <option value="">-- Area de donde se dispensa --</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            <input className="input" type="number" step="0.01" placeholder="Cantidad" value={cargoForm.cantidad} onChange={(e) => setCargoForm({ ...cargoForm, cantidad: e.target.value })} />
            <input className="input" placeholder="Observaciones (opcional)" value={cargoForm.observaciones} onChange={(e) => setCargoForm({ ...cargoForm, observaciones: e.target.value })} />
            {cargo === "medicamentos" && (
              <p className="text-xs text-amber-700">El sistema descontara del stock por FEFO (primer lote por vencer) y registrara el movimiento en inventario.</p>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setCargo(null)}>Cancelar</button>
              <button className="btn" onClick={submitCargo}>Registrar cargo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
