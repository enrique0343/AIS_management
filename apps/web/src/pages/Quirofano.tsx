import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Cir = {
  id: number;
  codigo: string;
  fecha_programada: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  quirofano: string;
  paciente_id: number | null;
  paciente_nombre: string | null;
  tipo_cirugia: string | null;
  estado: string;
};

type Q = { id: number; nombre: string };
type Prod = { id: number; codigo: string; nombre: string };
type Area = { id: number; nombre: string };
type ConsumoCir = { id: number; producto: string; codigo: string; numero_lote: string | null; cantidad: number; costo_unitario_snapshot: number; consumo_id: number | null };

export default function Quirofano() {
  const [cirugias, setCirugias] = useState<Cir[]>([]);
  const [quirofanos, setQuirofanos] = useState<Q[]>([]);
  const [prods, setProds] = useState<Prod[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [consumosCir, setConsumosCir] = useState<{ cirugia: Cir; lista: ConsumoCir[] } | null>(null);
  const [cForm, setCForm] = useState<any>({ producto_id: "", area_id: "", cantidad: 1 });
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<any>({
    quirofano_id: "",
    fecha_programada: "",
    hora_inicio: "",
    hora_fin: "",
    paciente_pendiente_nombre: "",
    tipo_cirugia: "",
  });

  const load = () => api.get<{ data: Cir[] }>("/api/quirofano/cirugias").then((r) => setCirugias(r.data));

  useEffect(() => {
    load();
    api.get<{ data: Q[] }>("/api/quirofano/quirofanos").then((r) => setQuirofanos(r.data));
    api.get<{ data: Prod[] }>("/api/productos").then((r) => setProds(r.data));
    api.get<{ data: Area[] }>("/api/catalogos/areas").then((r) => setAreas(r.data));
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
    } catch (e: any) {
      alert(e.message);
    }
  };

  const submit = async () => {
    await api.post("/api/quirofano/cirugias", {
      ...form,
      quirofano_id: Number(form.quirofano_id),
    });
    setShow(false);
    setForm({ quirofano_id: "", fecha_programada: "", hora_inicio: "", hora_fin: "", paciente_pendiente_nombre: "", tipo_cirugia: "" });
    load();
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
    } catch (e: any) {
      alert(e.message);
    }
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Quirofano</h1>
        <button className="btn" onClick={() => setShow(true)}>Programar cirugia</button>
      </div>
      <div className="card overflow-auto">
        <table className="table">
          <thead>
            <tr><th>Codigo</th><th>Fecha</th><th>Hora</th><th>Quirofano</th><th>Paciente</th><th>Tipo</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {cirugias.map((c) => (
              <tr key={c.id}>
                <td>{c.codigo}</td>
                <td>{c.fecha_programada}</td>
                <td>{c.hora_inicio ?? "-"} / {c.hora_fin ?? "-"}</td>
                <td>{c.quirofano}</td>
                <td>{c.paciente_nombre ?? <span className="text-orange-600">SIN ASOCIAR</span>}</td>
                <td>{c.tipo_cirugia ?? "-"}</td>
                <td>{c.estado}</td>
                <td className="space-x-1">
                  {!c.paciente_id && <button className="btn-secondary text-xs" onClick={() => asociar(c.id)}>Asociar</button>}
                  <button className="btn-secondary text-xs" onClick={() => abrirConsumos(c)}>Consumos</button>
                  <button className="btn-secondary text-xs" onClick={() => cambiarEstado(c.id)}>Estado</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {consumosCir && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-3xl space-y-3 max-h-[90vh] overflow-auto">
            <div className="flex justify-between">
              <h2 className="font-semibold">Consumos - {consumosCir.cirugia.codigo}</h2>
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
              </tbody>
            </table>
            <p className="text-xs text-slate-500">
              Al marcar la cirugia como "realizada" los consumos se vuelcan automaticamente al episodio del paciente para facturacion.
            </p>
          </div>
        </div>
      )}

      {show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-lg space-y-3">
            <h2 className="font-semibold">Programar cirugia</h2>
            <select className="input" value={form.quirofano_id} onChange={(e) => setForm({ ...form, quirofano_id: e.target.value })}>
              <option value="">-- Quirofano --</option>
              {quirofanos.map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
            </select>
            <input className="input" type="date" value={form.fecha_programada} onChange={(e) => setForm({ ...form, fecha_programada: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" type="time" value={form.hora_inicio} onChange={(e) => setForm({ ...form, hora_inicio: e.target.value })} />
              <input className="input" type="time" value={form.hora_fin} onChange={(e) => setForm({ ...form, hora_fin: e.target.value })} />
            </div>
            <input className="input" placeholder="Nombre paciente (si no esta registrado)" value={form.paciente_pendiente_nombre} onChange={(e) => setForm({ ...form, paciente_pendiente_nombre: e.target.value })} />
            <input className="input" placeholder="Tipo de cirugia" value={form.tipo_cirugia} onChange={(e) => setForm({ ...form, tipo_cirugia: e.target.value })} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShow(false)}>Cancelar</button>
              <button className="btn" onClick={submit}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
