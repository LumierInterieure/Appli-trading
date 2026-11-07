import type { ToolReport } from "../lib/drawings.ts";
import { TOOL_INFO, type ToolId } from "../lib/tools.ts";
import type { RawPt } from "../lib/manual.ts";

export interface Measure {
  id: string;
  a: RawPt;
  b: RawPt;
}
import { fmtDate, fmtPct } from "../lib/format.ts";

interface Props {
  reports: ToolReport[];
  measures: Measure[];
  /** Formatage des prix réels de l'actif. */
  fmt: (v: number) => string;
  hiddenCount: number;
  onShowHidden: () => void;
  zone: { from: number; to: number } | null;
  onClearZone: () => void;
  barSeconds: number;
  onRemoveMeasure: (id: string) => void;
}

export function ToolsPanel({ reports, measures, fmt, barSeconds, onRemoveMeasure, hiddenCount, onShowHidden, zone, onClearZone }: Props) {
  const banner = (zone || hiddenCount > 0) && (
    <div className="tools-banner">
      {zone && (
        <span>🎯 Zone d'analyse : <b>{fmtDate(zone.from, barSeconds < 86400)} → {fmtDate(zone.to, barSeconds < 86400)}</b> — les outils automatiques ne regardent que cette période. <button className="link" onClick={onClearZone}>Retirer la zone</button></span>
      )}
      {hiddenCount > 0 && (
        <span>{hiddenCount} ligne(s) automatique(s) masquée(s). <button className="link" onClick={onShowHidden}>Tout réafficher</button></span>
      )}
    </div>
  );
  if (!reports.length && !measures.length)
    return (
      <div className="panel-body pad">
        {banner}
        <p className="muted">
          Activez un outil automatique dans la barre (Fibo Ext., Fibo Retr., Tendances, S/R, Canal, Pivots, Divergences, Prévision) ou tapez une commande
          comme « extension de fibonacci ». Le tracé est placé automatiquement et recalculé à chaque changement d'actif ou de période.
          Pour qu'il ne regarde qu'une période précise, utilisez la <b>zone d'analyse</b> (icône 🎯 de la barre de dessin, à gauche du graphique).
          Cliquez sur n'importe quelle ligne pour changer sa couleur, la masquer ou la figer.
        </p>
        <ul className="help-list">
          {(Object.keys(TOOL_INFO) as ToolId[]).map((t) => <li key={t}><b>{TOOL_INFO[t].label}</b> — {TOOL_INFO[t].help}</li>)}
        </ul>
      </div>
    );
  return (
    <div className="panel-body cards">
      {banner}
      {measures.map((m) => {
        const chg = (m.b.price / m.a.price - 1) * 100;
        const days = Math.abs(m.b.time - m.a.time) / 86400;
        return (
          <div className="card" key={m.id}>
            <div className="card-title">📏 Mesure <button className="link" onClick={() => onRemoveMeasure(m.id)}>×</button></div>
            <div className="kv"><span>Départ</span><b>{fmt(m.a.price)} · {fmtDate(m.a.time, barSeconds < 86400)}</b></div>
            <div className="kv"><span>Arrivée</span><b>{fmt(m.b.price)} · {fmtDate(m.b.time, barSeconds < 86400)}</b></div>
            <div className="kv"><span>Variation</span><b style={{ color: chg >= 0 ? "var(--up)" : "var(--down)" }}>{fmtPct(chg)}</b></div>
            <div className="kv"><span>Écart</span><b>{fmt(m.b.price - m.a.price)}</b></div>
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
