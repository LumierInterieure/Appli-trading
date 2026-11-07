import { useEffect, useRef } from "react";
import type { LineStyleName } from "../lib/drawLayer.ts";
import { PALETTE } from "../lib/manual.ts";

export interface MenuTarget {
  id: string;
  source: "auto" | "manual" | "zone";
  title: string;
  color: string;
  width: number;
  style: LineStyleName;
  /** null : option sans objet pour cette figure. */
  extendRight: boolean | null;
  canFreeze: boolean;
  /** Outil automatique d'origine (pour « masquer l'outil »). */
  toolLabel?: string;
}

interface Props {
  target: MenuTarget;
  x: number;
  y: number;
  onColor: (c: string) => void;
  onWidth: (w: number) => void;
  onStyle: (s: LineStyleName) => void;
  onExtend: (v: boolean) => void;
  onDelete: () => void;
  onFreeze: () => void;
  onHideTool: () => void;
  onRetarget: () => void;
  onClose: () => void;
}

/** Mini-menu contextuel à côté de la souris (comme TradingView). */
export function DrawingMenu(p: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const t = p.target;

  // reste dans le cadre du graphique
  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const maxX = parent.clientWidth - el.offsetWidth - 8;
    const maxY = parent.clientHeight - el.offsetHeight - 8;
    el.style.left = `${Math.max(8, Math.min(p.x + 12, maxX))}px`;
    el.style.top = `${Math.max(8, Math.min(p.y + 12, maxY))}px`;
  }, [p.x, p.y, t.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") p.onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  return (
    <div ref={ref} className="draw-menu" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="dm-head">
        <span>{t.title}</span>
        <button className="link" onClick={p.onClose} title="Fermer (Échap)">×</button>
      </div>
      {t.source !== "zone" && (
        <>
          <div className="dm-row colors">
            {PALETTE.map((c) => (
              <button key={c} className={`sw ${c.toLowerCase() === t.color.toLowerCase() ? "on" : ""}`} style={{ background: c }} onClick={() => p.onColor(c)} title={c} />
            ))}
            <label className="sw custom" title="Autre couleur">
              <input type="color" value={t.color.startsWith("#") && t.color.length === 7 ? t.color : "#2962ff"} onChange={(e) => p.onColor(e.target.value)} />
            </label>
          </div>
          <div className="dm-row">
            {[1, 2, 3, 4].map((w) => (
              <button key={w} className={`opt ${t.width === w ? "on" : ""}`} onClick={() => p.onWidth(w)} title={`Épaisseur ${w}`}>
                <i style={{ height: w, background: "currentColor" }} />
              </button>
            ))}
            <span className="dm-sep" />
            {(["solid", "dashed", "dotted"] as const).map((s) => (
              <button key={s} className={`opt ${t.style === s ? "on" : ""}`} onClick={() => p.onStyle(s)} title={s === "solid" ? "Continu" : s === "dashed" ? "Tirets" : "Pointillés"}>
                <i className={`ls ${s}`} />
              </button>
            ))}
          </div>
          {t.extendRight !== null && (
            <label className="dm-check">
              <input type="checkbox" checked={t.extendRight} onChange={(e) => p.onExtend(e.target.checked)} /> Prolonger vers la droite
            </label>
          )}
        </>
      )}
      <div className="dm-actions">
        {t.source === "auto" && t.canFreeze && <button onClick={p.onFreeze} title="Copie ce tracé en dessin manuel : il ne bougera plus et devient modifiable">📌 Figer (dessin manuel)</button>}
        {t.source === "auto" && <button onClick={p.onRetarget} title="Choisir la période que l'algorithme doit analyser">🎯 Cibler une zone…</button>}
        {t.source === "auto" && t.toolLabel && <button onClick={p.onHideTool}>Désactiver « {t.toolLabel} »</button>}
        {t.source === "zone" && <button onClick={p.onRetarget}>🎯 Redéfinir la zone…</button>}
        <button className="danger" onClick={p.onDelete}>
          🗑 {t.source === "auto" ? "Masquer cette ligne" : t.source === "zone" ? "Supprimer la zone" : "Supprimer"} <kbd>Suppr</kbd>
        </button>
      </div>
    </div>
  );
}
