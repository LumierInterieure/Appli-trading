import { useMemo, useState } from "react";
import type { AssetDef, Bar, Quote } from "../../shared/types.ts";
import { fmtPct, fmtPrice, heat } from "../lib/format.ts";
import { changeBetween, maxDrawdown, PERF_PERIODS, type PerfPeriod, periodChange } from "../lib/stats.ts";

interface Props {
  assets: AssetDef[];
  bars: Record<string, Bar[]>;
  quotes: Record<string, Quote>;
  progress: { done: number; total: number };
  onSelect: (id: string) => void;
  onOverlay: (id: string) => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const monthsAgo = (m: number) => { const d = new Date(); d.setMonth(d.getMonth() - m); return d.toISOString().slice(0, 10); };

export function PerformancePanel(p: Props) {
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "core", dir: 1 });
  const [from, setFrom] = useState(monthsAgo(3));
  const [to, setTo] = useState(today());
  const [cat, setCat] = useState("Tous");
  const [fPeriod, setFPeriod] = useState<PerfPeriod>("1M");
  const [fOp, setFOp] = useState<"none" | "gte" | "lte">("none");
  const [fVal, setFVal] = useState(5);

  const rows = useMemo(() => {
    const fromT = Date.parse(from) / 1000;
    const toT = Date.parse(to) / 1000 + 86399;
    return p.assets
      .filter((a) => cat === "Tous" || (cat === "Ma sélection" ? a.core : a.category === cat))
      .map((a) => {
        const b = p.bars[a.symbol] ?? [];
        const q = p.quotes[a.symbol];
        const perf: Partial<Record<PerfPeriod, number | null>> = {};
        for (const per of PERF_PERIODS) perf[per.id] = b.length ? periodChange(b, per.id, q?.price, q?.previousClose) : per.id === "1D" ? q?.changePct ?? null : null;
        const custom = b.length ? changeBetween(b, fromT, toT) : null;
        const dd = b.length ? maxDrawdown(b.slice(-260)).fromHigh : null;
        return { a, q, perf, custom, dd };
      });
  }, [p.assets, p.bars, p.quotes, from, to, cat]);

  const filtered = rows.filter((r) => {
    if (fOp === "none") return true;
    const v = r.perf[fPeriod];
    if (v == null) return false;
    return fOp === "gte" ? v >= fVal : v <= -Math.abs(fVal);
  });

  const sorted = [...filtered].sort((x, y) => {
    if (sort.col === "core") return (Number(!!y.a.core) - Number(!!x.a.core)) * sort.dir;
    if (sort.col === "name") return x.a.short.localeCompare(y.a.short) * sort.dir;
    const vx = sort.col === "custom" ? x.custom : sort.col === "dd" ? x.dd : x.perf[sort.col as PerfPeriod];
    const vy = sort.col === "custom" ? y.custom : sort.col === "dd" ? y.dd : y.perf[sort.col as PerfPeriod];
    return ((vy ?? -1e9) - (vx ?? -1e9)) * sort.dir;
  });

  const th = (col: string, label: string, title?: string) => (
    <th key={col} onClick={() => setSort((s) => ({ col, dir: s.col === col ? (-s.dir as 1 | -1) : 1 }))} className={sort.col === col ? "sorted" : ""} title={title}>
      {label}{sort.col === col ? (sort.dir === 1 ? " ↓" : " ↑") : ""}
    </th>
  );
  const cats = ["Tous", "Ma sélection", ...Array.from(new Set(p.assets.map((a) => a.category)))];

  return (
    <div className="panel-body">
      <div className="panel-controls">
        <select value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <span className="tb-sep" />
        <span>Période personnalisée :</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span>→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <span className="tb-sep" />
        <span>Filtrer :</span>
        <select value={fOp} onChange={(e) => setFOp(e.target.value as typeof fOp)}>
          <option value="none">aucun</option>
          <option value="gte">hausse ≥</option>
          <option value="lte">baisse ≥</option>
        </select>
        {fOp !== "none" && (
          <>
            <input type="number" className="num" value={fVal} step={0.5} onChange={(e) => setFVal(Number(e.target.value))} /> %
            <span>sur</span>
            <select value={fPeriod} onChange={(e) => setFPeriod(e.target.value as PerfPeriod)}>{PERF_PERIODS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
            <span className="muted">{filtered.length} actif(s)</span>
          </>
        )}
        {p.progress.done < p.progress.total && <span className="muted">Chargement historique {p.progress.done}/{p.progress.total}…</span>}
      </div>
      <div className="table-wrap">
        <table className="perf">
          <thead>
            <tr>
              {th("name", "Actif")}
              <th>Prix</th>
              {PERF_PERIODS.map((x) => th(x.id, x.label))}
              {th("custom", "Perso", `${from} → ${to}`)}
              {th("dd", "vs + haut 1A", "Écart au plus haut sur 1 an")}
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ a, q, perf, custom, dd }) => (
              <tr key={a.id}>
                <td className="name" onClick={() => p.onSelect(a.id)} title={a.name}><b>{a.short}</b><span>{a.name}</span></td>
                <td className="px">{fmtPrice(q?.price ?? p.bars[a.symbol]?.at(-1)?.close, a)}</td>
                {PERF_PERIODS.map((x) => {
                  const v = perf[x.id];
                  const scale = x.id === "1D" ? 3 : x.id === "1W" ? 6 : x.id === "1M" ? 10 : 25;
                  return <td key={x.id} style={{ background: heat(v, scale) }}>{fmtPct(v, 1)}</td>;
                })}
                <td style={{ background: heat(custom, 15) }}>{fmtPct(custom, 1)}</td>
                <td style={{ background: heat(dd, 25) }}>{fmtPct(dd, 1)}</td>
                <td><button className="link" onClick={() => p.onOverlay(a.id)} title="Superposer au graphique">＋</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
