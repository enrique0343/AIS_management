import { useEffect, useState, ReactNode } from "react";
import { api } from "../lib/api";

type Tab = "proveedores" | "laboratorios" | "areas" | "habitaciones" | "categorias" | "unidades" | "aseguradoras";

export default function Catalogos() {
  const [tab, setTab] = useState<Tab>("proveedores");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Catalogos</h1>
      <div className="flex gap-2 border-b flex-wrap">
        {(["proveedores", "aseguradoras", "laboratorios", "areas", "habitaciones", "categorias", "unidades"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 ${
              tab === t ? "border-blue-600 text-blue-600 font-medium" : "border-transparent text-slate-600"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "proveedores" && <Proveedores />}
      {tab === "aseguradoras" && <Aseguradoras />}
      {tab === "laboratorios" && <Laboratorios />}
      {tab === "areas" && <Areas />}
      {tab === "habitaciones" && <Habitaciones />}
      {tab === "categorias" && <Categorias />}
      {tab === "unidades" && <Unidades />}
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <div className="card">{children}</div>;
}

const EMPTY_PROV = { nombre: "", nit: "", contacto: "", telefono: "", email: "", condiciones_pago: "" };

function Proveedores() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>(EMPTY_PROV);
  const [editItem, setEditItem] = useState<any | null>(null);
  const load = () => api.get<{ data: any[] }>("/api/catalogos/proveedores").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.nombre) { alert("Nombre requerido"); return; }
    await api.post("/api/catalogos/proveedores", form);
    setForm(EMPTY_PROV);
    load();
  };

  const guardarEditar = async () => {
    if (!editItem?.nombre) { alert("Nombre requerido"); return; }
    await api.put(`/api/catalogos/proveedores/${editItem.id}`, editItem);
    setEditItem(null);
    load();
  };

  return (
    <Section>
      <h3 className="font-semibold mb-2">Nuevo proveedor</h3>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-slate-700">Nombre *</label>
          <input className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">NIT</label>
          <input className="input" value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Contacto</label>
          <input className="input" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Telefono</label>
          <input className="input" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Email</label>
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
      </div>
      <div className="flex justify-end mb-3">
        <button className="btn" onClick={submit}>+ Agregar proveedor</button>
      </div>
      <table className="table">
        <thead><tr><th>Nombre</th><th>NIT</th><th>Contacto</th><th>Telefono</th><th>Email</th><th></th></tr></thead>
        <tbody>{items.map((p) => (
          <tr key={p.id}>
            <td>{p.nombre}</td><td>{p.nit ?? "-"}</td><td>{p.contacto ?? "-"}</td>
            <td>{p.telefono ?? "-"}</td><td>{p.email ?? "-"}</td>
            <td><button className="btn-secondary text-xs" onClick={() => setEditItem({ ...p })}>Editar</button></td>
          </tr>
        ))}</tbody>
      </table>

      {editItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg space-y-3">
            <h2 className="font-semibold">Editar proveedor</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-slate-500">Nombre *</label>
                <input className="input" value={editItem.nombre} onChange={(e) => setEditItem({ ...editItem, nombre: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500">NIT</label>
                <input className="input" value={editItem.nit ?? ""} onChange={(e) => setEditItem({ ...editItem, nit: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Contacto</label>
                <input className="input" value={editItem.contacto ?? ""} onChange={(e) => setEditItem({ ...editItem, contacto: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Telefono</label>
                <input className="input" value={editItem.telefono ?? ""} onChange={(e) => setEditItem({ ...editItem, telefono: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Email</label>
                <input className="input" type="email" value={editItem.email ?? ""} onChange={(e) => setEditItem({ ...editItem, email: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-500">Condiciones de pago</label>
                <input className="input" value={editItem.condiciones_pago ?? ""} onChange={(e) => setEditItem({ ...editItem, condiciones_pago: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditItem(null)}>Cancelar</button>
              <button className="btn" onClick={guardarEditar}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

const EMPTY_ASEG = { nombre: "", nit: "", contacto: "", telefono: "", email: "" };

function Aseguradoras() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>(EMPTY_ASEG);
  const [editItem, setEditItem] = useState<any | null>(null);
  const load = () => api.get<{ data: any[] }>("/api/catalogos/aseguradoras").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.nombre) { alert("Nombre requerido"); return; }
    await api.post("/api/catalogos/aseguradoras", form);
    setForm(EMPTY_ASEG);
    load();
  };
  const guardarEditar = async () => {
    if (!editItem?.nombre) { alert("Nombre requerido"); return; }
    await api.put(`/api/catalogos/aseguradoras/${editItem.id}`, editItem);
    setEditItem(null);
    load();
  };
  const toggleActivo = async (a: any) => {
    await api.post(`/api/catalogos/aseguradoras/${a.id}/${a.activo ? "desactivar" : "activar"}`, {});
    load();
  };

  return (
    <Section>
      <h3 className="font-semibold mb-2">Nueva aseguradora</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-slate-700">Nombre *</label>
          <input className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">NIT</label>
          <input className="input" value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Telefono</label>
          <input className="input" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Email</label>
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
      </div>
      <div className="flex justify-end mb-3">
        <button className="btn" onClick={submit}>+ Agregar aseguradora</button>
      </div>
      <table className="table">
        <thead><tr><th>Nombre</th><th>NIT</th><th>Telefono</th><th>Email</th><th>Estado</th><th></th></tr></thead>
        <tbody>{items.map((a) => (
          <tr key={a.id} className={!a.activo ? "opacity-50" : ""}>
            <td>{a.nombre}</td><td>{a.nit ?? "-"}</td><td>{a.telefono ?? "-"}</td><td>{a.email ?? "-"}</td>
            <td><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.activo ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{a.activo ? "Activa" : "Inactiva"}</span></td>
            <td className="flex gap-1">
              <button className="btn-secondary text-xs" onClick={() => setEditItem({ ...a })}>Editar</button>
              <button className={`text-xs px-2 py-1 rounded ${a.activo ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-green-100 text-green-700 hover:bg-green-200"}`} onClick={() => toggleActivo(a)}>{a.activo ? "Desactivar" : "Activar"}</button>
            </td>
          </tr>
        ))}</tbody>
      </table>
      {editItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg space-y-3">
            <h2 className="font-semibold">Editar aseguradora</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="text-xs text-slate-500">Nombre *</label><input className="input" value={editItem.nombre} onChange={(e) => setEditItem({ ...editItem, nombre: e.target.value })} /></div>
              <div><label className="text-xs text-slate-500">NIT</label><input className="input" value={editItem.nit ?? ""} onChange={(e) => setEditItem({ ...editItem, nit: e.target.value })} /></div>
              <div><label className="text-xs text-slate-500">Contacto</label><input className="input" value={editItem.contacto ?? ""} onChange={(e) => setEditItem({ ...editItem, contacto: e.target.value })} /></div>
              <div><label className="text-xs text-slate-500">Telefono</label><input className="input" value={editItem.telefono ?? ""} onChange={(e) => setEditItem({ ...editItem, telefono: e.target.value })} /></div>
              <div><label className="text-xs text-slate-500">Email</label><input className="input" type="email" value={editItem.email ?? ""} onChange={(e) => setEditItem({ ...editItem, email: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditItem(null)}>Cancelar</button>
              <button className="btn" onClick={guardarEditar}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function Laboratorios() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ nombre: "", pais: "" });
  const load = () => api.get<{ data: any[] }>("/api/catalogos/laboratorios").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);
  const submit = async () => {
    if (!form.nombre) { alert("Nombre requerido"); return; }
    await api.post("/api/catalogos/laboratorios", form);
    setForm({ nombre: "", pais: "" });
    load();
  };
  return (
    <Section>
      <h3 className="font-semibold mb-2">Nuevo laboratorio / fabricante</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
        <div className="md:col-span-3">
          <label className="text-xs font-medium text-slate-700">Nombre *</label>
          <input className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-slate-700">Pais</label>
          <input className="input" value={form.pais} onChange={(e) => setForm({ ...form, pais: e.target.value })} />
        </div>
      </div>
      <div className="flex justify-end mb-3">
        <button className="btn" onClick={submit}>+ Agregar laboratorio</button>
      </div>
      <table className="table">
        <thead><tr><th>Nombre</th><th>Pais</th></tr></thead>
        <tbody>{items.map((l) => <tr key={l.id}><td>{l.nombre}</td><td>{l.pais ?? "-"}</td></tr>)}</tbody>
      </table>
    </Section>
  );
}

function Areas() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ nombre: "", tipo: "servicio", bajo_llave: false });
  const [editItem, setEditItem] = useState<any | null>(null);
  const tipos = ["farmacia_central", "farmacia_periferica", "quirofano", "servicio", "consulta_externa", "emergencia", "almacen"];
  const load = () => api.get<{ data: any[] }>("/api/catalogos/areas").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);
  const submit = async () => {
    if (!form.nombre) { alert("Nombre requerido"); return; }
    await api.post("/api/catalogos/areas", form);
    setForm({ nombre: "", tipo: "servicio", bajo_llave: false });
    load();
  };
  const guardarEditar = async () => {
    if (!editItem?.nombre) { alert("Nombre requerido"); return; }
    await api.put(`/api/catalogos/areas/${editItem.id}`, editItem);
    setEditItem(null);
    load();
  };
  const toggleActivo = async (a: any) => {
    const action = a.activo ? "desactivar" : "activar";
    await api.post(`/api/catalogos/areas/${a.id}/${action}`, {});
    load();
  };
  return (
    <Section>
      <h3 className="font-semibold mb-2">Nueva area</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-slate-700">Nombre *</label>
          <input className="input" placeholder="ej. Farmacia Pediatria" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-slate-700">Tipo</label>
          <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
            {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm h-10">
            <input type="checkbox" checked={form.bajo_llave} onChange={(e) => setForm({ ...form, bajo_llave: e.target.checked })} /> Bajo llave
          </label>
        </div>
      </div>
      <div className="flex justify-end mb-3">
        <button className="btn" onClick={submit}>+ Agregar area</button>
      </div>
      <table className="table">
        <thead><tr><th>Nombre</th><th>Tipo</th><th>Bajo llave</th><th>Estado</th><th></th></tr></thead>
        <tbody>{items.map((a) => (
          <tr key={a.id} className={!a.activo ? "opacity-50" : ""}>
            <td>{a.nombre}</td><td>{a.tipo}</td><td>{a.bajo_llave ? "Si" : ""}</td>
            <td><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.activo ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{a.activo ? "Activa" : "Inactiva"}</span></td>
            <td className="flex gap-1">
              <button className="btn-secondary text-xs" onClick={() => setEditItem({ ...a })}>Editar</button>
              <button className={`text-xs px-2 py-1 rounded ${a.activo ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-green-100 text-green-700 hover:bg-green-200"}`} onClick={() => toggleActivo(a)}>{a.activo ? "Desactivar" : "Activar"}</button>
            </td>
          </tr>
        ))}</tbody>
      </table>

      {editItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md space-y-3">
            <h2 className="font-semibold">Editar area</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500">Nombre *</label>
                <input className="input" value={editItem.nombre} onChange={(e) => setEditItem({ ...editItem, nombre: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Tipo</label>
                <select className="input" value={editItem.tipo} onChange={(e) => setEditItem({ ...editItem, tipo: e.target.value })}>
                  {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!editItem.bajo_llave} onChange={(e) => setEditItem({ ...editItem, bajo_llave: e.target.checked })} /> Bajo llave
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditItem(null)}>Cancelar</button>
              <button className="btn" onClick={guardarEditar}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function Habitaciones() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ numero: "", tipo: "individual", precio_diario: 0, capacidad: 1, ubicacion: "" });
  const load = () => api.get<{ data: any[] }>("/api/habitaciones").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);
  const submit = async () => {
    if (!form.numero) { alert("Numero de habitacion requerido"); return; }
    await api.post("/api/habitaciones", form);
    setForm({ numero: "", tipo: "individual", precio_diario: 0, capacidad: 1, ubicacion: "" });
    load();
  };
  return (
    <Section>
      <h3 className="font-semibold mb-2">Nueva habitacion</h3>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
        <div>
          <label className="text-xs font-medium text-slate-700">Numero / nombre *</label>
          <input className="input" placeholder="ej. 201" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Tipo</label>
          <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
            <option value="individual">individual</option>
            <option value="doble">doble</option>
            <option value="suite">suite</option>
            <option value="uci">uci</option>
            <option value="observacion">observacion</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Precio por dia ($)</label>
          <input className="input" type="number" step="0.01" min="0" value={form.precio_diario} onChange={(e) => setForm({ ...form, precio_diario: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Capacidad (camas)</label>
          <input className="input" type="number" min="1" value={form.capacidad} onChange={(e) => setForm({ ...form, capacidad: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-slate-700">Ubicacion (opcional)</label>
          <input className="input" placeholder="ej. Piso 2, ala norte" value={form.ubicacion} onChange={(e) => setForm({ ...form, ubicacion: e.target.value })} />
        </div>
      </div>
      <div className="flex justify-end mb-3">
        <button className="btn" onClick={submit}>+ Agregar habitacion</button>
      </div>
      <table className="table">
        <thead><tr><th>Numero</th><th>Tipo</th><th>Precio/dia</th><th>Cap.</th><th>Ocupantes</th><th>Pacientes</th><th>Activa</th></tr></thead>
        <tbody>{items.map((h) => (
          <tr key={h.id} className={h.ocupantes_actuales >= h.capacidad ? "bg-red-50" : h.ocupantes_actuales > 0 ? "bg-amber-50" : ""}>
            <td>{h.numero}</td><td>{h.tipo}</td>
            <td>${Number(h.precio_diario).toFixed(2)}</td>
            <td>{h.capacidad}</td>
            <td>{h.ocupantes_actuales}/{h.capacidad}</td>
            <td className="text-xs">{h.pacientes_actuales ?? "-"}</td>
            <td>{h.activa ? "Si" : "No"}</td>
          </tr>
        ))}</tbody>
      </table>
    </Section>
  );
}

function Categorias() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ nombre: "", prefijo: "", requiere_lote_vencimiento: false, es_servicio: false });
  const load = () => api.get<{ data: any[] }>("/api/catalogos/categorias").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);
  const submit = async () => {
    if (!form.nombre || !form.prefijo) { alert("Nombre y prefijo requeridos"); return; }
    try {
      await api.post("/api/catalogos/categorias", form);
      setForm({ nombre: "", prefijo: "", requiere_lote_vencimiento: false, es_servicio: false });
      load();
    } catch (e: any) { alert(e.message); }
  };
  return (
    <Section>
      <h3 className="font-semibold mb-2">Nueva categoria de producto</h3>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-slate-700">Nombre *</label>
          <input className="input" placeholder="ej. Material curacion" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Prefijo *</label>
          <input className="input font-mono" placeholder="MED" maxLength={5} value={form.prefijo} onChange={(e) => setForm({ ...form, prefijo: e.target.value.toUpperCase() })} />
          <p className="text-xs text-slate-500">Codigos: PREFIJO-0001</p>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm h-10">
            <input type="checkbox" checked={form.requiere_lote_vencimiento} onChange={(e) => setForm({ ...form, requiere_lote_vencimiento: e.target.checked })} /> Requiere lote/vence
          </label>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm h-10">
            <input type="checkbox" checked={form.es_servicio} onChange={(e) => setForm({ ...form, es_servicio: e.target.checked })} /> Es servicio
          </label>
        </div>
      </div>
      <div className="flex justify-end mb-3">
        <button className="btn" onClick={submit}>+ Agregar categoria</button>
      </div>
      <table className="table">
        <thead><tr><th>Nombre</th><th>Prefijo</th><th>Lote/Vence</th><th>Servicio</th></tr></thead>
        <tbody>{items.map((c) => (
          <tr key={c.id}><td>{c.nombre}</td><td><span className="font-mono text-xs px-1 bg-slate-100 rounded">{c.prefijo}</span></td><td>{c.requiere_lote_vencimiento ? "Si" : ""}</td><td>{c.es_servicio ? "Si" : ""}</td></tr>
        ))}</tbody>
      </table>
    </Section>
  );
}

function Unidades() {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { api.get<{ data: any[] }>("/api/catalogos/unidades-medida").then((r) => setItems(r.data)); }, []);
  return (
    <Section>
      <p className="text-sm text-slate-500 mb-2">Unidades de medida definidas por el seed inicial.</p>
      <table className="table">
        <thead><tr><th>Nombre</th><th>Abreviatura</th></tr></thead>
        <tbody>{items.map((u) => <tr key={u.id}><td>{u.nombre}</td><td>{u.abreviatura}</td></tr>)}</tbody>
      </table>
    </Section>
  );
}
