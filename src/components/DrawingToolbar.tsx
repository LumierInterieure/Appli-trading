import type { DrawTool } from "../lib/manual.ts";

interface Props {
  tool: DrawTool;
  setTool: (t: DrawTool) => void;
  magnet: boolean;
  setMagnet: (v: boolean) => void;
  hasZone: boolean;
  onClearZone: () => void;
  onRecenter: () => void;
  onClearDrawings: () => void;
  drawingCount: number;
  canUndo: boolean;
  onUndo: () => void;
}

/** Icônes en SVG (traits simples, lisibles en petit). */
const ICONS: Record<string, JSX.Element> = {
  cursor: <path d="M5 3l12 7-5 1.5L10 17z" fill="currentColor" stroke="none" />,
  trend: <><path d="M4 16L16 4" /><circle cx="4" cy="16" r="1.8" /><circle cx="16" cy="4" r="1.8" /></>,
  hline: <><path d="M2 10h16" /><circle cx="10" cy="10" r="1.8" /></>,
  hray: <><path d="M5 10h13" /><circle cx="5" cy="10" r="1.8" /></>,
  rect: <rect x="3.5" y="5" width="13" height="10" rx="1" />,
  fibR: <><path d="M3 4h14M3 8h14M3 11h14M3 16h14" /><path d="M4 16L16 4" strokeDasharray="2 2" /></>,
  fibE: <><path d="M3 15l4-8 4 4" /><path d="M11 5h7M11 9h7M11 13h7" /></>,
  measure: <><path d="M3 15L15 3" /><path d="M3 11v4h4M11 3h4v4" /></>,
  zone: <><path d="M5 3v14M15 3v14" strokeDasharray="2 2" /><path d="M5 10h10" /><path d="M7 8l-2 2 2 2M13 8l2 2-2 2" /></>,
  magnet: <path d="M5 4v6a5 5 0 0 0 10 0V4h-3v6a2 2 0 0 1-4 0V4z" />,
  recenter: <><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" /><circle cx="10" cy="10" r="2" /></>,
  undo: <path d="M7 6L3 10l4 4M3 10h9a5 5 0 0 1 0 10" />,
  trash: <path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11" />,
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

const TOOLS: { id: DrawTool; title: string }[] = [
  { id: "cursor", title: "Curseur — sélectionner, déplacer (Échap)" },
  { id: "trend", title: "Ligne de tendance (T)" },
  { id: "hline", title: "Ligne horizontale (H)" },
  { id: "hray", title: "Demi-droite horizontale" },
  { id: "rect", title: "Rectangle / zone de prix (R)" },
  { id: "fibR", title: "Retracement de Fibonacci (F)" },
  { id: "fibE", title: "Extension de Fibonacci — 3 points A, B, C (E)" },
  { id: "measure", title: "Règle : mesurer une variation (M)" },
  { id: "zone", title: "Zone d'analyse : choisir où les outils automatiques travaillent (Z)" },
];

export function DrawingToolbar(p: Props) {
  return (
    <div className="draw-bar" onMouseDown={(e) => e.stopPropagation()}>
      {TOOLS.map((t) => (
        <button key={t.id} className={p.tool === t.id ? "on" : ""} title={t.title} onClick={() => p.setTool(p.tool === t.id && t.id !== "cursor" ? "cursor" : t.id)}>
          <Icon name={t.id} />
        </button>
      ))}
      <span className="sep" />
      <button className={p.magnet ? "on" : ""} title="Aimant : accroche les points aux prix d'ouverture, haut, bas, clôture" onClick={() => p.setMagnet(!p.magnet)}>
        <Icon name="magnet" />
      </button>
      <button title="Recentrer le graphique (Alt+R)" onClick={p.onRecenter}>
        <Icon name="recenter" />
      </button>
      <button title="Annuler (Ctrl+Z)" disabled={!p.canUndo} onClick={p.onUndo}>
        <Icon name="undo" />
      </button>
      <button
        title={p.drawingCount ? `Effacer les ${p.drawingCount} dessin(s) de cet actif` : "Aucun dessin"}
        disabled={!p.drawingCount && !p.hasZone}
        onClick={() => {
          if (p.hasZone && !p.drawingCount) p.onClearZone();
          else if (window.confirm(`Effacer les ${p.drawingCount} dessin(s) de cet actif ?`)) p.onClearDrawings();
        }}
      >
        <Icon name="trash" />
      </button>
    </div>
  );
}
