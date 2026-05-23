import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";

type ReordenRow = { id: number; codigo: string; nombre: string; punto_reorden: number; existencia_total: number };
type VencimientoRow = {
  lote_id: number;
  numero_lote: string;
  fecha_vencimiento: string;
  producto_id: number;
  codigo: string;
  nombre: string;
  cantidad: number;
};

type Stats = {
  productos: number;
  pacientes: number;
  episodios_activos: number;
  cirugias_futuras: number;
  facturas_pendientes: number;
  monto_pendiente: number;
  ingresos_hoy: number;
  episodios_por_facturar: number;
  cargos_activos: number;
};

export default function Dashboard() {
  const [reorden, setReorden] = useState<ReordenRow[]>([]);
  const [vencen, setVencen] = useState<VencimientoRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get<Stats>("/api/dashboard").then(setStats).catch(() => {});
    api
      .get<{ data: ReordenRow[] }>("/api/productos/_alertas/reorden")
      .then((r) => setReorden(r.data))
      .catch(() => {});
    api
      .get<{ data: VencimientoRow[] }>("/api/productos/_alertas/vencimiento?dias=90")
      .then((r) => setVencen(r.data))
      .catch(() => {});
  }, []);

  const Stat = ({ label, value, accent }: { label: string; value: string | number; accent?: string }) => (
    <div className="card">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold ${accent ?? ""}`}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <h1 className="text-xl md:text-2xl font-semibold">Panel</h1>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 md:gap-4">
          <Stat label="Productos activos" value={stats.productos} />
          <Stat label="Pacientes" value={stats.pacientes} />
          <Stat label="Episodios activos" value={stats.episodios_activos} accent="text-blue-600" />
          <Stat label="Cirugias futuras" value={stats.cirugias_futuras} accent="text-amber-600" />
          <Stat label="Facturas pendientes" value={stats.facturas_pendientes} />
          <Stat label="Monto pendiente" value={`$${Number(stats.monto_pendiente).toFixed(2)}`} accent="text-red-600" />
          <Stat label="Ingresos hoy" value={`$${Number(stats.ingresos_hoy).toFixed(2)}`} accent="text-green-600" />
          <Stat label="Por facturar" value={stats.episodios_por_facturar} accent={stats.episodios_por_facturar ? "text-amber-600" : ""} />
          <Stat label="Reorden" value={reorden.length} accent={reorden.length ? "text-red-600" : ""} />
          <Stat label="Cargos pacientes activos *" value={`$${Number(stats.cargos_activos).toFixed(2)}`} accent="text-indigo-600" />
        </div>
      )}

      <p className="text-xs text-slate-400">* Cargos pacientes activos: suma de precio de venta × cantidad de todos los consumos de episodios activos (dato conservador, incluye lo facturado y lo pendiente).</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <section className="card">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Productos bajo reorden ({reorden.length})</h2>
            <Link to="/compras" className="text-sm text-blue-600 hover:underline">Crear OC</Link>
          </div>
          {!reorden.length ? (
            <div className="text-sm text-slate-500">Sin alertas</div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Codigo</th><th>Nombre</th><th>Existencia</th><th>Reorden</th></tr>
              </thead>
              <tbody>
                {reorden.map((p) => (
                  <tr key={p.id}>
                    <td>{p.codigo}</td>
                    <td>{p.nombre}</td>
                    <td>{p.existencia_total}</td>
                    <td>{p.punto_reorden}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <h2 className="font-semibold mb-2">Proximos a vencer (90 dias)</h2>
          {!vencen.length ? (
            <div className="text-sm text-slate-500">Sin alertas</div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Producto</th><th>Lote</th><th>Vence</th><th>Cant</th></tr>
              </thead>
              <tbody>
                {vencen.map((v) => (
                  <tr key={v.lote_id}>
                    <td>{v.nombre}</td>
                    <td>{v.numero_lote}</td>
                    <td>{v.fecha_vencimiento}</td>
                    <td>{v.cantidad}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
