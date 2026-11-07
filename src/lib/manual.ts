import type { Drawing, Marker, Pt } from "./drawings.ts";
import type { LineStyleName, Shape } from "./drawLayer.ts";
import { FIB_COLORS } from "./tools.ts";

/** Dessins faits à la main (persistés par actif, en prix réels). */
export type ManualKind = "trend" | "hline" | "hray" | "rect" | "fibR" | "fibE" | "measure";
export type DrawTool = "cursor" | ManualKind | "zone" | "rebase";

/** Nombre de clics nécessaires pour chaque outil. */
export const TOOL_POINTS: Record<Exclude<DrawTool, "cursor">, number> = {
  trend: 2, hline: 1, hray: 1, rect: 2, fibR: 2, fibE: 3, measure: 2, zone: 2, rebase: 1,
};

export const DRAW_TOOL_INFO: Record<Exclude<DrawTool, "cursor">, { label: string; hint: string[] }> = {
  trend: { label: "Ligne de tendance", hint: ["Cliquez le premier point", "Cliquez le second point"] },
  hline: { label: "Ligne horizontale", hint: ["Cliquez le niveau"] },
  hray: { label: "Demi-droite horizontale", hint: ["Cliquez le point de départ"] },
  rect: { label: "Rectangle / zone de prix", hint: ["Cliquez un premier coin", "Cliquez le coin opposé"] },
  fibR: { label: "Retracement de Fibonacci", hint: ["Cliquez le début de l'impulsion", "Cliquez la fin de l'impulsion"] },
  fibE: { label: "Extension de Fibonacci", hint: ["Cliquez A (début de l'impulsion)", "Cliquez B (fin de l'impulsion)", "Cliquez C (fin de la correction)"] },
  measure: { label: "Règle (mesure)", hint: ["Cliquez le point de départ", "Cliquez le point d'arrivée"] },
  zone: { label: "Zone d'analyse", hint: ["Cliquez le début de la zone que les outils automatiques doivent analyser", "Cliquez la fin de la zone"] },
  rebase: { label: "Rebaser", hint: ["Cliquez la date de référence (0 %)"] },
};

export interface RawPt {
  time: number;
  price: number;
}

export interface ManualDrawing {
  id: string;
  kind: ManualKind;
  points: RawPt[];
  color: string;
  width: number;
  style: LineStyleName;
  extendRight?: boolean;
  extendLeft?: boolean;
  createdAt: number;
}

export const DEFAULT_STYLE: Record<ManualKind, Pick<ManualDrawing, "color" | "width" | "style" | "extendRight">> = {
  trend: { color: "#2962ff", width: 2, style: "solid" },
  hline: { color: "#f7c948", width: 1, style: "solid" },
  hray: { color: "#00bcd4", width: 1, style: "solid" },
  rect: { color: "#7e57c2", width: 1, style: "solid" },
  fibR: { color: "#9598a1", width: 1, style: "dashed", extendRight: true },
  fibE: { color: "#2962ff", width: 1, style: "dashed", extendRight: true },
  measure: { color: "#22c55e", width: 1, style: "solid" },
};

export const PALETTE = ["#2962ff", "#00bcd4", "#22c55e", "#f7c948", "#ff9800", "#f43f5e", "#e91e63", "#ab47bc", "#d1d4dc", "#787b86"];

export const FIB_R_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
export const FIB_E_LEVELS = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618];

export interface ShapeOptions {
  relative: boolean;
  fmt: (v: number) => string;
  barSeconds: number;
  selected?: boolean;
  source?: Shape["source"];
}

function duration(seconds: number): string {
  const d = seconds / 86400;
  if (d >= 1) return `${Math.round(d)} j`;
  const h = seconds / 3600;
  if (h >= 1) return `${h.toFixed(1).replace(".0", "")} h`;
  return `${Math.round(seconds / 60)} min`;
}

/** Texte de la règle : variation en %, écart, nombre de bougies, durée. */
export function measureText(a: Pt, b: Pt, o: ShapeOptions): string[] {
  // en mode relatif, les valeurs sont des % depuis la base : on revient au rapport de prix réel
  const pct = o.relative ? ((100 + b.value) / (100 + a.value) - 1) * 100 : a.value ? (b.value / a.value - 1) * 100 : 0;
  const diff = b.value - a.value;
  const sign = (v: number) => (v >= 0 ? "+" : "−");
  const first = `${sign(pct)}${Math.abs(pct).toFixed(2).replace(".", ",")} %   (${sign(diff)}${o.relative ? `${Math.abs(diff).toFixed(2)} pts` : o.fmt(Math.abs(diff))})`;
  const secs = Math.abs(b.time - a.time);
  const bars = Math.round(secs / o.barSeconds);
  return [first, `${bars} bougie${bars > 1 ? "s" : ""} · ${duration(secs)}`];
}

