import { useState } from "react";
import type { AssetDef } from "../../shared/types.ts";
import { fmtDate } from "../lib/format.ts";
import { type Alert, type AlertEvent, describeAlert } from "../lib/state.ts";
import { PERF_PERIODS, type PerfPeriod } from "../lib/stats.ts";

interface Props {
  assets: AssetDef[];
  alerts: Alert[];
  events: AlertEvent[];
  defaultAsset: string;
  onAdd: (a: Omit<Alert, "id" | "createdAt">) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onClearEvents: () => void;
}

export function AlertsPanel(p: Props) {
  const [assetId, setAssetId] = useState(p.defaultAsset);
  const [kind, setKind] = useState<Alert["kind"]>("above");
  const [value, setValue] = useState("");
  const [period, setPeriod] = useState<PerfPeriod>("1D");
  const [repeat, setRepeat] = useState(false);
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const name = (id: string) => p.assets.find((a) => a.id === id)?.short ?? id;

  return (
    <div className="panel-body">
      <form
        className="panel-controls"
        onSubmit={(e) => {
          e.preventDefault();
          const v = Number(value.replace(",", "."));
          if (!Number.isFinite(v)) return;
          p.onAdd({ assetId, kind, value: Math.abs(v), period: kind.startsWith("change") ? period : undefined, active: true, repeat });
          setValue("");
        }}
      >
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
          {p.assets.map((a) => <option key={a.id} value={a.id}>{a.short} — {a.name}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as Alert["kind"])}>
          <option value="above">passe au-dessus de</option>
          <option value="below">passe en dessous de</option>
          <option value="changeUp">monte de (%)</option>
          <option value="changeDown">baisse de (%)</option>
        </select>
        <input className="num wide" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind.startsWith("change") ? "ex. 5" : "prix"} />
        {kind.startsWith("change") && (
          <>
            <span>sur</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value as PerfPeriod)}>{PERF_PERIODS.slice(0, 5).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
          </>
        )}
        <label className="chk"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Répéter</label>
        <button className="btn primary">Créer l'alerte</button>
        {perm !== "granted" && typeof Notification !== "undefined" && (
          <button type="button" className="btn ghost" onClick={() => Notification.requestPermission().then(setPerm)}>Activer les notifications</button>
        )}
      </form>
      <div className="alerts-grid">
        <div>
          <div className="card-title">Alertes ({p.alerts.length})</div>
          {p.alerts.length === 0 && <p className="muted">Aucune alerte. Astuce : tapez « alerte si btc passe sous 95000 » dans la barre de commandes.</p>}
          {p.alerts.map((a) => (
            <div key={a.id} className={`alert-row ${a.active ? "" : "off"}`}>
              <label className="chk"><input type="checkbox" checked={a.active} onChange={() => p.onToggle(a.id)} /></label>
              <span>{describeAlert(a, name(a.assetId))}{a.repeat ? " (répétée)" : ""}</span>
              {a.lastTriggered && <em className="muted">déclenchée {fmtDate(a.lastTriggered / 1000, true)}</em>}
              <button className="link" onClick={() => p.onRemove(a.id)}>×</button>
            </div>
          ))}
        </div>
        <div>
          <div className="card-title">Historique {p.events.length > 0 && <button className="link" onClick={p.onClearEvents}>effacer</button>}</div>
          {p.events.length === 0 && <p className="muted">Les déclenchements apparaîtront ici (avec notification et son).</p>}
          {p.events.map((e) => (
            <div key={e.id} className="event-row"><span className="muted">{fmtDate(e.time / 1000, true)}</span> {e.text}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
