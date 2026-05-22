import { NavLink, Outlet } from "react-router-dom";
import { useAuth, hasRole } from "../lib/auth";

const menu = [
  { to: "/", label: "Inicio", roles: [] },
  { to: "/productos", label: "Productos", roles: ["admin", "jefe_farmacia_central", "farmaceutico"] },
  { to: "/inventario", label: "Inventario", roles: ["admin", "jefe_farmacia_central", "farmaceutico", "responsable_stock"] },
  { to: "/compras", label: "Compras", roles: ["admin", "jefe_farmacia_central"] },
  { to: "/pacientes", label: "Pacientes", roles: ["admin", "medico", "enfermeria", "facturacion", "programador_quirofano"] },
  { to: "/enfermeria", label: "Enfermeria", roles: ["admin", "enfermeria", "medico", "farmaceutico"] },
  { to: "/facturacion", label: "Facturacion", roles: ["admin", "facturacion"] },
  { to: "/quirofano", label: "Quirofano", roles: ["admin", "programador_quirofano", "medico", "enfermeria"] },
];

export default function Layout() {
  const { user, logout } = useAuth();
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
                  `block px-3 py-2 rounded text-sm ${isActive ? "bg-blue-600" : "hover:bg-slate-800"}`
                }
              >
                {m.label}
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
