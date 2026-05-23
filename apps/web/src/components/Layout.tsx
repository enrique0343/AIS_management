import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth, hasRole } from "../lib/auth";
import { api } from "../lib/api";

const menu = [
  { to: "/", label: "Inicio", roles: [] as string[] },
  { to: "/atencion", label: "Atencion / Hospitalizacion", roles: ["admin", "enfermeria", "medico", "facturacion"] },
  { to: "/farmacia", label: "Farmacia", roles: ["admin", "jefe_farmacia_central", "farmaceutico", "responsable_stock"], badge: "requisiciones" as const },
  { to: "/pacientes", label: "Pacientes", roles: ["admin", "medico", "enfermeria", "facturacion", "programador_quirofano"] },
  { to: "/enfermeria", label: "Enfermeria (consumos directos)", roles: ["admin", "enfermeria", "medico", "farmaceutico"] },
  { to: "/facturacion", label: "Facturacion", roles: ["admin", "facturacion"] },
  { to: "/quirofano", label: "Quirofano", roles: ["admin", "programador_quirofano", "medico", "enfermeria"] },
  { to: "/gastos", label: "Gastos", roles: ["admin", "facturacion"] },
  { to: "/reportes", label: "Reportes", roles: ["admin", "facturacion"] },
  { to: "/catalogos", label: "Catalogos", roles: ["admin", "jefe_farmacia_central"] },
  { to: "/profesionales", label: "Profesionales", roles: ["admin"] },
  { to: "/usuarios", label: "Usuarios", roles: ["admin"] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [reqPend, setReqPend] = useState<number>(0);

  useEffect(() => {
    let stop = false;
    const cargar = () =>
      api.get<{ n: number }>("/api/requisiciones/_pendientes_count")
        .then((r) => { if (!stop) setReqPend(r.n); })
        .catch(() => {});
    cargar();
    const t = setInterval(cargar, 30000); // refresca cada 30s
    return () => { stop = true; clearInterval(t); };
  }, []);

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-slate-900 text-white p-4 flex flex-col">
        <div className="text-lg font-semibold mb-4">AIS Management</div>
        <nav className="flex-1 space-y-1">
          {menu
            .filter((m) => m.roles.length === 0 || hasRole(user, ...m.roles))
            .map((m) => (
              <NavLink
                key={m.to}
                to={m.to}
                end={m.to === "/"}
                className={({ isActive }) =>
                  `flex justify-between items-center px-3 py-2 rounded text-sm ${isActive ? "bg-blue-600" : "hover:bg-slate-800"}`
                }
              >
                <span>{m.label}</span>
                {(m as any).badge === "requisiciones" && reqPend > 0 && (
                  <span className="bg-red-500 text-white text-xs px-1.5 rounded-full">{reqPend}</span>
                )}
              </NavLink>
            ))}
        </nav>
        <div className="mt-auto pt-4 border-t border-slate-700 text-xs">
          <div className="mb-2">
            <div className="font-medium">{user?.nombre}</div>
            <div className="text-slate-400">{user?.email}</div>
            <div className="text-slate-400 mt-1">{user?.roles.join(", ")}</div>
          </div>
          <button onClick={logout} className="btn-danger w-full text-xs">
            Cerrar sesion
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
