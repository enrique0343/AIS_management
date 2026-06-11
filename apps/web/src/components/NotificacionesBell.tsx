import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type Notif = {
  id: number;
  tipo: string;
  titulo: string;
  cuerpo: string | null;
  leida: number;
  entidad: string | null;
  entidad_id: number | null;
  creado_en: string;
};

const TIPO_ICON: Record<string, string> = {
  stock_bajo: "📦",
  lote_por_vencer: "⏰",
  seguro_sin_cobro: "🏥",
  honorario_pendiente_entrega: "💰",
};

function tiempoRelativo(fecha: string): string {
  const diff = Math.floor((Date.now() - new Date(fecha).getTime()) / 1000);
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

export default function NotificacionesBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    const poll = () =>
      api
        .get<{ n: number }>("/api/notificaciones/_count_no_leidas")
        .then((r) => { if (!stop) setCount(r.n); })
        .catch(() => {});
    poll();
    const t = setInterval(poll, 60_000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function abrirPanel() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setLoading(true);
    const data = await api.get<Notif[]>("/api/notificaciones?limit=30").catch(() => [] as Notif[]);
    setNotifs(data);
    setLoading(false);
  }

  async function marcarLeida(id: number) {
    await api.post(`/api/notificaciones/${id}/leer`, {});
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, leida: 1 } : n));
    setCount((c) => Math.max(0, c - 1));
  }

  async function marcarTodas() {
    await api.post("/api/notificaciones/leer-todas", {});
    setNotifs((prev) => prev.map((n) => ({ ...n, leida: 1 })));
    setCount(0);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={abrirPanel}
        className="relative p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
        aria-label="Notificaciones"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-slate-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50">
            <span className="font-semibold text-sm text-slate-700">Notificaciones</span>
            {count > 0 && (
              <button
                onClick={marcarTodas}
                className="text-xs text-blue-600 hover:underline"
              >
                Marcar todas leídas
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {loading && (
              <div className="p-4 text-center text-slate-400 text-sm">Cargando...</div>
            )}
            {!loading && notifs.length === 0 && (
              <div className="p-6 text-center text-slate-400 text-sm">Sin notificaciones</div>
            )}
            {!loading && notifs.map((n) => (
              <div
                key={n.id}
                className={`px-4 py-3 flex gap-3 hover:bg-slate-50 transition-colors ${n.leida ? "opacity-60" : "bg-blue-50/40"}`}
              >
                <span className="text-lg leading-none mt-0.5 shrink-0">
                  {TIPO_ICON[n.tipo] ?? "🔔"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800 leading-tight">{n.titulo}</p>
                  {n.cuerpo && <p className="text-xs text-slate-500 mt-0.5 leading-snug">{n.cuerpo}</p>}
                  <p className="text-[10px] text-slate-400 mt-1">{tiempoRelativo(n.creado_en)}</p>
                </div>
                {!n.leida && (
                  <button
                    onClick={() => marcarLeida(n.id)}
                    className="shrink-0 mt-0.5 text-blue-500 hover:text-blue-700"
                    title="Marcar como leída"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
