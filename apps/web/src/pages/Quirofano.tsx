import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Cir = {
  id: number;
  codigo: string;
  fecha_programada: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  inicio_at: string | null;
  fin_at: string | null;
  quirofano: string;
  paciente_id: number | null;
  paciente_nombre: string | null;
  tipo_cirugia: string | null;
  estado: string;
  cirujano_nombre: string | null;
  ayudante_nombre: string | null;
  anestesiologo_nombre: string | null;
};

type Q = { id: number; nombre: string };
type Prod = { id: number; codigo: string; nombre: string };
type Area = { id: number; nombre: string };
type ConsumoCir = { id: number; producto: string; codigo: string; numero_lote: string | null; cantidad: number; costo_unitario_snapshot: number; consumo_id: number | null };

const estadoColor: Record<string, string> = {
  programada: "bg-blue-50 border-blue-300",
  en_curso: "bg-amber-50 border-amber-300",
  realizada: "bg-green-50 border-green-300",
  suspendida: "bg-slate-100 border-slate-300",
  cancelada: "bg-red-50 border-red-300",
};

const estadoBadge: Record<string, string> = {
  programada: "bg-blue-100 text-blue-700",
  en_curso: "bg-amber-100 text-amber-700",
  realizada: "bg-green-100 text-green-700",
  suspendida: "bg-slate-100 text-slate-600",
  cancelada: "bg-red-100 text-red-600",
};

const fmtHora = (c: Cir) => {
  if (c.inicio_at) return c.inicio_at.slice(11, 16);
  return c.hora_inicio ?? "--";
};
const fmtHoraFin = (c: Cir) => {
  if (c.fin_at) return c.fin_at.slice(11, 16);
  return c.hora_fin ?? "--";
};

function CalendarioCelda({ q, d, cirugias, onClick }: {
  q: Q; d: Date; cirugias: Cir[]; onClick: (c: Cir) => void;
}) {
  const fechaStr = d.toISOString().slice(0, 10);
  const items = cirugias.filter((c) => c.quirofano === q.nombre && c.fecha_programada === fechaStr);
  return (
    <div className="min-h-[90px] p-1 border space-y-1">
      {items.map((c) => (
        <button
          key={c.id}
          onClick={() => onClick(c)}
          className={`block w-full text-left text-xs p-1.5 rounded border ${estadoColor[c.estado] ?? "bg-white"}`}
        >
          <div className="font-semibold">{fmtHora(c)}–{fmtHoraFin(c)}</div>
          <div className="font-medium truncate">{c.tipo_cirugia ?? "—"}</div>
          <div className="truncate text-slate-600">{c.paciente_nombre ?? "Sin paciente"}</div>
          {c.cirujano_nombre && <div className="truncate text-slate-500">{c.cirujano_nombre}</div>}
        </button>
      ))}
    </div>
  );
}

