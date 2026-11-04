import { useEffect, useMemo, useState } from "react";
import type { AssetDef, Category, Quote, SearchResult } from "../../shared/types.ts";
import { api } from "../lib/api.ts";
import { fmtPct, fmtPrice, pctColor } from "../lib/format.ts";
import { Sparkline } from "./Sparkline.tsx";

interface Props {
  assets: AssetDef[];
  quotes: Record<string, Quote>;
  mainId: string;
  overlays: string[];
  colors: Record<string, string>;
  onSelect: (id: string) => void;
  onToggleOverlay: (id: string) => void;
  onAddCustom: (r: SearchResult) => void;
  onRemoveCustom: (id: string) => void;
}

const ORDER: Category[] = ["Indices US", "Indices monde", "Crypto", "Taux", "Devises", "Matières premières", "Volatilité", "Actions", "Perso"];

export function Watchlist(p: Props) {
  const [filter, setFilter] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const q = filter.trim();
    if (q.length < 2) { setResults([]); return; }
    const id = setTimeout(() => {
      api.search(q).then((r) => setResults(r.results.filter((x) => !p.assets.some((a) => a.symbol === x.symbol)).slice(0, 8))).catch(() => setResults([]));
    }, 350);
    return () => clearTimeout(id);
  }, [filter, p.assets]);

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const match = (a: AssetDef) => !f || `${a.name} ${a.short} ${a.symbol} ${(a.aliases ?? []).join(" ")}`.toLowerCase().includes(f);
    const core = p.assets.filter((a) => a.core && match(a));
    const rest = ORDER.map((c) => ({ cat: c as string, items: p.assets.filter((a) => !a.core && a.category === c && match(a)) })).filter((g) => g.items.length);
    return [{ cat: "Ma sélection", items: core }, ...rest].filter((g) => g.items.length);
  }, [p.assets, filter]);

  return (
    <aside className="watchlist">
      <div className="wl-search">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer ou ajouter un ticker (ex. ASML, LVMH, ^VIX)…" />
      </div>
      {results.length > 0 && (
        <div className="wl-results">
          <div className="wl-cat">Ajouter depuis Yahoo Finance</div>
          {results.map((r) => (
            <button key={r.symbol} className="wl-result" onClick={() => { p.onAddCustom(r); setFilter(""); }}>
              <b>{r.symbol}</b> <span>{r.name}</span> <em>{r.exchange ?? ""} {r.type ?? ""}</em>
            </button>
          ))}
        </div>
      )}
      <div className="wl-list">
        {groups.map((g) => (
          <div key={g.cat}>
            <button className="wl-cat" onClick={() => setCollapsed((c) => ({ ...c, [g.cat]: !c[g.cat] }))}>
              {collapsed[g.cat] ? "▸" : "▾"} {g.cat} <span>{g.items.length}</span>
            </button>
            {!collapsed[g.cat] && g.items.map((a) => {
              const q = p.quotes[a.symbol];
              const isMain = a.id === p.mainId;
              const isOv = p.overlays.includes(a.id);
              return (
                <div key={a.id} className={`wl-row ${isMain ? "active" : ""}`} onClick={() => p.onSelect(a.id)} title={a.description ?? a.name}>
                  <button
                    className={`wl-ov ${isOv ? "on" : ""}`}
                    style={isOv ? { background: p.colors[a.id], borderColor: p.colors[a.id] } : isMain ? { borderColor: "var(--accent)" } : undefined}
                    title={isMain ? "Actif principal" : isOv ? "Retirer de la superposition" : "Superposer au graphique"}
                    onClick={(e) => { e.stopPropagation(); if (!isMain) p.onToggleOverlay(a.id); }}
                  >{isOv ? "✓" : isMain ? "●" : "+"}</button>
                  <div className="wl-name">
                    <b>{a.short}</b>
                    <span>{a.name}</span>
                  </div>
                  <Sparkline values={q?.spark ?? []} base={q?.previousClose} />
                  <div className="wl-px">
                    <b>{fmtPrice(q?.price, a)}</b>
                    <span style={{ color: pctColor(q?.changePct) }}>{fmtPct(q?.changePct)}</span>
                  </div>
                  {a.category === "Perso" && (
                    <button className="wl-del" title="Supprimer" onClick={(e) => { e.stopPropagation(); p.onRemoveCustom(a.id); }}>×</button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
