import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  AutoscaleInfo,
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { Bar } from "../../shared/types.ts";
import type { Pt } from "./drawings.ts";

/**
 * Calque de dessin du graphique (primitive lightweight-charts).
 *
 * Il dessine toutes les figures (outils automatiques, dessins manuels, aperçu
 * pendant le tracé, zone d'analyse), suit le zoom et le défilement, et sait
 * dire quelle figure se trouve sous la souris (sélection, déplacement).
 * Toutes les valeurs sont exprimées dans l'unité affichée (prix ou %).
 */

export type ShapeKind = "segment" | "polyline" | "hline" | "rect" | "fib" | "measure" | "vzone";
export type LineStyleName = "solid" | "dashed" | "dotted";

export interface FibLevel {
  ratio: number;
  value: number;
  color: string;
}

export interface Shape {
  id: string;
  source: "auto" | "manual" | "preview" | "zone";
  kind: ShapeKind;
  points: Pt[];
  color: string;
  width?: number;
  style?: LineStyleName;
  /** segment : prolonger vers la droite / la gauche ; hline : false = démarre au point. */
  extendRight?: boolean;
  extendLeft?: boolean;
  /** Texte écrit près de l'extrémité droite. */
  label?: string;
  /** Étiquette de valeur sur l'axe des prix. */
  axisLabel?: boolean;
  fill?: string;
  /** Inclure la figure dans le cadrage vertical automatique. */
  autoscale?: boolean;
  /** fib : niveaux calculés (valeurs affichées). */
  levels?: FibLevel[];
  /** measure : lignes de texte de l'étiquette. */
  text?: string[];
  selected?: boolean;
  /** Peut être déplacée / modifiée à la souris. */
  editable?: boolean;
}

export interface Pick {
  id: string;
  /** Index du point d'ancrage saisi, ou -1 pour la figure entière. */
  handle: number;
}

const DASH: Record<LineStyleName, number[]> = { solid: [], dashed: [6, 4], dotted: [2, 3] };
const TOL = 6;
const HANDLE = 7;

interface XY {
  x: number;
  y: number;
}

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Prolonge le segment AB jusqu'au bord gauche et/ou droit de la zone. */
function extend(a: XY, b: XY, width: number, left: boolean, right: boolean): [XY, XY] {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-6) return [a, b];
  const slope = (b.y - a.y) / dx;
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  const nl = left ? { x: 0, y: l.y - slope * l.x } : l;
  const nr = right ? { x: width, y: r.y + slope * (width - r.x) } : r;
  return [nl, nr];
}

function upperBound(arr: number[], v: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  return color;
}

