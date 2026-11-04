import { TIMEFRAMES } from "../../shared/assets.ts";
import { INDICATOR_INFO, type ChartSettings, type IndicatorId, type Template } from "../lib/state.ts";
import { TOOL_INFO, type ToolId } from "../lib/tools.ts";

interface Props {
  settings: ChartSettings;
  update: (patch: Partial<ChartSettings>) => void;
  toggleTool: (t: ToolId) => void;
  toggleIndicator: (i: IndicatorId) => void;
  interaction: "none" | "measure" | "rebase";
  setInteraction: (m: "none" | "measure" | "rebase") => void;
  clearMeasures: () => void;
  hasMeasures: boolean;
  templates: Template[];
  applyTemplate: (t: Template) => void;
  saveTemplate: () => void;
  deleteTemplate: (id: string) => void;
}

const TOOLS: ToolId[] = ["fibRetracement", "fibExtension", "trendlines", "supportResistance", "channel", "pivotPoints", "divergences", "forecast"];
const INDICATORS: IndicatorId[] = ["sma20", "sma50", "sma200", "ema21", "bollinger", "volume", "rsi", "macd"];

export function Toolbar(p: Props) {
  const s = p.settings;
  return (
    <div className="toolbar">
      <div className="tb-row">
        <div className="seg">
          {TIMEFRAMES.map((tf) => (
            <button key={tf.id} className={s.timeframe === tf.id ? "on" : ""} onClick={() => p.update({ timeframe: tf.id, rebaseTime: null })}>{tf.label}</button>
          ))}
        </div>
        <div className="seg" title="Valeur relative (% depuis le début de période) ou absolue (prix)">
          <button className={s.mode === "relative" ? "on" : ""} onClick={() => p.update({ mode: "relative" })}>Relatif %</button>
          <button className={s.mode === "absolute" ? "on" : ""} onClick={() => p.update({ mode: "absolute" })}>Absolu</button>
        </div>
        <div className="seg">
          <button className={s.chartType === "candles" ? "on" : ""} onClick={() => p.update({ chartType: "candles" })} title="Bougies">▮▯</button>
          <button className={s.chartType === "line" ? "on" : ""} onClick={() => p.update({ chartType: "line" })} title="Ligne">⟋</button>
          <button className={s.chartType === "area" ? "on" : ""} onClick={() => p.update({ chartType: "area" })} title="Aire">◢</button>
        </div>
        {s.mode === "absolute" ? (
          <>
            <label className="chk"><input type="checkbox" checked={s.logScale} onChange={(e) => p.update({ logScale: e.target.checked })} /> Log</label>
            <label className="chk" title="Toutes les courbes sur la même échelle de prix"><input type="checkbox" checked={s.sharedScale} onChange={(e) => p.update({ sharedScale: e.target.checked })} /> Échelle commune</label>
          </>
        ) : (
          <button className={`btn ${p.interaction === "rebase" ? "on" : ""}`} onClick={() => p.setInteraction(p.interaction === "rebase" ? "none" : "rebase")} title="Choisir la date de référence (0 %)">
            ⇤ Rebaser{s.rebaseTime ? " ✓" : ""}
          </button>
        )}
        {s.mode === "relative" && s.rebaseTime && <button className="btn ghost" onClick={() => p.update({ rebaseTime: null })}>Base = début</button>}
        <button className={`btn ${p.interaction === "measure" ? "on" : ""}`} onClick={() => p.setInteraction(p.interaction === "measure" ? "none" : "measure")} title="Mesurer la variation entre deux points">📏 Règle</button>
        {p.hasMeasures && <button className="btn ghost" onClick={p.clearMeasures}>Effacer mesures</button>}
        <div className="tb-spacer" />
        <select
          className="tpl"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__save") p.saveTemplate();
            else if (v.startsWith("__del:")) p.deleteTemplate(v.slice(6));
            else { const t = p.templates.find((x) => x.id === v); if (t) p.applyTemplate(t); }
          }}
        >
          <option value="">⚡ Modèles…</option>
          {p.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value="__save">＋ Enregistrer la configuration actuelle…</option>
          {p.templates.filter((t) => !t.builtin).map((t) => <option key={`d${t.id}`} value={`__del:${t.id}`}>🗑 Supprimer « {t.name} »</option>)}
        </select>
      </div>
      <div className="tb-row">
        <span className="tb-label">Outils auto</span>
        {TOOLS.map((t) => (
          <button key={t} className={`chip ${s.tools.includes(t) ? "on" : ""}`} onClick={() => p.toggleTool(t)} title={TOOL_INFO[t].help}>{TOOL_INFO[t].short}</button>
        ))}
        {s.tools.length > 0 && <button className="chip ghost" onClick={() => p.update({ tools: [] })}>✕</button>}
        <select className="mini" value={s.sensitivity} onChange={(e) => p.update({ sensitivity: e.target.value as ChartSettings["sensitivity"] })} title="Sensibilité de détection des pivots">
          <option value="fine">Pivots fins</option>
          <option value="normal">Pivots normaux</option>
          <option value="large">Pivots majeurs</option>
        </select>
        {s.tools.includes("forecast") && (
          <select className="mini" value={s.forecastHorizon} onChange={(e) => p.update({ forecastHorizon: Number(e.target.value) })} title="Horizon de projection (en bougies)">
            {[10, 20, 30, 60, 90, 120].map((h) => <option key={h} value={h}>{h} bougies</option>)}
          </select>
        )}
        <span className="tb-sep" />
        <span className="tb-label">Indicateurs</span>
        {INDICATORS.map((i) => (
          <button key={i} className={`chip ${s.indicators.includes(i) ? "on" : ""}`} onClick={() => p.toggleIndicator(i)} style={s.indicators.includes(i) ? { borderColor: INDICATOR_INFO[i].color } : undefined}>
            {INDICATOR_INFO[i].label}
          </button>
        ))}
      </div>
    </div>
  );
}
