import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";

type Detalle = {
  id: number; descripcion: string; cantidad: number;
  precio_unitario: number; subtotal: number;
  categoria: string; consumo_id: number | null;
};
type Pago = { id: number; metodo: string; monto: number; fecha: string; referencia: string | null };
type Factura = {
  id: number; numero: string; fecha: string; subtotal: number; iva: number; total: number; estado: string;
  nombres: string; apellidos: string; expediente: string;
  documento_tipo: string | null; documento_numero: string | null;
  fecha_inicio: string | null; fecha_fin: string | null; medico_nombre: string | null;
};

type CatRow = { categoria: string; items: number; subtotal: number };

export default function FacturaPrintResumen() {
  const { id } = useParams();
  const [factura, setFactura] = useState<Factura | null>(null);
  const [detalles, setDetalles] = useState<Detalle[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);

  useEffect(() => {
    api.get<{ factura: Factura; detalles: Detalle[]; pagos: Pago[] }>(
      `/api/facturacion/facturas/${id}/para-print`
    ).then((r) => {
      setFactura(r.factura);
      setDetalles(r.detalles);
      setPagos(r.pagos);
    }).catch(() => {});
  }, [id]);

  if (!factura) return <div className="p-8 text-center text-slate-500">Cargando...</div>;

  // Group positive items by category
  const positivos = detalles.filter((d) => Number(d.subtotal) >= 0);
  const descuentos = detalles.filter((d) => Number(d.subtotal) < 0);

  const catMap = new Map<string, CatRow>();
  for (const d of positivos) {
    const prev = catMap.get(d.categoria) ?? { categoria: d.categoria, items: 0, subtotal: 0 };
    catMap.set(d.categoria, { ...prev, items: prev.items + 1, subtotal: +(prev.subtotal + Number(d.subtotal)).toFixed(2) });
  }

  // Order: category items first (sorted), then Habitacion, then Cargos adicionales
  const catNormal = [...catMap.values()].filter(
    (r) => r.categoria !== "Habitacion" && r.categoria !== "Cargos adicionales"
  ).sort((a, b) => a.categoria.localeCompare(b.categoria));
  const catHab = catMap.get("Habitacion");
  const catExtra = catMap.get("Cargos adicionales");

  const subtotalBruto = positivos.reduce((s, d) => s + Number(d.subtotal), 0);
  const totalDescuentos = descuentos.reduce((s, d) => s + Number(d.subtotal), 0);
  const totalPagado = pagos.reduce((s, p) => s + Number(p.monto), 0);
  const saldo = Number(factura.total) - totalPagado;

  return (
    <div className="min-h-screen bg-white p-8 print:p-0 max-w-[800px] mx-auto text-sm font-sans">
      <style>{`
        @media print { @page { size: A4; margin: 1.5cm; } .no-print { display: none !important; } }
        body { font-family: Arial, sans-serif; }
      `}</style>

      <div className="flex justify-end gap-2 mb-6 no-print">
        <button onClick={() => window.history.back()}
          className="px-3 py-1.5 border rounded text-sm hover:bg-slate-50">Volver</button>
        <button onClick={() => window.print()}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
          Imprimir / PDF
        </button>
      </div>

      {/* Header */}
      <header className="border-b-2 border-slate-900 pb-3 mb-5 flex justify-between items-start">
        <div>
          <div className="text-xl font-bold">AIS Management</div>
          <div className="text-xs text-slate-500 tracking-wide mt-0.5">RESUMEN DE CUENTA POR CATEGORIA</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-base font-semibold">{factura.numero}</div>
          <div className="text-xs text-slate-500">{factura.fecha?.slice(0, 16)}</div>
          <div className={`text-xs font-semibold mt-0.5 ${
            factura.estado === "pagada" ? "text-green-700" :
            factura.estado === "anulada" ? "text-red-600" : "text-amber-700"
          }`}>{factura.estado.toUpperCase()}</div>
        </div>
      </header>

      {/* Patient info */}
      <section className="grid grid-cols-2 gap-6 mb-5 pb-4 border-b text-xs">
        <div>
          <div className="text-slate-400 uppercase text-[10px] tracking-wide mb-1">Paciente</div>
          <div className="font-semibold text-sm">{factura.nombres} {factura.apellidos}</div>
          <div className="text-slate-600">Expediente: {factura.expediente}</div>
          {factura.documento_numero && (
            <div className="text-slate-600">{factura.documento_tipo}: {factura.documento_numero}</div>
          )}
          {factura.medico_nombre && (
            <div className="text-slate-600 mt-1">Medico: Dr/a. {factura.medico_nombre}</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-slate-400 uppercase text-[10px] tracking-wide mb-1">Hospitalizacion</div>
          {factura.fecha_inicio && (
            <div className="text-slate-600">Ingreso: {factura.fecha_inicio.slice(0, 10)}</div>
          )}
          {factura.fecha_fin && (
            <div className="text-slate-600">Egreso: {factura.fecha_fin.slice(0, 10)}</div>
          )}
        </div>
      </section>

      {/* Summary table */}
      <table className="w-full border-collapse text-xs mb-5">
        <thead>
          <tr className="bg-slate-100">
            <th className="text-left p-2 border-b border-slate-300">Categoria</th>
            <th className="text-right p-2 border-b border-slate-300 w-16">Items</th>
            <th className="text-right p-2 border-b border-slate-300 w-28">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {catNormal.map((row) => (
            <tr key={row.categoria} className="border-b border-slate-100">
              <td className="p-2">{row.categoria}</td>
              <td className="p-2 text-right text-slate-500">{row.items}</td>
              <td className="p-2 text-right">{row.subtotal.toFixed(2)}</td>
            </tr>
          ))}
          {(catNormal.length > 0 && (catHab || catExtra)) && (
            <tr><td colSpan={3} className="border-t border-slate-300 py-0"></td></tr>
          )}
          {catHab && (
            <tr className="border-b border-slate-100 bg-slate-50">
              <td className="p-2 font-medium">Habitacion</td>
              <td className="p-2 text-right text-slate-500">{catHab.items}</td>
              <td className="p-2 text-right">{catHab.subtotal.toFixed(2)}</td>
            </tr>
          )}
          {catExtra && (
            <tr className="border-b border-slate-100 bg-slate-50">
              <td className="p-2 font-medium">Cargos adicionales</td>
              <td className="p-2 text-right text-slate-500">{catExtra.items}</td>
              <td className="p-2 text-right">{catExtra.subtotal.toFixed(2)}</td>
            </tr>
          )}
        </tbody>
        <tfoot className="border-t-2 border-slate-300">
          {descuentos.length > 0 && (
            <>
              <tr>
                <td colSpan={2} className="text-right p-2 text-slate-500">Subtotal bruto</td>
                <td className="text-right p-2 text-slate-500">{subtotalBruto.toFixed(2)}</td>
              </tr>
              {descuentos.map((d) => (
                <tr key={d.id} className="text-amber-700 italic">
                  <td colSpan={2} className="text-right p-1.5 px-2">{d.descripcion}</td>
                  <td className="text-right p-1.5 px-2">{Number(d.subtotal).toFixed(2)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} className="text-right p-1.5 text-amber-700">Total descuentos</td>
                <td className="text-right p-1.5 text-amber-700">{totalDescuentos.toFixed(2)}</td>
              </tr>
            </>
          )}
          <tr>
            <td colSpan={2} className="text-right p-2">Base s/IVA</td>
            <td className="text-right p-2">{Number(factura.subtotal).toFixed(2)}</td>
          </tr>
          <tr>
            <td colSpan={2} className="text-right p-2">IVA incluido</td>
            <td className="text-right p-2">{Number(factura.iva).toFixed(2)}</td>
          </tr>
          <tr className="font-bold text-base border-t-2 border-slate-900">
            <td colSpan={2} className="text-right p-2">TOTAL</td>
            <td className="text-right p-2">${Number(factura.total).toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      {/* Payments */}
      {pagos.length > 0 && (
        <section className="mb-5 text-xs">
          <h3 className="font-semibold mb-1 text-sm">Pagos registrados</h3>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="text-left p-1.5 border-b">Fecha</th>
                <th className="text-left p-1.5 border-b">Metodo</th>
                <th className="text-right p-1.5 border-b">Monto</th>
                <th className="p-1.5 border-b">Referencia</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="p-1.5">{p.fecha?.slice(0, 16)}</td>
                  <td className="p-1.5 capitalize">{p.metodo}</td>
                  <td className="p-1.5 text-right">{Number(p.monto).toFixed(2)}</td>
                  <td className="p-1.5 text-center">{p.referencia ?? "-"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={2} className="text-right p-1.5">Total pagado</td>
                <td className="text-right p-1.5">{totalPagado.toFixed(2)}</td>
                <td></td>
              </tr>
              <tr className="font-semibold">
                <td colSpan={2} className="text-right p-1.5">Saldo pendiente</td>
                <td className="text-right p-1.5">{saldo.toFixed(2)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {/* Signatures */}
      <section className="mt-12 grid grid-cols-3 gap-6 text-xs text-center">
        {["Paciente / Responsable", "Administracion", "Medico Tratante"].map((s) => (
          <div key={s}>
            <div className="border-t border-slate-400 pt-2 mt-10 text-slate-600">{s}</div>
          </div>
        ))}
      </section>

      <footer className="mt-6 pt-3 border-t text-[10px] text-slate-400 text-center">
        Documento de cobro interno — No es factura electronica fiscal
      </footer>
    </div>
  );
}