export class DrawLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private shapes: Shape[] = [];
  private preview: Shape[] = [];
  private overrides = new Map<string, Pt[]>();
  private bars: Bar[] = [];
  private times: number[] = [];
  private barSeconds = 86400;
  private fmt: (v: number) => string = (v) => v.toFixed(2);
  private axisViews: ISeriesPrimitiveAxisView[] = [];
  private autoscaleCache: AutoscaleInfo | null = null;
  private readonly views: IPrimitivePaneView[];

  constructor() {
    const self = this;
    const renderer: IPrimitivePaneRenderer = {
      draw(target: CanvasRenderingTarget2D) {
        self.draw(target);
      },
    };
    this.views = [{ zOrder: () => "top", renderer: () => renderer }];
  }

  // ------------------------------------------------------------------ cycle de vie
  attached(p: SeriesAttachedParameter<Time, SeriesType>) {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }
  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }
  paneViews() {
    return this.views;
  }
  priceAxisViews() {
    return this.axisViews;
  }
  autoscaleInfo(): AutoscaleInfo | null {
    return this.autoscaleCache;
  }

  // ------------------------------------------------------------------ données
  setContext(bars: Bar[], barSeconds: number, fmt: (v: number) => string) {
    this.bars = bars;
    this.times = bars.map((b) => b.time);
    this.barSeconds = barSeconds;
    this.fmt = fmt;
    this.refresh();
  }

  setShapes(shapes: Shape[]) {
    this.shapes = shapes;
    let min = Infinity, max = -Infinity;
    for (const s of shapes) {
      if (!s.autoscale) continue;
      for (const p of s.points) { min = Math.min(min, p.value); max = Math.max(max, p.value); }
      // Fibonacci : cadrage sur 0–100 % (retracement) ou 0–161,8 % (extension) ; les objectifs lointains restent hors cadre
      const maxRatio = s.points.length >= 3 ? 1.618 : 1;
      for (const l of s.levels ?? []) if (l.ratio <= maxRatio) { min = Math.min(min, l.value); max = Math.max(max, l.value); }
    }
    this.autoscaleCache = Number.isFinite(min) ? { priceRange: { minValue: min, maxValue: max } } : null;
    this.axisViews = shapes.filter((s) => s.axisLabel && s.points.length).map((s) => this.axisView(s));
    this.refresh();
  }

  setPreview(shapes: Shape[]) {
    this.preview = shapes;
    this.refresh();
  }

  /** Points provisoires pendant un glisser-déposer (sans repasser par React). */
  setOverride(id: string, points: Pt[] | null) {
    if (points) this.overrides.set(id, points);
    else this.overrides.delete(id);
    this.refresh();
  }

  private refresh() {
    this.requestUpdate?.();
  }

  private pointsOf(s: Shape): Pt[] {
    return this.overrides.get(s.id) ?? s.points;
  }

  private axisView(s: Shape): ISeriesPrimitiveAxisView {
    return {
      coordinate: () => {
        const pts = this.pointsOf(s);
        return this.yOf(pts[pts.length - 1].value) ?? -100;
      },
      text: () => {
        const pts = this.pointsOf(s);
        return this.fmt(pts[pts.length - 1].value);
      },
      textColor: () => "#ffffff",
      backColor: () => s.color,
      visible: () => this.yOf(this.pointsOf(s)[0]?.value ?? NaN) != null,
    };
  }

  // ------------------------------------------------------------------ conversions
  /** Abscisse d'une date (interpolée entre deux bougies, extrapolée hors des données). */
  xOf(time: number): number | null {
    if (!this.chart) return null;
    const ts = this.chart.timeScale();
    const direct = ts.timeToCoordinate(time as Time);
    if (direct !== null) return direct;
    const tms = this.times;
    if (!tms.length) return null;
    const i = upperBound(tms, time) - 1;
    if (i >= 0 && i < tms.length - 1) {
      const x0 = ts.timeToCoordinate(tms[i] as Time);
      const x1 = ts.timeToCoordinate(tms[i + 1] as Time);
      if (x0 == null || x1 == null) return null;
      return x0 + ((x1 - x0) * (time - tms[i])) / (tms[i + 1] - tms[i]);
    }
    const ref = i < 0 ? tms[0] : tms[tms.length - 1];
    const xr = ts.timeToCoordinate(ref as Time);
    if (xr == null) return null;
    const lr = ts.coordinateToLogical(xr);
    if (lr == null) return null;
    const next = ts.logicalToCoordinate((lr + 1) as Logical);
    const spacing = next != null ? next - xr : 6;
    return xr + ((time - ref) / this.barSeconds) * spacing;
  }

  yOf(value: number): number | null {
    if (!this.series || !Number.isFinite(value)) return null;
    return this.series.priceToCoordinate(value);
  }

  /** Point (date, valeur) sous la souris, éventuellement aimanté sur l'OHLC de la bougie. */
  toData(x: number, y: number, magnet: boolean): Pt | null {
    if (!this.chart || !this.series) return null;
    const ts = this.chart.timeScale();
    let time: number | null = null;
    const ct = ts.coordinateToTime(x);
    const tms = this.times;
    if (ct != null) time = ct as number;
    else if (tms.length) {
      const logical = ts.coordinateToLogical(x);
      const lastX = ts.timeToCoordinate(tms[tms.length - 1] as Time);
      const lastL = lastX != null ? ts.coordinateToLogical(lastX) : null;
      if (logical != null && lastL != null) {
        const steps = Math.round(logical - lastL);
        time = tms[tms.length - 1] + steps * this.barSeconds;
        if (steps < 0) time = tms[0] + Math.round(logical) * this.barSeconds;
      }
    }
    let value = this.series.coordinateToPrice(y);
    if (time == null || value == null) return null;
    if (magnet && tms.length) {
      const i = Math.max(0, Math.min(tms.length - 1, upperBound(tms, time) - 1));
      const bar = this.bars[i];
      if (bar && Math.abs(bar.time - time) < this.barSeconds) {
        let best = value as number, bestD = Infinity;
        for (const v of [bar.open, bar.high, bar.low, bar.close]) {
          const yy = this.yOf(v);
          if (yy != null && Math.abs(yy - y) < bestD) { bestD = Math.abs(yy - y); best = v; }
        }
        value = best as typeof value;
        time = bar.time;
      }
    }
    return { time, value: value as number };
  }

  private xy(p: Pt): XY | null {
    const x = this.xOf(p.time);
    const y = this.yOf(p.value);
    return x == null || y == null ? null : { x, y };
  }

  private paneWidth(): number {
    if (!this.chart) return 0;
    const el = this.chart.chartElement();
    const left = this.chart.priceScale("left").width();
    const right = this.chart.priceScale("right").width();
    return el.clientWidth - left - right;
  }

  // ------------------------------------------------------------------ sélection
  pick(x: number, y: number): Pick | null {
    const width = this.paneWidth();
    const all = [...this.shapes].sort((a, b) => Number(!!a.selected) - Number(!!b.selected) || Number(a.source === "manual") - Number(b.source === "manual"));
    for (let k = all.length - 1; k >= 0; k--) {
      const s = all[k];
      const pts = this.pointsOf(s).map((p) => this.xy(p));
      if (s.editable) {
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (p && Math.hypot(p.x - x, p.y - y) <= HANDLE) return { id: s.id, handle: i };
        }
      }
      if (this.hits(s, pts, { x, y }, width)) return { id: s.id, handle: -1 };
    }
    return null;
  }

  private hits(s: Shape, pts: (XY | null)[], p: XY, width: number): boolean {
    const ok = pts.filter((q): q is XY => q !== null);
    switch (s.kind) {
      case "segment": {
        if (ok.length < 2) return false;
        const [a, b] = extend(ok[0], ok[1], width, !!s.extendLeft, !!s.extendRight);
        return distToSegment(p, a, b) <= TOL;
      }
      case "polyline":
        for (let i = 1; i < ok.length; i++) if (distToSegment(p, ok[i - 1], ok[i]) <= TOL) return true;
        return false;
      case "hline": {
        const y = this.yOf(this.pointsOf(s)[0].value);
        if (y == null || Math.abs(p.y - y) > TOL) return false;
        const x0 = s.extendLeft === false && ok[0] ? ok[0].x : 0;
        return p.x >= x0 - TOL;
      }
      case "rect":
      case "measure": {
        if (ok.length < 2) return false;
        const [a, b] = ok;
        return p.x >= Math.min(a.x, b.x) - TOL && p.x <= Math.max(a.x, b.x) + TOL && p.y >= Math.min(a.y, b.y) - TOL && p.y <= Math.max(a.y, b.y) + TOL;
      }
      case "fib": {
        const span = this.fibSpan(s, ok, width);
        if (!span) return false;
        if (p.x < span[0] - TOL || p.x > span[1] + TOL) return false;
        for (const l of s.levels ?? []) {
          const y = this.yOf(l.value);
          if (y != null && Math.abs(p.y - y) <= TOL) return true;
        }
        for (let i = 1; i < ok.length; i++) if (distToSegment(p, ok[i - 1], ok[i]) <= TOL) return true;
        return false;
      }
      case "vzone": {
        const xs = this.pointsOf(s).map((q) => this.xOf(q.time));
        if (xs[0] == null || xs[1] == null) return false;
        const h = this.chart?.panes()[0]?.getHeight() ?? 0;
        return p.y >= h - 26 && p.y <= h - 4 && p.x >= Math.min(xs[0], xs[1]) && p.x <= Math.min(Math.max(xs[0], xs[1]), Math.min(xs[0], xs[1]) + 140);
      }
    }
  }

  /** Étendue horizontale des niveaux d'un Fibonacci. */
  private fibSpan(s: Shape, ok: XY[], width: number): [number, number] | null {
    if (!ok.length) return null;
    if (ok.length >= 3) {
      // extension : les niveaux partent de C
      const c = ok[2];
      const w = Math.max(60, Math.abs(ok[1].x - ok[0].x));
      return [c.x, s.extendRight ? width : c.x + w];
    }
    const x0 = Math.min(...ok.map((q) => q.x));
    const x1 = Math.max(...ok.map((q) => q.x));
    return [x0, s.extendRight ? width : Math.max(x1, x0 + 40)];
  }

  // ------------------------------------------------------------------ rendu
  private draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const width = mediaSize.width;
      ctx.save();
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      for (const s of this.shapes) this.drawShape(ctx, s, width, mediaSize.height, 1);
      for (const s of this.preview) this.drawShape(ctx, s, width, mediaSize.height, 0.6);
      ctx.restore();
    });
  }

  private stroke(ctx: CanvasRenderingContext2D, s: Shape) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = (s.width ?? 1) + (s.selected ? 1 : 0);
    ctx.setLineDash(DASH[s.style ?? "solid"]);
  }

  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: "left" | "right" = "right") {
    const w = ctx.measureText(text).width;
    const bx = align === "right" ? x - w - 6 : x + 4;
    ctx.fillStyle = "rgba(11,15,23,0.75)";
    ctx.fillRect(bx - 3, y - 8, w + 6, 15);
    ctx.fillStyle = color;
    ctx.fillText(text, bx, y);
  }

  private handles(ctx: CanvasRenderingContext2D, pts: XY[], color: string) {
    ctx.setLineDash([]);
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#0b0f17";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }

  private drawShape(ctx: CanvasRenderingContext2D, s: Shape, width: number, height: number, alpha: number) {
    const pts = this.pointsOf(s).map((p) => this.xy(p));
    const ok = pts.filter((q): q is XY => q !== null);
    ctx.globalAlpha = alpha;
    switch (s.kind) {
      case "segment": {
        if (ok.length < 2) break;
        const [a, b] = extend(ok[0], ok[1], width, !!s.extendLeft, !!s.extendRight);
        this.stroke(ctx, s);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (s.label) {
          const end = a.x > b.x ? a : b;
          this.label(ctx, s.label, Math.min(end.x, width - 4), end.y - 10, s.color);
        }
        if ((s.selected && s.editable) || s.source === "preview") this.handles(ctx, ok, s.color);
        break;
      }
      case "polyline": {
        if (ok.length < 2) break;
        this.stroke(ctx, s);
        ctx.beginPath();
        ok.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        if (s.label) {
          const end = ok[ok.length - 1];
          this.label(ctx, s.label, Math.min(end.x, width - 4), end.y - 10, s.color);
        }
        break;
      }
      case "hline": {
        const y = this.yOf(this.pointsOf(s)[0]?.value);
        if (y == null) break;
        const x0 = s.extendLeft === false && ok[0] ? ok[0].x : 0;
        this.stroke(ctx, s);
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        if (s.label) this.label(ctx, s.label, width - 4, y - 9, s.color);
        if (((s.selected && s.editable) || s.source === "preview") && ok[0]) this.handles(ctx, [ok[0]], s.color);
        break;
      }
      case "rect": {
        if (ok.length < 2) break;
        const [a, b] = ok;
        ctx.fillStyle = s.fill ?? withAlpha(s.color, 0.12);
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        this.stroke(ctx, s);
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        if (s.label) this.label(ctx, s.label, Math.min(a.x, b.x), Math.min(a.y, b.y) - 9, s.color, "left");
        if ((s.selected && s.editable) || s.source === "preview") this.handles(ctx, ok, s.color);
        break;
      }
      case "measure": {
        if (ok.length < 2) break;
        const [a, b] = ok;
        const up = (this.pointsOf(s)[1]?.value ?? 0) >= (this.pointsOf(s)[0]?.value ?? 0);
        const col = up ? "#22c55e" : "#f43f5e";
        ctx.fillStyle = withAlpha(col, 0.13);
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // flèche
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - 9 * Math.cos(ang - 0.4), b.y - 9 * Math.sin(ang - 0.4));
        ctx.lineTo(b.x - 9 * Math.cos(ang + 0.4), b.y - 9 * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        const lines = s.text ?? [];
        if (lines.length) {
          ctx.font = "600 11.5px Inter, system-ui, sans-serif";
          const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14;
          const h = lines.length * 15 + 8;
          const cx = (a.x + b.x) / 2;
          let by = up ? Math.min(a.y, b.y) - h - 6 : Math.max(a.y, b.y) + 6;
          if (by < 2) by = Math.max(a.y, b.y) + 6;
          if (by + h > height - 2) by = Math.min(a.y, b.y) - h - 6;
          const bx = Math.max(2, Math.min(width - w - 2, cx - w / 2));
          ctx.fillStyle = col;
          ctx.fillRect(bx, by, w, h);
          ctx.fillStyle = "#ffffff";
          lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 11 + i * 15));
          ctx.font = "11px Inter, system-ui, sans-serif";
        }
        if (s.selected && s.editable) this.handles(ctx, ok, col);
        break;
      }
      case "fib": {
        const span = this.fibSpan(s, ok, width);
        if (!span) break;
        const levels = [...(s.levels ?? [])].sort((p, q) => p.value - q.value);
        // bandes colorées entre niveaux
        for (let i = 1; i < levels.length; i++) {
          const y0 = this.yOf(levels[i - 1].value), y1 = this.yOf(levels[i].value);
          if (y0 == null || y1 == null) continue;
          ctx.fillStyle = withAlpha(levels[i].color, 0.06);
          ctx.fillRect(span[0], Math.min(y0, y1), span[1] - span[0], Math.abs(y1 - y0));
        }
        for (const l of levels) {
          const y = this.yOf(l.value);
          if (y == null) continue;
          ctx.strokeStyle = l.color;
          ctx.lineWidth = (s.width ?? 1) + (s.selected ? 1 : 0);
          ctx.setLineDash(l.ratio === 0 || l.ratio === 1 ? [] : DASH[s.style ?? "dashed"]);
          ctx.beginPath();
          ctx.moveTo(span[0], y);
          ctx.lineTo(span[1], y);
          ctx.stroke();
          const pct = `${(l.ratio * 100).toFixed(1).replace(/\.0$/, "")} %`;
          this.label(ctx, `${pct}  ${this.fmt(l.value)}`, span[0], y - 8, l.color, "left");
        }
        // jambes A-B(-C)
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ok.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        if ((s.selected && s.editable) || s.source === "preview") this.handles(ctx, ok, s.color);
        break;
      }
      case "vzone": {
        const xs = this.pointsOf(s).map((q) => this.xOf(q.time));
        if (xs[0] == null || xs[1] == null) break;
        const x0 = Math.min(xs[0], xs[1]), x1 = Math.max(xs[0], xs[1]);
        ctx.fillStyle = withAlpha(s.color, 0.08);
        ctx.fillRect(x0, 0, x1 - x0, height);
        ctx.strokeStyle = withAlpha(s.color, 0.7);
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x0, 0);
        ctx.lineTo(x0, height);
        ctx.moveTo(x1, 0);
        ctx.lineTo(x1, height);
        ctx.stroke();
        if (s.label) {
          ctx.setLineDash([]);
          const w = ctx.measureText(s.label).width + 12;
          ctx.fillStyle = s.selected ? s.color : withAlpha(s.color, 0.85);
          ctx.fillRect(x0 + 2, height - 24, w, 17);
          ctx.fillStyle = "#fff";
          ctx.fillText(s.label, x0 + 8, height - 15);
        }
        break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }
}
