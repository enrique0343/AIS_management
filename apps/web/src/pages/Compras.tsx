import { useEffect, useState } from "react";
import { api } from "../lib/api";

type OC = { id: number; numero: string; fecha: string; estado: string; proveedor: string; total: number };
type Prov = { id: number; nombre: string };
type Prod = { id: number; codigo: string; nombre: string; es_controlado: number };
type Area = { id: number; nombre: string };

export default function Compras() {
  const [ordenes, setOrdenes] = useState<OC[]>([]);
  const [provs, setProvs] = useState<Prov[]>([]);
  const [prods, setProds] = useState<Prod[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [showRec, setShowRec] = useState<OC | null>(null);
  const [newOC, setNewOC] = useState<any>({ proveedor_id: "", detalles: [{ producto_id: "", cantidad: 1, costo_unitario: 0 }] });
  const [rec, setRec] = useState<any>({ area_destino_id: "", n_factura_proveedor: "", detalles: [] });

  const load = () => api.get<{ data: OC[] }>("/api/compras/ordenes").then((r) => setOrdenes(r.data));

  useEffect(() => {
    load();
    api.get<{ data: Prov[] }>("/api/catalogos/proveedores").then((r) => setProvs(r.data));
    api.get<{ data: Prod[] }>("/api/productos").then((r) => setProds(r.data));
    api.get<{ data: Area[] }>("/api/catalogos/areas").then((r) => setAreas(r.data));
  }, []);

  const submitNew = async () => {
    await api.post("/api/compras/ordenes", {
      proveedor_id: Number(newOC.proveedor_id),
      detalles: newOC.detalles.map((d: any) => ({
        producto_id: Number(d.producto_id),
        cantidad: Number(d.cantidad),
        costo_unitario: Number(d.costo_unitario),
      })),
    });
    setShowNew(false);
    setNewOC({ proveedor_id: "", detalles: [{ producto_id: "", cantidad: 1, costo_unitario: 0 }] });
    load();
  };

  const openRec = async (oc: OC) => {
    const r = await api.get<{ orden: any; detalles: any[] }>(`/api/compras/ordenes/${oc.id}`);
    setRec({
      area_destino_id: "",
      n_factura_proveedor: "",
      detalles: r.detalles.map((d: any) => ({
        producto_id: d.producto_id,
        producto_nombre: d.producto,
        cantidad: d.cantidad,
        costo_unitario: d.costo_unitario,
        lote_numero: "",
        fecha_vencimiento: "",
        n_autorizacion_srs: "",
      })),
    });
    setShowRec(oc);
  };

  const submitRec = async () => {
    if (!showRec) return;
    await api.post("/api/compras/recepciones", {
      orden_compra_id: showRec.id,
      fecha: new Date().toISOString().slice(0, 10),
      n_factura_proveedor: rec.n_factura_proveedor || null,
      area_destino_id: Number(rec.area_destino_id),
      detalles: rec.detalles,
    });
    setShowRec(null);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Compras</h1>
        <button className="btn" onClick={() => setShowNew(true)}>Nueva OC</button>
      </div>
      <div className="card overflow-auto">
        <table className="table">
          <thead>
            <tr><th>Numero</th><th>Fecha</th><th>Proveedor</th><th>Estado</th><th>Total</th><th></th></tr>
          </thead>
          <tbody>
            {ordenes.map((o) => (
              <tr key={o.id}>
                <td>{o.numero}</td>
                <td>{o.fecha}</td>
                <td>{o.proveedor}</td>
                <td>{o.estado}</td>
                <td>{Number(o.total).toFixed(2)}</td>
                <td>
                  {(o.estado === "borrador" || o.estado === "enviada" || o.estado === "recibida_parcial") && (
                    <button className="btn-secondary text-xs" onClick={() => openRec(o)}>Recibir</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-2xl space-y-3">
            <h2 className="font-semibold">Nueva orden de compra</h2>
            <select className="input" value={newOC.proveedor_id} onChange={(e) => setNewOC({ ...newOC, proveedor_id: e.target.value })}>
              <option value="">-- Proveedor --</option>
              {provs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            {newOC.detalles.map((d: any, idx: number) => (
              <div key={idx} className="grid grid-cols-12 gap-2">
                <select className="input col-span-6" value={d.producto_id} onChange={(e) => {
                  const ds = [...newOC.detalles]; ds[idx].producto_id = e.target.value; setNewOC({ ...newOC, detalles: ds });
                }}>
                  <option value="">-- Producto --</option>
                  {prods.map((p) => <option key={p.id} value={p.id}>{p.codigo} - {p.nombre}</option>)}
                </select>
                <input className="input col-span-2" type="number" placeholder="Cant" value={d.cantidad} onChange={(e) => {
                  const ds = [...newOC.detalles]; ds[idx].cantidad = e.target.value; setNewOC({ ...newOC, detalles: ds });
                }} />
                <input className="input col-span-3" type="number" step="0.01" placeholder="Costo" value={d.costo_unitario} onChange={(e) => {
                  const ds = [...newOC.detalles]; ds[idx].costo_unitario = e.target.value; setNewOC({ ...newOC, detalles: ds });
                }} />
                <button className="btn-secondary col-span-1" onClick={() => {
                  setNewOC({ ...newOC, detalles: newOC.detalles.filter((_: any, i: number) => i !== idx) });
                }}>x</button>
              </div>
            ))}
            <button className="btn-secondary" onClick={() => setNewOC({ ...newOC, detalles: [...newOC.detalles, { producto_id: "", cantidad: 1, costo_unitario: 0 }] })}>+ Linea</button>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn" onClick={submitNew}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {showRec && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="card w-full max-w-3xl space-y-3">
            <h2 className="font-semibold">Recepcion - {showRec.numero}</h2>
            <div className="grid grid-cols-2 gap-2">
              <select className="input" value={rec.area_destino_id} onChange={(e) => setRec({ ...rec, area_destino_id: e.target.value })}>
                <option value="">-- Area destino --</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
              <input className="input" placeholder="No. factura proveedor" value={rec.n_factura_proveedor} onChange={(e) => setRec({ ...rec, n_factura_proveedor: e.target.value })} />
            </div>
            <table className="table">
              <thead><tr><th>Producto</th><th>Cant</th><th>Costo</th><th>Lote</th><th>Vence</th><th>Aut. SRS</th></tr></thead>
              <tbody>
                {rec.detalles.map((d: any, idx: number) => (
                  <tr key={idx}>
                    <td>{d.producto_nombre}</td>
                    <td>{d.cantidad}</td>
                    <td>{Number(d.costo_unitario).toFixed(2)}</td>
                    <td><input className="input" value={d.lote_numero} onChange={(e) => {
                      const ds = [...rec.detalles]; ds[idx].lote_numero = e.target.value; setRec({ ...rec, detalles: ds });
                    }} /></td>
                    <td><input className="input" type="date" value={d.fecha_vencimiento} onChange={(e) => {
                      const ds = [...rec.detalles]; ds[idx].fecha_vencimiento = e.target.value; setRec({ ...rec, detalles: ds });
                    }} /></td>
                    <td><input className="input" value={d.n_autorizacion_srs} onChange={(e) => {
                      const ds = [...rec.detalles]; ds[idx].n_autorizacion_srs = e.target.value; setRec({ ...rec, detalles: ds });
                    }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500">Lote/vence requeridos para productos con categoria lote. No. autorizacion SRS requerido para controlados (§7.2).</p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowRec(null)}>Cancelar</button>
              <button className="btn" onClick={submitRec}>Confirmar recepcion</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