/** Figure à dessiner pour un dessin manuel (points déjà dans l'unité affichée). */
export function manualShape(
  d: { id: string; kind: ManualKind | "zone"; points: Pt[]; color: string; width: number; style: LineStyleName; extendRight?: boolean; extendLeft?: boolean },
  o: ShapeOptions,
): Shape {
  const base = { id: d.id, source: o.source ?? ("manual" as const), color: d.color, width: d.width, style: d.style, selected: o.selected, editable: (o.source ?? "manual") === "manual" };
  const p = d.points;
  switch (d.kind) {
    case "trend":
      return { ...base, kind: "segment", points: p.length === 1 ? [p[0], p[0]] : p, extendRight: d.extendRight, extendLeft: d.extendLeft, axisLabel: !!o.selected };
    case "hline":
      return { ...base, kind: "hline", points: p.slice(0, 1), axisLabel: true };
    case "hray":
      return { ...base, kind: "hline", points: p.slice(0, 1), extendLeft: false, axisLabel: true };
    case "rect":
      return { ...base, kind: "rect", points: p.length === 1 ? [p[0], p[0]] : p };
    case "measure":
      return { ...base, kind: "measure", points: p.length === 1 ? [p[0], p[0]] : p, text: p.length >= 2 ? measureText(p[0], p[1], o) : [] };
    case "zone":
      return { ...base, kind: "vzone", source: o.source === "preview" ? "preview" : "zone", editable: false, points: p.length === 1 ? [p[0], p[0]] : p, label: "Zone d'analyse" };
    case "fibR": {
      if (p.length < 2) return { ...base, kind: "segment", points: [p[0], p[0]] };
      const [a, b] = p;
      const levels = FIB_R_LEVELS.map((r) => ({ ratio: r, value: b.value - (b.value - a.value) * r, color: FIB_COLORS[String(r)] ?? d.color }));
      return { ...base, kind: "fib", points: p, levels, extendRight: d.extendRight };
    }
    case "fibE": {
      if (p.length < 2) return { ...base, kind: "segment", points: [p[0], p[0]] };
      if (p.length === 2) return { ...base, kind: "segment", points: p, style: "dashed" };
      const [a, b, c] = p;
      const levels = FIB_E_LEVELS.map((r) => ({ ratio: r, value: c.value + (b.value - a.value) * r, color: FIB_COLORS[String(r)] ?? d.color }));
      return { ...base, kind: "fib", points: p, levels, extendRight: d.extendRight };
    }
  }
}

/** Réglages d'affichage modifiés par l'utilisateur pour une ligne automatique. */
export interface AutoOverride {
  hidden?: boolean;
  color?: string;
  width?: number;
  style?: LineStyleName;
}

/** Convertit les sorties des outils automatiques en figures + repères. */
export function autoShapes(drawings: Drawing[], overrides: Record<string, AutoOverride>, selectedId: string | null): { shapes: Shape[]; markers: Marker[] } {
  const shapes: Shape[] = [];
  const markers: Marker[] = [];
  for (const d of drawings) {
    if (d.kind === "markers") {
      markers.push(...d.markers);
      continue;
    }
    const ov = overrides[d.id] ?? {};
    if (ov.hidden) continue;
    const common = { id: d.id, source: "auto" as const, selected: d.id === selectedId };
    if (d.kind === "line") {
      shapes.push({
        ...common, kind: d.points.length > 2 ? "polyline" : "segment", points: d.points,
        color: ov.color ?? d.color, width: ov.width ?? d.width ?? 1, style: ov.style ?? d.style ?? "solid",
        label: d.showLabel ? d.label : undefined, axisLabel: !!d.showLabel, autoscale: d.autoscale,
      });
    } else if (d.kind === "priceLine") {
      shapes.push({
        ...common, kind: "hline", points: [{ time: 0, value: d.price }], color: ov.color ?? d.color,
        width: ov.width ?? d.width ?? 1, style: ov.style ?? d.style ?? "dashed", label: d.title, axisLabel: true,
      });
    } else if (d.kind === "fib") {
      shapes.push({
        ...common, kind: "fib", points: d.anchors, levels: d.levels, color: ov.color ?? d.color, width: ov.width ?? 1,
        style: ov.style ?? "dashed", label: d.label, extendRight: true, autoscale: d.autoscale,
      });
    }
  }
  return { shapes, markers };
}

/** Transforme un dessin automatique en dessin manuel (figé, modifiable). Les points sont en unité affichée. */
export function freezeAuto(d: Drawing, toRaw: (v: number) => number): Omit<ManualDrawing, "id" | "createdAt"> | null {
  const raw = (p: Pt): RawPt => ({ time: p.time, price: toRaw(p.value) });
  if (d.kind === "line" && d.points.length === 2) {
    const horizontal = d.points[0].value === d.points[1].value;
    if (horizontal) return { kind: "hray", points: [raw(d.points[0])], color: d.color, width: d.width ?? 1, style: d.style ?? "solid" };
    return { kind: "trend", points: d.points.map(raw), color: d.color, width: d.width ?? 2, style: d.style ?? "solid", extendRight: true };
  }
  if (d.kind === "priceLine") return { kind: "hline", points: [{ time: 0, price: toRaw(d.price) }], color: d.color, width: d.width ?? 1, style: d.style ?? "dashed" };
  if (d.kind === "fib") {
    return { kind: d.anchors.length >= 3 ? "fibE" : "fibR", points: d.anchors.map(raw), color: d.color, width: 1, style: "dashed", extendRight: true };
  }
  return null;
}
