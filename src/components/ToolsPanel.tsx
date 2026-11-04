import type { ToolReport } from "../lib/drawings.ts";
import { TOOL_INFO, type ToolId } from "../lib/tools.ts";
import type { Measure } from "./Chart.tsx";
import { fmtDate, fmtPct } from "../lib/format.ts";

interface Props {
  reports: ToolReport[];
  measures: Measure[];
  relative: boolean;
  fmt: (v: number) => string;
  barSeconds: number;
  onRemoveMeasure: (id: string) => void;
}

export function ToolsPanel({ reports, measures, relative, fmt, barSeconds, onRemoveMeasure }: Props) {
  if (!reports.length && !measures.length)
    return (
      <div className="panel-body pad">
        <p className="muted">
          Activez un outil automatique dans la barre (Fibo Ext., Fibo Retr., Tendances, S/R, Canal, Pivots, Divergences, Prévision) ou tapez une commande
          comme « extension de fibonacci ». Le tracé est placé automatiquement et recalculé à chaque changement d'actif ou de période.
        </p>
        <ul className="help-list">
          {(Object.keys(TOOL_INFO) as ToolId[]).map((t) => <li key={t}><b>{TOOL_INFO[t].label}</b> — {TOOL_INFO[t].help}</li>)}
        </ul>
      </div>
    );
  return (
    <div className="panel-body cards">
      {measures.map((m) => {
        const chg = relative ? m.b.value - m.a.value : (m.b.value / m.a.value - 1) * 100;
        const days = Math.abs(m.b.time - m.a.time) / 86400;
        return (
          <div className="card" key={m.id}>
            <div className="card-title">📏 Mesure <button className="link" onClick={() => onRemoveMeasure(m.id)}>×</button></div>
            <div className="kv"><span>Départ</span><b>{fmt(m.a.value)} · {fmtDate(m.a.time, barSeconds < 86400)}</b></div>
            <div className="kv"><span>Arrivée</span><b>{fmt(m.b.value)} · {fmtDate(m.b.time, barSeconds < 86400)}</b></div>
            <div className="kv"><span>Variation</span><b style={{ color: chg >= 0 ? "var(--up)" : "var(--down)" }}>{relative ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)} pts de %` : fmtPct(chg)}</b></div>
            {!relative && <div className="kv"><span>Écart</span><b>{fmt(m.b.value - m.a.value)}</b></div>}
            <div className="kv"><span>Durée</span><b>{days >= 1 ? `${days.toFixed(0)} jours` : `${(days * 24).toFixed(1)} h`} · ≈ {Math.round(Math.abs(m.b.time - m.a.time) / barSeconds)} bougies</b></div>
          </div>
        );
      })}
      {reports.map((r, i) => (
        <div className="card" key={`${r.tool}-${i}`}>
          <div className="card-title">{r.title}</div>
          {r.lines.map((l, k) => (
            <div className="kv" key={k}>
              <span>{l.color && <i className="sw" style={{ background: l.color }} />}{l.label}</span>
              <b>{l.value}</b>
            </div>
          ))}
          {r.note && <p className="note">{r.note}</p>}
        </div>
      ))}
    </div>
  );
}
