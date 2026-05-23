import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Tab = "ocupacion" | "rotacion" | "dias_inventario" | "financiero" | "inventario_resumen";

export default function Reportes() {
  const [tab, setTab] = useState<Tab>("financiero");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Reportes</h1>
      <div className="flex gap-2 border-b flex-wrap">
        {([
          ["financiero", "Ingresos vs Gastos"],
          ["ocupacion", "Ocupacion"],
          ["rotacion", "Rotacion"],
          ["dias_inventario", "Dias de inventario"],
          ["inventario_resumen", "Resumen inventario"],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm border-b-2 ${tab === t ? "border-blue-600 text-blue-600 font-medium" : "border-transparent text-slate-600"}`}>{label}</button>
        ))}
      </div>
      {tab === "financiero" && <Financiero />}
      {tab === "ocupacion" && <Ocupacion />}
      {tab === "rotacion" && <Rotacion />}
      {tab === "dias_inventario" && <DiasInventario />}
      {tab === "inventario_resumen" && <InventarioResumen />}
    </div>
  );
}

function defaultMonth() {
  const d = new Date(); d.setMonth(d.getMonth() - 5, 1);
  return d.toISOString().slice(0, 10);
}

function Financiero() {
  const [desde, setDesde] = useState(defaultMonth());
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<any | null>(null);
  const load = () => api.get<any>(`/api/reportes/financiero?desde=${desde}&hasta=${hasta}`).then(setData);
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end">
        <div><label className="text-xs">Desde</label><input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div><label className="text-xs">Hasta</label><input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <button className="btn" onClick={load}>Generar</button>
      </div>
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card"><div className="text-xs text-slate-500">Ingresos</div><div className="text-2xl font-semibold text-green-600">${Number(data.total.ingresos).toFixed(2)}</div></div>
            <div className="card"><div className="text-xs text-slate-500">Gastos operativos</div><div className="text-2xl font-semibold text-red-600">${Number(data.total.gastos).toFixed(2)}</div></div>
            <div className="card"><div className="text-xs text-slate-500">COGS (inventario consumido)</div><div className="text-2xl font-semibold text-orange-600">${Number(data.total.cogs).toFixed(2)}</div></div>
            <div className="card"><div className="text-xs text-slate-500">Neto</div><div className={`text-2xl font-semibold ${data.total.neto >= 0 ? "text-green-600" : "text-red-600"}`}>${Number(data.total.neto).toFixed(2)}</div></div>
          </div>
          <div className="card overflow-auto">
            <h3 className="font-semibold mb-2">Por mes</h3>
            <table className="table">
              <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>COGS</th><th>Neto</th></tr></thead>
              <tbody>
                {data.mensual.map((m: any) => (
                  <tr key={m.mes}>
                    <td>{m.mes}</td>
                    <td className="text-green-600">${Number(m.ingresos).toFixed(2)}</td>
                    <td className="text-red-600">${Number(m.gastos).toFixed(2)}</td>
                    <td className="text-orange-600">${Number(m.cogs).toFixed(2)}</td>
                    <td className={m.neto >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>${Number(m.neto).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card overflow-auto">
            <h3 className="font-semibold mb-2">Gastos por categoria</h3>
            <table className="table">
              <thead><tr><th>Categoria</th><th>Total</th></tr></thead>
              <tbody>
                {data.gastos_por_categoria.map((g: any) => (
                  <tr key={g.categoria}><td>{g.categoria}</td><td>${Number(g.total).toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Ocupacion() {
  const [desde, setDesde] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<any | null>(null);
  const load = () => api.get<any>(`/api/reportes/ocupacion?desde=${desde}&hasta=${hasta}`).then(setData);
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end">
        <div><label className="text-xs">Desde</label><input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div><label className="text-xs">Hasta</label><input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <button className="btn" onClick={load}>Generar</button>
      </div>
      {data && (
        <>
          <div className="card">
            <div className="text-sm">Ocupacion global del periodo ({data.dias_periodo} dias):</div>
            <div className="text-3xl font-semibold text-blue-600">{data.porcentaje_ocupacion_global}%</div>
          </div>
          <div className="card overflow-auto">
            <table className="table">
              <thead><tr><th>Habitacion</th><th>Tipo</th><th>Cap</th><th>Dias ocupados</th><th>Dias disponibles</th><th>%</th></tr></thead>
              <tbody>
                {data.data.map((h: any) => (
                  <tr key={h.id}>
                    <td>{h.numero}</td><td>{h.tipo}</td><td>{h.capacidad}</td>
                    <td>{h.dias_ocupados}</td><td>{h.dias_disponibles}</td>
                    <td className={h.porcentaje_ocupacion > 80 ? "text-red-600 font-medium" : ""}>{h.porcentaje_ocupacion}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Rotacion() {
  const [desde, setDesde] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<any | null>(null);
  const load = () => api.get<any>(`/api/reportes/rotacion?desde=${desde}&hasta=${hasta}`).then(setData);
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end">
        <div><label className="text-xs">Desde</label><input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div><label className="text-xs">Hasta</label><input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <button className="btn" onClick={load}>Generar</button>
      </div>
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card"><div className="text-xs text-slate-500">Pacientes egresados</div><div className="text-2xl font-semibold">{data.egresos}</div></div>
          <div className="card"><div className="text-xs text-slate-500">Camas (capacidad)</div><div className="text-2xl font-semibold">{data.camas}</div></div>
          <div className="card"><div className="text-xs text-slate-500">Indice rotacion</div><div className="text-2xl font-semibold text-blue-600">{data.indice_rotacion}</div></div>
        </div>
      )}
    </div>
  );
}

function DiasInventario() {
  const [ventana, setVentana] = useState("30");
  const [data, setData] = useState<any[]>([]);
  const load = () => api.get<{ data: any[] }>(`/api/reportes/dias-inventario?ventana_dias=${ventana}`).then((r) => setData(r.data));
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end">
        <div><label className="text-xs">Ventana (dias)</label><input className="input w-24" type="number" value={ventana} onChange={(e) => setVentana(e.target.value)} /></div>
        <button className="btn" onClick={load}>Generar</button>
      </div>
      <div className="card overflow-auto">
        <table className="table">
          <thead><tr><th>Codigo</th><th>Producto</th><th>Stock</th><th>UM</th><th>Consumido (ventana)</th><th>Consumo/dia</th><th>Dias cobertura</th></tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className={r.dias_cobertura !== null && r.dias_cobertura < 7 ? "bg-red-50" : r.dias_cobertura !== null && r.dias_cobertura < 14 ? "bg-amber-50" : ""}>
                <td>{r.codigo}</td><td>{r.nombre}</td><td>{r.stock}</td><td>{r.unidad}</td>
                <td>{r.consumido_ventana}</td>
                <td>{r.consumo_diario}</td>
                <td>{r.dias_cobertura === null ? <span className="text-slate-400">sin consumo</span> : `${r.dias_cobertura} dias`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InventarioResumen() {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { api.get<any>("/api/reportes/inventario-resumen").then(setData); }, []);
  if (!data) return null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="card"><div className="text-xs text-slate-500">Productos activos</div><div className="text-2xl font-semibold">{data.totales.productos_activos}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Unidades totales</div><div className="text-2xl font-semibold">{data.totales.unidades_totales}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Valor total</div><div className="text-2xl font-semibold text-green-600">${Number(data.totales.valor_total).toFixed(2)}</div></div>
      </div>
      <div className="card overflow-auto">
        <h3 className="font-semibold mb-2">Por categoria</h3>
        <table className="table">
          <thead><tr><th>Categoria</th><th>Prefijo</th><th>Productos</th><th>Unidades</th><th>Valor</th></tr></thead>
          <tbody>
            {data.por_categoria.map((c: any) => (
              <tr key={c.prefijo}>
                <td>{c.categoria}</td><td className="font-mono text-xs">{c.prefijo}</td>
                <td>{c.productos}</td><td>{c.unidades}</td><td>${Number(c.valor).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
