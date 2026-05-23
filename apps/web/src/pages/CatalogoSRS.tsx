import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

type SrsRow = {
  id: number;
  registro_sanitario: string;
  nombre_comercial: string;
  principio_activo: string | null;
  concentracion: string | null;
  forma_farmaceutica: string | null;
  fabricante: string | null;
  pvmp: number | null;
};

export default function CatalogoSRS() {
  const [rows, setRows] = useState<SrsRow[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const LIMIT = 50;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const fetch = useCallback((search: string, pg: number) => {
    setLoading(true);
    const params = new URLSearchParams({ browse: "1", page: String(pg) });
    if (search.trim().length >= 2) params.set("q", search.trim());
    api
      .get<{ data: SrsRow[]; total: number }>(`/api/catalogos/srs?${params}`)
      .then((r) => { setRows(r.data); setTotal(r.total); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch(q, page); }, [fetch, q, page]);

  const onSearch = (v: string) => { setQ(v); setPage(1); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Catalogo SRS</h1>
          <p className="text-sm text-slate-500">
            Registro Sanitario oficial — solo consulta, {total.toLocaleString()} medicamentos activos
          </p>
        </div>
      </div>

      <div className="card">
        <input
          className="input"
          placeholder="Buscar por nombre comercial, principio activo o registro sanitario..."
          value={q}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <div className="card overflow-auto">
        {loading && <p className="text-sm text-slate-500 py-4 text-center">Cargando...</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-slate-500 py-4 text-center">Sin resultados.</p>
        )}
        {!loading && rows.length > 0 && (
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Reg. Sanitario</th>
                <th>Nombre comercial</th>
                <th>Principio activo</th>
                <th>Concentracion</th>
                <th>Forma farm.</th>
                <th>Fabricante</th>
                <th>PVMP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs whitespace-nowrap text-slate-600">{r.registro_sanitario}</td>
                  <td className="font-medium">{r.nombre_comercial}</td>
                  <td className="text-slate-600">{r.principio_activo ?? "—"}</td>
                  <td className="whitespace-nowrap">{r.concentracion ?? "—"}</td>
                  <td>{r.forma_farmaceutica ?? "—"}</td>
                  <td className="text-xs text-slate-500">{r.fabricante ?? "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    {r.pvmp !== null
                      ? <span className="text-emerald-700 font-semibold">${r.pvmp.toFixed(2)}</span>
                      : <span className="text-slate-400 text-xs">Sin PVMP</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            Pagina {page} de {totalPages} ({total.toLocaleString()} registros)
          </span>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
