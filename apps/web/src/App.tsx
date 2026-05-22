import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import LoginPage from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Productos from "./pages/Productos";
import Compras from "./pages/Compras";
import Pacientes from "./pages/Pacientes";
import Enfermeria from "./pages/Enfermeria";
import Facturacion from "./pages/Facturacion";
import Quirofano from "./pages/Quirofano";
import Inventario from "./pages/Inventario";
import Catalogos from "./pages/Catalogos";
import Profesionales from "./pages/Profesionales";
import Usuarios from "./pages/Usuarios";
import FacturaPrint from "./pages/FacturaPrint";

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-center text-slate-500">Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/facturas/:id/print"
        element={
          <Protected>
            <FacturaPrint />
          </Protected>
        }
      />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="productos" element={<Productos />} />
        <Route path="inventario" element={<Inventario />} />
        <Route path="compras" element={<Compras />} />
        <Route path="pacientes" element={<Pacientes />} />
        <Route path="enfermeria" element={<Enfermeria />} />
        <Route path="facturacion" element={<Facturacion />} />
        <Route path="quirofano" element={<Quirofano />} />
        <Route path="catalogos" element={<Catalogos />} />
        <Route path="profesionales" element={<Profesionales />} />
        <Route path="usuarios" element={<Usuarios />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
