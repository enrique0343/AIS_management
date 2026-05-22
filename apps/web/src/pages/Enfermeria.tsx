import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Pac = { id: number; nombres: string; apellidos: string; expediente: string };
type Episodio = { id: number; estado: string; fecha_inicio: string; motivo: string | null };
type Prod = { id: number; codigo: string; nombre: string; es_controlado: number };
type Area = { id: number; nombre: string };
type Consumo = { id: number; producto: string; cantidad: number; precio_venta_snapshot: number; fecha: string; numero_lote: string | null };

export default function Enfermeria() {
  const [pacQ, setPacQ] = useState("");
  const [pacientes, setPacientes] = useState<Pac[]>([]);
  const [pac, setPac] = useState<Pac | null>(null);
  const [episodios, setEpisodios] = useState<Episodio[]>([]);
  const [episodio, setEpisodio] = useState<Episodio | null>(null);
  const [consumos, setConsumos] = useState<Consumo[]>([]);
  const [prods, setProds] = useState<Prod[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [form, setForm] = useState<any>({ producto_id: "", area_id: "", cantidad: 1 });

  useEffect(() => {
    api.get<{ data: Prod[] }>("/api/productos").then((r) => setProds(r.data));
    api.get<{ data: Area[] }>("/api/catalogos/areas").then((r) => setAreas(r.data));
  }, []);

  const buscarPac = async () => {
    const r = await api.get<{ data: Pac[] }>(`/api/pacientes?q=${encodeURIComponent(pacQ)}`);
    setPacientes(r.data);
  };

  const seleccionarPac = async (p: Pac) => {
    setPac(p);
    const r = await api.get<{ paciente: any; episodios: Episodio[] }>(`/api/pacientes/${p.id}`);
    setEpisodios(r.episodios);
  };

  const abrirEpisodio = async () => {
    if (!pac) return;
    const r = await api.post<{ id: number }>(`/api/pacientes/${pac.id}/episodios`, { motivo: "Atencion" });
    await seleccionarPac(pac);
    const ep = (await api.get<{ paciente: any; episodios: Episodio[] }>(`/api/pacientes/${pac.id}`)).episodios.find((e) => e.id === r.id);
    if (ep) elegirEpisodio(ep);
  };

  const elegirEpisodio = async (e: Episodio) => {
    setEpisodio(e);
    const r = await api.get<{ data: Consumo[] }>(`/api/enfermeria/consumos?episodio_id=${e.id}`);
    setConsumos(r.data);
  };

  const registrar = async () => {
    if (!episodio) return;
    await api.post("/api/enfermeria/consumos", {
      episodio_id: episodio.id,
      producto_id: Number(form.producto_id),
      area_id: Number(form.area_id),
      cantidad: Number(form.cantidad),
    });
    setForm({ producto_id: "", area_id: form.area_id, cantidad: 1 });
    elegirEpisodio(episodio);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Enfermeria - control de consumo</h1>

      {!pac && (
        <div className="card space-y-2">
          <div className="flex gap-2">
            <input className="input" placeholder="Buscar paciente..." value={pacQ} onChange={(e) => setPacQ(e.target.value)} />
            <button className="btn" onClick={buscarPac}>Buscar</button>
          </div>
          <ul className="divide-y">
            {pacientes.map((p) => (
              <li key={p.id} className="py-2 flex justify-between">
                <span>{p.expediente} - {p.nombres} {p.apellidos}</span>
                <button className="btn-secondary text-xs" onClick={() => seleccionarPac(p)}>Seleccionar</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pac && (
        <div className="card space-y-3">
          <div className="flex justify-between">
            <div>
              <div className="font-semibold">{pac.nombres} {pac.apellidos}</div>
              <div className="text-sm text-slate-500">{pac.expediente}</div>
            </div>
            <button className="btn-secondary" onClick={() => { setPac(null); setEpisodio(null); }}>Cambiar paciente</button>
          </div>

          <div className="flex gap-2 items-center">
            <select className="input" value={episodio?.id ?? ""} onChange={(e) => {
              const ep = episodios.find((x) => x.id === Number(e.target.value)) ?? null;
              if (ep) elegirEpisodio(ep);
            }}>
              <option value="">-- Episodio --</option>
              {episodios.map((e) => <option key={e.id} value={e.id}>#{e.id} - {e.fecha_inicio} ({e.estado})</option>)}
            </select>
            <button className="btn" onClick={abrirEpisodio}>Abrir nuevo episodio</button>
          </div>

          {episodio && (
            <>
              <h3 className="font-semibold">Registrar consumo</h3>
              <div className="grid grid-cols-12 gap-2">
                <select className="input col-span-5" value={form.producto_id} onChange={(e) => setForm({ ...form, producto_id: e.target.value })}>
                  <option value="">-- Producto --</option>
                  {prods.map((p) => <option key={p.id} value={p.id}>{p.codigo} - {p.nombre}{p.es_controlado ? " (CTRL)" : ""}</option>)}
                </select>
                <select className="input col-span-4" value={form.area_id} onChange={(e) => setForm({ ...form, area_id: e.target.value })}>
                  <option value="">-- Area --</option>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
                <input className="input col-span-2" type="number" placeholder="Cant" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} />
                <button className="btn col-span-1" onClick={registrar}>+</button>
              </div>
              <p className="text-xs text-slate-500">
                Productos controlados: el registro fisico en libro autorizado por SRS y la receta especial retenida se manejan fuera del sistema.
              </p>

              <h3 className="font-semibold">Consumos del episodio</h3>
              <table className="table">
                <thead><tr><th>Fecha</th><th>Producto</th><th>Lote</th><th>Cant</th><th>Precio</th></tr></thead>
                <tbody>
                  {consumos.map((c) => (
                    <tr key={c.id}>
                      <td>{c.fecha}</td>
                      <td>{c.producto}</td>
                      <td>{c.numero_lote ?? "-"}</td>
                      <td>{c.cantidad}</td>
                      <td>{Number(c.precio_venta_snapshot).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
