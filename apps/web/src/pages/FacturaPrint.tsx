import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";

type Detalle = { id: number; descripcion: string; cantidad: number; precio_unitario: number; subtotal: number };
type Pago = { id: number; metodo: string; monto: number; fecha: string; referencia: string | null };
type Factura = {
  id: number;
  numero: string;
  fecha: string;
  paciente_id: number;
  subtotal: number;
  iva: number;
  total: number;
  estado: string;
};
type Paciente = { id: number; expediente: string; nombres: string; apellidos: string; documento_tipo: string | null; documento_numero: string | null };

export default function FacturaPrint() {
  const { id } = useParams();
  const [data, setData] = useState<{ factura: Factura; detalles: Detalle[]; pagos: Pago[] } | null>(null);
  const [paciente, setPaciente] = useState<Paciente | null>(null);

  useEffect(() => {
    (async () => {
      const r = await api.get<{ factura: Factura; detalles: Detalle[]; pagos: Pago[] }>(`/api/facturacion/facturas/${id}`);
      setData(r);
      const p = await api.get<{ paciente: Paciente }>(`/api/pacientes/${r.factura.paciente_id}`);
      setPaciente(p.paciente);
    })();
  }, [id]);

  if (!data) return <div className="p-8">Cargando...</div>;

  const totalPagado = data.pagos.reduce((s, p) => s + Number(p.monto), 0);
  const saldo = Number(data.factura.total) - totalPagado;

  return (
    <div className="min-h-screen bg-white p-8 print:p-0 max-w-3xl mx-auto text-sm">
      <style>{`@media print { @page { size: A4; margin: 1.5cm; } .no-print { display: none !important; } }`}</style>

      <div className="flex justify-end gap-2 mb-4 no-print">
        <button className="btn-secondary" onClick={() => window.history.back()}>Volver</button>
        <button className="btn" onClick={() => window.print()}>Imprimir / PDF</button>
      </div>

      <header className="border-b-2 border-slate-900 pb-3 mb-4 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">AIS Management</h1>
          <div className="text-xs text-slate-500">Sistema de Gestion Interna</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold">FACTURA</div>
          <div className="font-mono">{data.factura.numero}</div>
          <div className="text-xs text-slate-500">Estado: {data.factura.estado.toUpperCase()}</div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          <div className="text-xs uppercase text-slate-500">Paciente</div>
          {paciente ? (
            <>
              <div className="font-semibold">{paciente.nombres} {paciente.apellidos}</div>
              <div className="text-xs">Expediente: {paciente.expediente}</div>
              {paciente.documento_numero && (
                <div className="text-xs">{paciente.documento_tipo}: {paciente.documento_numero}</div>
              )}
            </>
          ) : "..."}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase text-slate-500">Fecha</div>
          <div>{data.factura.fecha}</div>
        </div>
      </section>

      <table className="w-full border-collapse mb-4">
        <thead>
          <tr className="bg-slate-100">
            <th className="text-left p-2 border-b">Descripcion</th>
            <th className="text-right p-2 border-b w-20">Cant</th>
            <th className="text-right p-2 border-b w-28">Precio</th>
            <th className="text-right p-2 border-b w-28">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {data.detalles.map((d) => (
            <tr key={d.id} className="border-b">
              <td className="p-2">{d.descripcion}</td>
              <td className="p-2 text-right">{d.cantidad}</td>
              <td className="p-2 text-right">{Number(d.precio_unitario).toFixed(2)}</td>
              <td className="p-2 text-right">{Number(d.subtotal).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={3} className="text-right p-2">Subtotal</td><td className="text-right p-2">{Number(data.factura.subtotal).toFixed(2)}</td></tr>
          <tr><td colSpan={3} className="text-right p-2">IVA</td><td className="text-right p-2">{Number(data.factura.iva).toFixed(2)}</td></tr>
          <tr className="font-bold border-t-2 border-slate-900">
            <td colSpan={3} className="text-right p-2">TOTAL</td>
            <td className="text-right p-2">{Number(data.factura.total).toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      {!!data.pagos.length && (
        <section className="mb-4">
          <h3 className="font-semibold mb-2">Pagos</h3>
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-100"><th className="p-1 text-left">Fecha</th><th className="p-1 text-left">Metodo</th><th className="p-1 text-right">Monto</th><th className="p-1">Ref</th></tr></thead>
            <tbody>
              {data.pagos.map((p) => (
                <tr key={p.id}><td className="p-1">{p.fecha}</td><td className="p-1">{p.metodo}</td><td className="p-1 text-right">{Number(p.monto).toFixed(2)}</td><td className="p-1">{p.referencia ?? "-"}</td></tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold"><td colSpan={2} className="text-right p-1">Pagado</td><td className="text-right p-1">{totalPagado.toFixed(2)}</td><td></td></tr>
              <tr className="font-semibold"><td colSpan={2} className="text-right p-1">Saldo</td><td className="text-right p-1">{saldo.toFixed(2)}</td><td></td></tr>
            </tfoot>
          </table>
        </section>
      )}

      <footer className="mt-8 pt-3 border-t text-xs text-slate-500 text-center">
        Documento de cobro interno. No es factura electronica fiscal.
      </footer>
    </div>
  );
}
