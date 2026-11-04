import { useMemo, useState } from "react";
import type { AssetDef, Bar } from "../../shared/types.ts";
import { correlation } from "../lib/stats.ts";

interface Props {
  assets: AssetDef[];
  bars: Record<string, Bar[]>;
  selected: string[];
}

const DEFAULT = ["spx", "nasdaq", "btc", "total3es", "dxy", "us10y", "brent", "gold", "msciworld", "vix", "eth", "cac"];

export function CorrelationPanel(p: Props) {
  const [lookback, setLookback] = useState(90);
  const [useSel, setUseSel] = useState(false);
  const ids = useSel ? p.selected : DEFAULT;
  const list = ids.map((id) => p.assets.find((a) => a.id === id)).filter((a): a is AssetDef => !!a && (p.bars[a.symbol]?.length ?? 0) > 30);
  const matrix = useMemo(() => list.map((a) => list.map((b) => (a === b ? 1 : correlation(p.bars[a.symbol], p.bars[b.symbol], lookback)))), [list.map((a) => a.id).join(), p.bars, lookback]); // eslint-disable-line react-hooks/exhaustive-deps

  const color = (c: number | null) => {
    if (c == null) return "transparent";
    const a = Math.abs(c) * 0.75;
    return c >= 0 ? `rgba(41,98,255,${a})` : `rgba(242,54,69,${a})`;
  };

  return (
    <div className="panel-body">
      <div className="panel-controls">
        <span>Corrélation des rendements journaliers sur</span>
        <select value={lookback} onChange={(e) => setLookback(Number(e.target.value))}>
          {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} jours</option>)}
        </select>
        <label className="chk"><input type="checkbox" checked={useSel} onChange={(e) => setUseSel(e.target.checked)} /> Actifs du graphique uniquement</label>
        <span className="muted">Bleu = évoluent ensemble · Rouge = évoluent en sens inverse</span>
      </div>
      {list.length < 2 ? (
        <p className="muted pad">Historique en cours de chargement ou pas assez d'actifs.</p>
      ) : (
        <div className="table-wrap">
          <table className="corr">
            <thead>
              <tr><th />{list.map((a) => <th key={a.id}>{a.short}</th>)}</tr>
            </thead>
            <tbody>
              {list.map((a, i) => (
                <tr key={a.id}>
                  <th>{a.short}</th>
                  {list.map((b, j) => (
                    <td key={b.id} style={{ background: color(matrix[i]?.[j] ?? null) }} title={`${a.short} / ${b.short}`}>
                      {matrix[i]?.[j] == null ? "—" : matrix[i][j]!.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
