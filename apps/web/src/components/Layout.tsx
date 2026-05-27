import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth, hasRole } from "../lib/auth";
import { api } from "../lib/api";

type MenuItem = {
  to: string; label: string; roles: string[];
  badge?: "requisiciones" | "alta"; group: "top" | "clinico" | "admin" | "config";
};

const menu: MenuItem[] = [
  { to: "/", label: "Inicio", roles: [], group: "top" },
  // Clinico
  { to: "/pacientes", label: "Pacientes", roles: ["admin", "medico", "enfermeria", "facturacion", "programador_quirofano"], group: "clinico" },
  { to: "/atencion", label: "Atencion / Hospitalizacion", roles: ["admin", "enfermeria", "medico", "facturacion"], group: "clinico" },
  { to: "/enfermeria", label: "Enfermeria", roles: ["admin", "enfermeria", "medico", "farmaceutico"], group: "clinico" },
  { to: "/quirofano", label: "Quirofano", roles: ["admin", "programador_quirofano", "medico", "enfermeria"], group: "clinico" },
  { to: "/farmacia", label: "Farmacia", roles: ["admin", "jefe_farmacia_central", "farmaceutico", "responsable_stock"], badge: "requisiciones", group: "clinico" },
  // Administracion
  { to: "/facturacion", label: "Facturacion", roles: ["admin", "facturacion"], badge: "alta", group: "admin" },
  { to: "/gastos", label: "Gastos", roles: ["admin", "facturacion"], group: "admin" },
  { to: "/reportes", label: "Reportes", roles: ["admin", "facturacion"], group: "admin" },
  { to: "/inventario", label: "Inventario", roles: ["admin", "jefe_farmacia_central", "farmaceutico", "responsable_stock"], group: "admin" },
  { to: "/compras", label: "Compras", roles: ["admin", "jefe_farmacia_central"], group: "admin" },
  // Configuracion
  { to: "/productos", label: "Productos", roles: ["admin", "jefe_farmacia_central", "farmaceutico"], group: "config" },
  { to: "/catalogo-srs", label: "Catalogo SRS", roles: ["admin", "jefe_farmacia_central", "farmaceutico", "responsable_stock"], group: "config" },
  { to: "/catalogos", label: "Catalogos", roles: ["admin", "jefe_farmacia_central"], group: "config" },
  { to: "/profesionales", label: "Profesionales", roles: ["admin"], group: "config" },
  { to: "/usuarios", label: "Usuarios", roles: ["admin"], group: "config" },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [reqPend, setReqPend] = useState<number>(0);
  const [altaPend, setAltaPend] = useState<number>(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  useEffect(() => {
    let stop = false;
    const cargar = () =>
      api.get<{ n: number }>("/api/requisiciones/_pendientes_count")
        .then((r) => { if (!stop) setReqPend(r.n); })
        .catch(() => {});
    cargar();
    const t = setInterval(cargar, 30000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    let stop = false;
    const cargar = () =>
      api.get<{ n: number }>("/api/facturacion/_alta_count")
        .then((r) => { if (!stop) setAltaPend(r.n); })
        .catch(() => {});
    cargar();
    const t = setInterval(cargar, 30000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Backdrop móvil */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white flex flex-col transition-transform duration-200
          md:relative md:w-56 md:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between p-4">
          <div className="text-lg font-semibold">AIS Management</div>
          <button
            className="md:hidden text-slate-400 hover:text-white p-1 rounded"
            onClick={() => setSidebarOpen(false)}
            aria-label="Cerrar menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 px-3 overflow-y-auto pb-4">
          {(["top", "clinico", "admin", "config"] as const).map((group) => {
            const items = menu.filter((m) =>
              m.group === group && (m.roles.length === 0 || hasRole(user, ...m.roles))
            );
            if (!items.length) return null;
            const labels: Record<string, string> = { clinico: "Clinico", admin: "Administracion", config: "Configuracion" };
            return (
              <div key={group} className="mb-3">
                {group !== "top" && (
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 px-3 pt-3 pb-1">
                    {labels[group]}
                  </div>
                )}
                <div className="space-y-0.5">
                  {items.map((m) => (
                    <NavLink
                      key={m.to}
                      to={m.to}
                      end={m.to === "/"}
                      className={({ isActive }) =>
                        `flex justify-between items-center px-3 py-2 rounded text-sm ${isActive ? "bg-blue-600" : "hover:bg-slate-800"}`
                      }
                    >
                      <span>{m.label}</span>
                      {m.badge === "requisiciones" && reqPend > 0 && (
                        <span className="bg-red-500 text-white text-xs px-1.5 rounded-full">{reqPend}</span>
                      )}
                      {m.badge === "alta" && altaPend > 0 && (
                        <span className="bg-amber-500 text-white text-xs px-1.5 rounded-full">{altaPend}</span>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="mt-auto p-4 border-t border-slate-700 text-xs">
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

      {/* Área de contenido */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar móvil */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-slate-900 text-white sticky top-0 z-30 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 rounded hover:bg-slate-800"
            aria-label="Abrir menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-semibold text-sm flex-1">AIS Management</span>
          {reqPend > 0 && (
            <NavLink to="/farmacia" className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-semibold">
              {reqPend} pend.
            </NavLink>
          )}
          {altaPend > 0 && (
            <NavLink to="/facturacion" className="bg-amber-500 text-white text-xs px-2 py-0.5 rounded-full font-semibold">
              {altaPend} alta
            </NavLink>
          )}
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