export default function Quirofano() {
  const [cirugias, setCirugias] = useState<Cir[]>([]);
  const [quirofanos, setQuirofanos] = useState<Q[]>([]);
  const [prods, setProds] = useState<Prod[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [pacientes, setPacientes] = useState<any[]>([]);
  const [medicos, setMedicos] = useState<any[]>([]);
  const [consumosCir, setConsumosCir] = useState<{ cirugia: Cir; lista: ConsumoCir[] } | null>(null);
  const [detalle, setDetalle] = useState<Cir | null>(null);
  const [cForm, setCForm] = useState<any>({ producto_id: "", area_id: "", cantidad: 1 });
  const [show, setShow] = useState(false);

  const blankCirugia = {
    quirofano_id: "", inicio_at: "", fin_at: "", paciente_id: "",
    paciente_pendiente_nombre: "", tipo_cirugia: "", medico_principal_id: "",
    cirujano_ayudante_id: "", anestesiologo_id: "", observaciones: "",
  };
  const [form, setForm] = useState<any>(blankCirugia);

  const [vista, setVista] = useState<"calendario" | "dia" | "tabla">("calendario");

  const [semanaBase, setSemanaBase] = useState<Date>(() => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [diaBase, setDiaBase] = useState<Date>(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  });

  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(semanaBase); d.setDate(d.getDate() + i); return d;
  });

  const fmtDia = (d: Date) => d.toISOString().slice(0, 10);

  const diasNombre = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const fmtDiaLegible = (d: Date) =>
    `${diasNombre[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;

  const load = () => {
    let url: string;
    if (vista === "calendario") {
      url = `/api/quirofano/cirugias?desde=${fmtDia(dias[0])}&hasta=${fmtDia(dias[6])}`;
    } else if (vista === "dia") {
      url = `/api/quirofano/cirugias?desde=${fmtDia(diaBase)}&hasta=${fmtDia(diaBase)}`;
    } else {
      url = "/api/quirofano/cirugias";
    }
    api.get<{ data: Cir[] }>(url).then((r) => setCirugias(r.data));
  };

  useEffect(() => { load(); }, [vista, semanaBase, diaBase]);
  useEffect(() => {
    api.get<{ data: Q[] }>("/api/quirofano/quirofanos").then((r) => setQuirofanos(r.data));
    api.get<{ data: Prod[] }>("/api/productos").then((r) => setProds(r.data));
    api.get<{ data: Area[] }>("/api/catalogos/areas").then((r) => setAreas(r.data));
    api.get<{ data: any[] }>("/api/pacientes").then((r) => setPacientes(r.data));
    api.get<{ data: any[] }>("/api/profesionales/medicos").then((r) => setMedicos(r.data));
  }, []);

  const abrirConsumos = async (c: Cir) => {
    const r = await api.get<{ data: ConsumoCir[] }>(`/api/quirofano/cirugias/${c.id}/consumos`);
    setConsumosCir({ cirugia: c, lista: r.data });
  };

  const regCons = async () => {
    if (!consumosCir) return;
    try {
      await api.post(`/api/quirofano/cirugias/${consumosCir.cirugia.id}/consumos`, {
        producto_id: Number(cForm.producto_id),
        area_id: Number(cForm.area_id),
        cantidad: Number(cForm.cantidad),
      });
      setCForm({ ...cForm, producto_id: "", cantidad: 1 });
      abrirConsumos(consumosCir.cirugia);
    } catch (e: any) { alert(e.message); }
  };

  const submit = async () => {
    if (!form.quirofano_id || !form.inicio_at || !form.fin_at || !form.medico_principal_id) {
      alert("Quirofano, inicio, fin y cirujano son obligatorios");
      return;
    }
    if (form.fin_at <= form.inicio_at) {
      alert("La hora de fin debe ser posterior a la de inicio");
      return;
    }
    try {
      await api.post("/api/quirofano/cirugias", {
        quirofano_id: Number(form.quirofano_id),
        inicio_at: form.inicio_at,
        fin_at: form.fin_at,
        paciente_id: form.paciente_id ? Number(form.paciente_id) : null,
        paciente_pendiente_nombre: form.paciente_id ? null : (form.paciente_pendiente_nombre || null),
        tipo_cirugia: form.tipo_cirugia || null,
        medico_principal_id: Number(form.medico_principal_id),
        cirujano_ayudante_id: form.cirujano_ayudante_id ? Number(form.cirujano_ayudante_id) : null,
        anestesiologo_id: form.anestesiologo_id ? Number(form.anestesiologo_id) : null,
        observaciones: form.observaciones || null,
      });
      setShow(false);
      setForm(blankCirugia);
      load();
    } catch (e: any) { alert(e.message); }
  };

  const asociar = async (id: number) => {
    const pid = prompt("ID del paciente:");
    if (!pid) return;
    await api.post(`/api/quirofano/cirugias/${id}/asociar-paciente`, { paciente_id: Number(pid) });
    load();
  };

  const cambiarEstado = async (id: number) => {
    const estado = prompt("Estado (programada/en_curso/realizada/suspendida/cancelada):");
    if (!estado) return;
    try {
      await api.post(`/api/quirofano/cirugias/${id}/estado`, { estado });
    } catch (e: any) { alert(e.message); }
    load();
  };

  const moverDia = (delta: number) => {
    const d = new Date(diaBase);
    d.setDate(d.getDate() + delta);
    setDiaBase(d);
    // Si estamos en vista dia y el dia cae fuera de la semana del calendario, actualizar semana también
    const lunes = new Date(d);
    const dow = (d.getDay() + 6) % 7;
    lunes.setDate(d.getDate() - dow);
    lunes.setHours(0, 0, 0, 0);
    setSemanaBase(lunes);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Quirofano</h1>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Toggle de vista */}
          <div className="flex border rounded overflow-hidden text-sm">
            {(["calendario", "dia", "tabla"] as const).map((v) => (
              <button
                key={v}
                className={`px-3 py-1.5 capitalize ${vista === v ? "bg-blue-600 text-white" : "bg-white hover:bg-slate-50"}`}
                onClick={() => setVista(v)}
              >
                {v === "calendario" ? "Semana" : v === "dia" ? "Día" : "Tabla"}
              </button>
            ))}
          </div>

          {/* Navegación semana */}
          {vista === "calendario" && (
            <div className="flex gap-1 items-center">
              <button className="btn-secondary text-xs" onClick={() => { const d = new Date(semanaBase); d.setDate(d.getDate() - 7); setSemanaBase(d); }}>&laquo;</button>
              <span className="text-xs px-2">{fmtDia(dias[0])} a {fmtDia(dias[6])}</span>
              <button className="btn-secondary text-xs" onClick={() => { const d = new Date(semanaBase); d.setDate(d.getDate() + 7); setSemanaBase(d); }}>&raquo;</button>
            </div>
          )}

          {/* Navegación día */}
          {vista === "dia" && (
            <div className="flex gap-1 items-center">
              <button className="btn-secondary text-xs" onClick={() => moverDia(-1)}>&laquo;</button>
              <span className="text-xs px-2 font-medium">{fmtDiaLegible(diaBase)}</span>
              <button className="btn-secondary text-xs" onClick={() => moverDia(1)}>&raquo;</button>
            </div>
          )}

          <button className="btn" onClick={() => setShow(true)}>Programar cirugia</button>
        </div>
      </div>

      {/* Vista semana */}
      {vista === "calendario" && (
        <div className="card overflow-auto">
          <div className="grid grid-cols-8 gap-0.5 min-w-[700px]">
            <div className="text-xs font-semibold p-2 bg-slate-50">Quirofano</div>
            {dias.map((d) => {
              const hoy = fmtDia(d) === fmtDia(new Date());
              return (
                <div
                  key={d.toISOString()}
                  className={`text-xs font-semibold p-2 text-center cursor-pointer hover:bg-blue-50 ${hoy ? "bg-blue-100 text-blue-700" : "bg-slate-100"}`}
                  onClick={() => { setDiaBase(new Date(d)); setVista("dia"); }}
                  title="Ver día"
                >
                  {["L", "M", "Mi", "J", "V", "S", "D"][((d.getDay() + 6) % 7)]} {d.getDate()}/{d.getMonth() + 1}
                </div>
              );
            })}
            {quirofanos.map((q) => (
              <>
                <div key={`q-${q.id}`} className="text-xs font-semibold p-2 bg-slate-50 border-r self-stretch flex items-start">{q.nombre}</div>
                {dias.map((d) => (
                  <CalendarioCelda key={`${q.id}-${d.toISOString()}`} q={q} d={d} cirugias={cirugias} onClick={setDetalle} />
                ))}
              </>
            ))}
          </div>
        </div>
      )}

      {/* Vista día */}
      {vista === "dia" && (
        <div className="space-y-4">
          {quirofanos.length === 0 && (
            <div className="card text-sm text-slate-500">Cargando quirofanos...</div>
          )}
          {quirofanos.map((q) => {
            const qs = cirugias.filter((c) => c.quirofano === q.nombre).sort((a, b) => fmtHora(a).localeCompare(fmtHora(b)));
            return (
              <div key={q.id} className="card">
                <h3 className="font-semibold text-slate-800 mb-3 pb-2 border-b">{q.nombre}</h3>
                {!qs.length ? (
                  <p className="text-sm text-slate-400 py-2">Sin cirugias programadas</p>
                ) : (
                  <div className="space-y-3">
                    {qs.map((c) => (
                      <div key={c.id} className={`rounded-lg border p-3 md:p-4 ${estadoColor[c.estado] ?? "bg-white"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0 space-y-2">
                            {/* Cabecera */}
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-base">{fmtHora(c)} – {fmtHoraFin(c)}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoBadge[c.estado] ?? ""}`}>
                                {c.estado}
                              </span>
                              <span className="text-xs text-slate-400 font-mono">{c.codigo}</span>
                            </div>

                            {/* Tipo de cirugía */}
                            <div className="font-semibold text-slate-800">
                              {c.tipo_cirugia ?? <span className="text-slate-400 font-normal">Sin tipo especificado</span>}
                            </div>

                            {/* Detalles en grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                              <div>
                                <span className="text-xs text-slate-500">Paciente</span>
                                <div className={c.paciente_nombre ? "font-medium" : "text-orange-500 font-medium"}>
                                  {c.paciente_nombre ?? "Sin asignar"}
                                </div>
                              </div>
                              <div>
                                <span className="text-xs text-slate-500">Cirujano</span>
                                <div className="font-medium">{c.cirujano_nombre ?? <span className="text-slate-400 font-normal">—</span>}</div>
                              </div>
                              <div>
                                <span className="text-xs text-slate-500">Anestesiologo</span>
                                <div className="font-medium">{c.anestesiologo_nombre ?? <span className="text-slate-400 font-normal">—</span>}</div>
                              </div>
                              {c.ayudante_nombre && (
                                <div>
                                  <span className="text-xs text-slate-500">Ayudante</span>
                                  <div className="font-medium">{c.ayudante_nombre}</div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Acciones */}
                          <div className="flex flex-col gap-1 shrink-0">
                            {!c.paciente_id && (
                              <button className="btn-secondary text-xs" onClick={() => asociar(c.id)}>Asociar</button>
                            )}
                            <button className="btn-secondary text-xs" onClick={() => abrirConsumos(c)}>Consumos</button>
                            <button className="btn-secondary text-xs" onClick={() => cambiarEstado(c.id)}>Estado</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Vista tabla */}
      {vista === "tabla" && (
        <div className="card overflow-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Codigo</th><th>Inicio</th><th>Fin</th><th>Quirofano</th>
                <th>Paciente</th><th>Tipo</th><th>Equipo medico</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {cirugias.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.codigo}</td>
                  <td className="text-xs whitespace-nowrap">{c.inicio_at ? c.inicio_at.replace("T", " ").slice(0, 16) : (c.fecha_programada + " " + (c.hora_inicio ?? "-"))}</td>
                  <td className="text-xs whitespace-nowrap">{c.fin_at ? c.fin_at.replace("T", " ").slice(0, 16) : (c.fecha_programada + " " + (c.hora_fin ?? "-"))}</td>
                  <td>{c.quirofano}</td>
                  <td>{c.paciente_nombre ?? <span className="text-orange-600 text-xs">SIN ASOCIAR</span>}</td>
                  <td>{c.tipo_cirugia ?? "-"}</td>
                  <td className="text-xs">
                    {c.cirujano_nombre && <div><span className="text-slate-500">Cirujano:</span> {c.cirujano_nombre}</div>}
                    {c.ayudante_nombre && <div><span className="text-slate-500">Ayudante:</span> {c.ayudante_nombre}</div>}
                    {c.anestesiologo_nombre && <div><span className="text-slate-500">Anest.:</span> {c.anestesiologo_nombre}</div>}
                  </td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${estadoBadge[c.estado] ?? ""}`}>{c.estado}</span>
                  </td>
                  <td className="space-x-1 whitespace-nowrap">
                    {!c.paciente_id && <button className="btn-secondary text-xs" onClick={() => asociar(c.id)}>Asociar</button>}
                    <button className="btn-secondary text-xs" onClick={() => abrirConsumos(c)}>Consumos</button>
                    <button className="btn-secondary text-xs" onClick={() => cambiarEstado(c.id)}>Estado</button>
                  </td>
                </tr>
              ))}
              {!cirugias.length && (
                <tr><td colSpan={9} className="text-center text-slate-400 py-4">Sin cirugias</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal detalle cirugia (desde calendario semanal) */}
      {detalle && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <span className="font-mono text-xs text-slate-400">{detalle.codigo}</span>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${estadoBadge[detalle.estado] ?? ""}`}>
                  {detalle.estado}
                </span>
              </div>
              <button className="btn-secondary text-xs" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>

            <h2 className="font-semibold text-lg leading-tight">
              {detalle.tipo_cirugia ?? <span className="text-slate-400 font-normal">Sin tipo de cirugia</span>}
            </h2>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Quirofano</div>
                <div className="font-medium">{detalle.quirofano}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Paciente</div>
                <div className={`font-medium ${!detalle.paciente_nombre ? "text-orange-500" : ""}`}>
                  {detalle.paciente_nombre ?? "Sin asignar"}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Hora inicio</div>
                <div className="font-medium text-base">{fmtHora(detalle)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Hora fin</div>
                <div className="font-medium text-base">{fmtHoraFin(detalle)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Cirujano</div>
                <div className="font-medium">{detalle.cirujano_nombre ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Anestesiologo</div>
                <div className="font-medium">{detalle.anestesiologo_nombre ?? "—"}</div>
              </div>
              {detalle.ayudante_nombre && (
                <div className="col-span-2">
                  <div className="text-xs text-slate-500 mb-0.5">Ayudante</div>
                  <div className="font-medium">{detalle.ayudante_nombre}</div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
              {!detalle.paciente_id && (
                <button className="btn-secondary text-xs" onClick={() => { asociar(detalle.id); setDetalle(null); }}>
                  Asociar paciente
                </button>
              )}
              <button className="btn-secondary text-xs" onClick={() => { cambiarEstado(detalle.id); setDetalle(null); }}>
                Cambiar estado
              </button>
              <button className="btn text-xs" onClick={() => { abrirConsumos(detalle); setDetalle(null); }}>
                Ver consumos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal consumos */}
      {consumosCir && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-3xl space-y-3 max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="font-semibold">Consumos - {consumosCir.cirugia.codigo}</h2>
                <div className="text-xs text-slate-500">{consumosCir.cirugia.tipo_cirugia} · {consumosCir.cirugia.paciente_nombre}</div>
              </div>
              <button className="btn-secondary" onClick={() => setConsumosCir(null)}>Cerrar</button>
            </div>
            <div className="grid grid-cols-12 gap-2">
              <select className="input col-span-5" value={cForm.producto_id} onChange={(e) => setCForm({ ...cForm, producto_id: e.target.value })}>
                <option value="">-- Producto --</option>
                {prods.map((p) => <option key={p.id} value={p.id}>{p.codigo} - {p.nombre}</option>)}
              </select>
              <select className="input col-span-4" value={cForm.area_id} onChange={(e) => setCForm({ ...cForm, area_id: e.target.value })}>
                <option value="">-- Area stock --</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
              <input className="input col-span-2" type="number" placeholder="Cant" value={cForm.cantidad} onChange={(e) => setCForm({ ...cForm, cantidad: e.target.value })} />
              <button className="btn col-span-1" onClick={regCons}>+</button>
            </div>
            <table className="table">
              <thead><tr><th>Producto</th><th>Lote</th><th>Cant</th><th>Costo</th><th>Facturado</th></tr></thead>
              <tbody>
                {consumosCir.lista.map((c) => (
                  <tr key={c.id}>
                    <td>{c.producto}</td>
                    <td>{c.numero_lote ?? "-"}</td>
                    <td>{c.cantidad}</td>
                    <td>{Number(c.costo_unitario_snapshot).toFixed(4)}</td>
                    <td>{c.consumo_id ? "Si" : ""}</td>
                  </tr>
                ))}
                {!consumosCir.lista.length && (
                  <tr><td colSpan={5} className="text-center text-slate-400 py-3">Sin consumos registrados</td></tr>
                )}
              </tbody>
            </table>
            <p className="text-xs text-slate-500">
              Al marcar la cirugia como "realizada" los consumos se vuelcan automaticamente al episodio del paciente para facturacion.
            </p>
          </div>
        </div>
      )}

      {/* Modal programar cirugia */}
      {show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-xl space-y-3 max-h-[90vh] overflow-auto">
            <h2 className="font-semibold text-lg">Programar cirugia</h2>

            <div>
              <label className="text-xs font-medium text-slate-700">Quirofano *</label>
              <select className="input" value={form.quirofano_id} onChange={(e) => setForm({ ...form, quirofano_id: e.target.value })}>
                <option value="">-- Seleccionar --</option>
                {quirofanos.map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-slate-700">Inicio *</label>
                <input className="input" type="datetime-local" step="60" value={form.inicio_at} onChange={(e) => setForm({ ...form, inicio_at: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Fin *</label>
                <input className="input" type="datetime-local" step="60" value={form.fin_at} onChange={(e) => setForm({ ...form, fin_at: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-slate-500 -mt-2">Soporta cirugias que cruzan medianoche.</p>

            <div>
              <label className="text-xs font-medium text-slate-700">Paciente</label>
              <select className="input" value={form.paciente_id} onChange={(e) => setForm({ ...form, paciente_id: e.target.value })}>
                <option value="">-- Sin asignar (asociar despues) --</option>
                {pacientes.map((p) => (
                  <option key={p.id} value={p.id}>{p.expediente} - {p.nombres} {p.apellidos}{p.documento_numero ? ` (${p.documento_numero})` : ""}</option>
                ))}
              </select>
            </div>
            {!form.paciente_id && (
              <input className="input" placeholder="O nombre temporal si aun no esta registrado" value={form.paciente_pendiente_nombre} onChange={(e) => setForm({ ...form, paciente_pendiente_nombre: e.target.value })} />
            )}

            <div>
              <label className="text-xs font-medium text-slate-700">Tipo de cirugia</label>
              <input className="input" placeholder="ej. Apendicectomia" value={form.tipo_cirugia} onChange={(e) => setForm({ ...form, tipo_cirugia: e.target.value })} />
            </div>

            <div className="pt-2 border-t">
              <h3 className="text-sm font-semibold mb-2">Equipo medico</h3>
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-medium text-slate-700">Cirujano *</label>
                  <select className="input" value={form.medico_principal_id} onChange={(e) => setForm({ ...form, medico_principal_id: e.target.value })}>
                    <option value="">-- Seleccionar cirujano --</option>
                    {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombres} {m.apellidos}{m.especialidad ? ` - ${m.especialidad}` : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Ayudante (opcional)</label>
                  <select className="input" value={form.cirujano_ayudante_id} onChange={(e) => setForm({ ...form, cirujano_ayudante_id: e.target.value })}>
                    <option value="">-- Sin ayudante --</option>
                    {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombres} {m.apellidos}{m.especialidad ? ` - ${m.especialidad}` : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Anestesiologo (opcional)</label>
                  <select className="input" value={form.anestesiologo_id} onChange={(e) => setForm({ ...form, anestesiologo_id: e.target.value })}>
                    <option value="">-- Sin anestesiologo --</option>
                    {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombres} {m.apellidos}{m.especialidad ? ` - ${m.especialidad}` : ""}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Observaciones</label>
              <textarea className="input" value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => { setShow(false); setForm(blankCirugia); }}>Cancelar</button>
              <button className="btn" onClick={submit}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
