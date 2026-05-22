import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Tab = "medicos" | "enfermeria" | "administrativos";

export default function Profesionales() {
  const [tab, setTab] = useState<Tab>("medicos");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Profesionales</h1>
      <div className="flex gap-2 border-b">
        {(["medicos", "enfermeria", "administrativos"] as Tab[]).map((t) => (
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
      {tab === "medicos" && <Medicos />}
      {tab === "enfermeria" && <Enfermeria />}
      {tab === "administrativos" && <Administrativos />}
    </div>
  );
}

function Medicos() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ nombres: "", apellidos: "", jvpm: "", especialidad: "", usuario_id: "" });
  const load = () => api.get<{ data: any[] }>("/api/profesionales/medicos").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);
  const submit = async () => {
    if (!form.nombres || !form.apellidos) return;
    await api.post("/api/profesionales/medicos", {
      ...form,
      usuario_id: form.usuario_id ? Number(form.usuario_id) : null,
    });
    setForm({ nombres: "", apellidos: "", jvpm: "", especialidad: "", usuario_id: "" });
    load();
  };
  return (
    <div className="card">
      <div className="grid grid-cols-6 gap-2 mb-3">
        <input className="input" placeholder="Nombres" value={form.nombres} onChange={(e) => setForm({ ...form, nombres: e.target.value })} />
        <input className="input" placeholder="Apellidos" value={form.apellidos} onChange={(e) => setForm({ ...form, apellidos: e.target.value })} />
        <input className="input" placeholder="JVPM" value={form.jvpm} onChange={(e) => setForm({ ...form, jvpm: e.target.value })} />
        <input className="input" placeholder="Especialidad" value={form.especialidad} onChange={(e) => setForm({ ...form, especialidad: e.target.value })} />
        <input className="input" placeholder="Usuario ID (opcional)" value={form.usuario_id} onChange={(e) => setForm({ ...form, usuario_id: e.target.value })} />
        <button className="btn" onClick={submit}>+ Agregar</button>
      </div>
      <table className="table">
        <thead><tr><th>Nombres</th><th>Apellidos</th><th>JVPM</th><th>Especialidad</th><th>Usuario</th></tr></thead>
        <tbody>{items.map((m) => (
          <tr key={m.id}><td>{m.nombres}</td><td>{m.apellidos}</td><td>{m.jvpm ?? "-"}</td><td>{m.especialidad ?? "-"}</td><td>{m.usuario_id ?? "-"}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Enfermeria() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ nombres: "", apellidos: "", registro: "", nivel: "", usuario_id: "" });
  const load = () => api.get<{ data: any[] }>("/api/profesionales/enfermeria").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);
  const submit = async () => {
    if (!form.nombres || !form.apellidos) return;
    await api.post("/api/profesionales/enfermeria", {
      ...form,
      usuario_id: form.usuario_id ? Number(form.usuario_id) : null,
    });
    setForm({ nombres: "", apellidos: "", registro: "", nivel: "", usuario_id: "" });
    load();
  };
  return (
    <div className="card">
      <div className="grid grid-cols-6 gap-2 mb-3">
        <input className="input" placeholder="Nombres" value={form.nombres} onChange={(e) => setForm({ ...form, nombres: e.target.value })} />
        <input className="input" placeholder="Apellidos" value={form.apellidos} onChange={(e) => setForm({ ...form, apellidos: e.target.value })} />
        <input className="input" placeholder="Registro" value={form.registro} onChange={(e) => setForm({ ...form, registro: e.target.value })} />
        <input className="input" placeholder="Nivel" value={form.nivel} onChange={(e) => setForm({ ...form, nivel: e.target.value })} />
        <input className="input" placeholder="Usuario ID (opcional)" value={form.usuario_id} onChange={(e) => setForm({ ...form, usuario_id: e.target.value })} />
        <button className="btn" onClick={submit}>+ Agregar</button>
      </div>
      <table className="table">
        <thead><tr><th>Nombres</th><th>Apellidos</th><th>Registro</th><th>Nivel</th><th>Usuario</th></tr></thead>
        <tbody>{items.map((m) => (
          <tr key={m.id}><td>{m.nombres}</td><td>{m.apellidos}</td><td>{m.registro ?? "-"}</td><td>{m.nivel ?? "-"}</td><td>{m.usuario_id ?? "-"}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Administrativos() {
  const [items, setItems] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ usuario_id: "", cargo: "", area_id: "" });
  const load = () => api.get<{ data: any[] }>("/api/profesionales/administrativos").then((r) => setItems(r.data));
  useEffect(() => {
    load();
    api.get<{ data: any[] }>("/api/catalogos/areas").then((r) => setAreas(r.data));
  }, []);
  const submit = async () => {
    if (!form.usuario_id || !form.cargo) return;
    await api.post("/api/profesionales/administrativos", {
      usuario_id: Number(form.usuario_id),
      cargo: form.cargo,
      area_id: form.area_id ? Number(form.area_id) : null,
    });
    setForm({ usuario_id: "", cargo: "", area_id: "" });
    load();
  };
  return (
    <div className="card">
      <div className="grid grid-cols-6 gap-2 mb-3">
        <input className="input" placeholder="Usuario ID" value={form.usuario_id} onChange={(e) => setForm({ ...form, usuario_id: e.target.value })} />
        <input className="input col-span-2" placeholder="Cargo" value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} />
        <select className="input col-span-2" value={form.area_id} onChange={(e) => setForm({ ...form, area_id: e.target.value })}>
          <option value="">-- Area (opcional) --</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        <button className="btn" onClick={submit}>+ Agregar</button>
      </div>
      <table className="table">
        <thead><tr><th>Usuario</th><th>Email</th><th>Cargo</th><th>Area</th></tr></thead>
        <tbody>{items.map((m) => (
          <tr key={m.id}><td>{m.nombre}</td><td>{m.email}</td><td>{m.cargo}</td><td>{m.area ?? "-"}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
