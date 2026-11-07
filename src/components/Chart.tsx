import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  LineSeries,
  LineStyle,
  type Logical,
  type MouseEventParams,
  PriceScaleMode,
  type SeriesMarker,
  type SeriesType,
  type Time,
  TickMarkType,
  type UTCTimestamp,
} from "lightweight-charts";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Bar } from "../../shared/types.ts";
import type { Marker, Pt } from "../lib/drawings.ts";
import { DrawLayer, type Shape } from "../lib/drawLayer.ts";
import { fmtPct } from "../lib/format.ts";
import { bollinger, ema, macd, type Num, rsi, sma } from "../lib/indicators.ts";
import { DEFAULT_STYLE, DRAW_TOOL_INFO, type DrawTool, manualShape, TOOL_POINTS } from "../lib/manual.ts";
import { INDICATOR_INFO, type ChartSettings } from "../lib/state.ts";
import { closeAtOrBefore } from "../lib/stats.ts";

export interface SeriesInput {
  key: string;
  label: string;
  color: string;
  /** Données d'origine (prix réels). */
  raw: Bar[];
  /** Données affichées (identiques ou transformées en %). */
  display: Bar[];
  fmtRaw: (v: number) => string;
}

export type PlaceTool = Exclude<DrawTool, "cursor">;

interface Props {
  main: SeriesInput | null;
  overlays: SeriesInput[];
  settings: ChartSettings;
  /** Toutes les figures à dessiner (outils automatiques, dessins manuels, zone), en unité affichée. */
  shapes: Shape[];
  markers: Marker[];
  /** Dates futures à réserver sur l'axe du temps (projection). */
  futureTimes: number[];
  /** Derniers prix temps réel (bruts) par clé d'actif. */
  live: Record<string, number | undefined>;
  drawTool: DrawTool;
  magnet: boolean;
  onPlace: (tool: PlaceTool, points: Pt[]) => void;
  /** Clic sur une figure (null = clic dans le vide). Position relative au graphique. */
  onShapeClick: (id: string | null, pos: { x: number; y: number } | null) => void;
  onShapeMove: (id: string, points: Pt[]) => void;
  onRemoveOverlay: (key: string) => void;
  onMakeMain: (key: string) => void;
  /** Changement de période : on recadre tout. */
  fitKey: string;
  /** Changement d'actif : on garde le zoom, recollé à la dernière bougie. */
  assetKey: string;
  /** Changement d'unité (actif, relatif/absolu) : échelle verticale automatique. */
  unitKey: string;
  /** Incrémenté par le bouton « Recentrer ». */
  resetNonce: number;
  barSeconds: number;
  watermark: string;
  valueFmt: (v: number) => string;
  children?: ReactNode;
}

const UP = "#089981";
const DOWN = "#f23645";

const t = (x: number) => x as UTCTimestamp;

function indicatorData(bars: Bar[], values: Num[]) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  values.forEach((v, i) => {
    if (v != null && Number.isFinite(v)) out.push({ time: t(bars[i].time), value: v });
  });
  return out;
}

function pctFormat() {
  return { type: "custom" as const, formatter: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} %`, minMove: 0.01 };
}

function customFormat(fmt: (v: number) => string) {
  return { type: "custom" as const, formatter: fmt, minMove: 0.0001 };
}

interface LegendRow {
  key: string;
  label: string;
  color: string;
  value: string;
  change: number | null;
  ohlc?: string;
  isMain: boolean;
}

interface ViewState {
  fitKey: string;
  assetKey: string;
  unitKey: string;
  resetNonce: number;
  lastTime: number;
}

export function Chart(props: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeries = useRef<ISeriesApi<SeriesType> | null>(null);
  const overlaySeries = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
  const allSeries = useRef<ISeriesApi<SeriesType>[]>([]);
  const view = useRef<ViewState | null>(null);
  const watermarkRef = useRef<{ detach: () => void } | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const layer = useRef(new DrawLayer());
  const propsRef = useRef(props);
  propsRef.current = props;
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [placing, setPlacing] = useState(0);

  // --- création du graphique (une fois)
  useEffect(() => {
    if (!box.current) return;
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { color: "#0b0f17" }, textColor: "#b2b5be", fontFamily: "Inter, system-ui, sans-serif", fontSize: 12, panes: { separatorColor: "#1f2633", separatorHoverColor: "#2962ff55" } },
      grid: { vertLines: { color: "#151b26" }, horzLines: { color: "#151b26" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2633", scaleMargins: { top: 0.08, bottom: 0.08 } },
      leftPriceScale: { borderColor: "#1f2633", visible: false },
      timeScale: { borderColor: "#1f2633", rightOffset: 8, timeVisible: false, shiftVisibleRangeOnNewBar: true },
      localization: { locale: "fr-FR" },
    });
    chartRef.current = chart;
    let raf = 0;
    const onMove = (param: MouseEventParams<Time>) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setHoverTime(param.time != null ? (param.time as number) : null));
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      cancelAnimationFrame(raf);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // --- construction des séries (données, réglages, indicateurs)
  const { main, overlays, settings, futureTimes, fitKey, assetKey, unitKey, resetNonce, barSeconds, watermark, valueFmt } = props;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale();

    // 1) mémorise la vue actuelle (position, zoom, échelle verticale) avant de reconstruire
    const prev = view.current;
    const logicalOf = (time: number): number | null => {
      const x = ts.timeToCoordinate(time as Time);
      return x == null ? null : ts.coordinateToLogical(x);
    };
    const prevLogical = ts.getVisibleLogicalRange();
    const prevTimeRange = ts.getVisibleRange();
    const prevLastLogical = prev ? logicalOf(prev.lastTime) : null;
    const rightScale = chart.priceScale("right");
    const prevAuto = rightScale.options().autoScale;
    const prevPrice = rightScale.getVisibleRange();

    for (const s of allSeries.current) chart.removeSeries(s);
    allSeries.current = [];
    overlaySeries.current.clear();
    mainSeries.current = null;
    markersRef.current = null;
    for (let i = chart.panes().length - 1; i > 0; i--) {
      try { chart.removePane(i); } catch { /* déjà supprimé */ }
    }
    if (!main || !main.display.length) return;

    const relative = settings.mode === "relative";
    const intraday = barSeconds < 86400;
    chart.applyOptions({
      timeScale: {
        timeVisible: intraday,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const d = new Date((time as number) * 1000);
          const tz = intraday ? undefined : "UTC";
          if (type === TickMarkType.Year) return d.toLocaleDateString("fr-FR", { year: "numeric", timeZone: tz });
          if (type === TickMarkType.Month) return d.toLocaleDateString("fr-FR", { month: "short", timeZone: tz });
          if (type === TickMarkType.DayOfMonth) return d.toLocaleDateString("fr-FR", { day: "numeric", month: intraday ? "short" : undefined, timeZone: tz });
          return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        },
      },
      localization: {
        locale: "fr-FR",
        timeFormatter: (time: Time) => {
          const d = new Date((time as number) * 1000);
          return intraday
            ? d.toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
            : d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });
        },
      },
    });

    const mainFormat = relative ? pctFormat() : customFormat(main.fmtRaw);
    const add = <T extends SeriesType>(s: ISeriesApi<T>) => {
      allSeries.current.push(s as unknown as ISeriesApi<SeriesType>);
      return s;
    };

    // série principale
    const bars = main.display;
    let ms: ISeriesApi<SeriesType>;
    if (settings.chartType === "candles") {
      ms = add(chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false, priceFormat: mainFormat, title: main.label }));
      ms.setData(bars.map((b) => ({ time: t(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    } else if (settings.chartType === "area") {
      ms = add(chart.addSeries(AreaSeries, { lineColor: main.color, topColor: `${main.color}55`, bottomColor: `${main.color}05`, lineWidth: 2, priceFormat: mainFormat, title: main.label }));
      ms.setData(bars.map((b) => ({ time: t(b.time), value: b.close })));
    } else {
      ms = add(chart.addSeries(LineSeries, { color: main.color, lineWidth: 2, priceFormat: mainFormat, title: main.label }));
      ms.setData(bars.map((b) => ({ time: t(b.time), value: b.close })));
    }
    mainSeries.current = ms;
    rightScale.applyOptions({ mode: settings.logScale && !relative ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
    if (relative) ms.createPriceLine({ price: 0, color: "#5d606b", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });

    // calque de dessin + repères
    layer.current.setContext(bars, barSeconds, valueFmt);
    ms.attachPrimitive(layer.current);
    markersRef.current = createSeriesMarkers(ms, []);

    // dates futures réservées (projection) : série « vide »
    if (futureTimes.length) {
      const last = bars[bars.length - 1].time;
      const ws = add(chart.addSeries(LineSeries, { lineVisible: false, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }));
      ws.setData(futureTimes.filter((x) => x > last).map((x) => ({ time: t(x) })));
    }

    // superpositions
    let leftUsed = false;
    overlays.forEach((o) => {
      if (!o.display.length) return;
      let scaleId = "right";
      if (!relative && !settings.sharedScale) {
        if (!leftUsed) { scaleId = "left"; leftUsed = true; } else scaleId = `ov-${o.key}`;
      }
      const s = add(chart.addSeries(LineSeries, {
        color: o.color, lineWidth: 2, priceScaleId: scaleId, title: o.label,
        priceFormat: relative ? pctFormat() : customFormat(o.fmtRaw), priceLineVisible: false,
      }));
      s.setData(o.display.map((b) => ({ time: t(b.time), value: b.close })));
      if (scaleId.startsWith("ov-")) chart.priceScale(scaleId).applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
      overlaySeries.current.set(o.key, s);
    });
    chart.priceScale("left").applyOptions({ visible: leftUsed, mode: settings.logScale && !relative ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });

    // indicateurs
    const closes = bars.map((b) => b.close);
    const lineOpts = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: mainFormat };
    const ind = new Set(settings.indicators);
    if (ind.has("volume") && main.raw.some((b) => (b.volume ?? 0) > 0)) {
      const v = add(chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }));
      v.setData(main.raw.map((b) => ({ time: t(b.time), value: b.volume ?? 0, color: b.close >= b.open ? "rgba(8,153,129,0.35)" : "rgba(242,54,69,0.35)" })));
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }
    for (const [id, n] of [["sma20", 20], ["sma50", 50], ["sma200", 200]] as const) {
      if (ind.has(id)) add(chart.addSeries(LineSeries, { ...lineOpts, color: INDICATOR_INFO[id].color, lineWidth: 2 })).setData(indicatorData(bars, sma(closes, n)));
    }
    if (ind.has("ema21")) add(chart.addSeries(LineSeries, { ...lineOpts, color: INDICATOR_INFO.ema21.color })).setData(indicatorData(bars, ema(closes, 21)));
    if (ind.has("bollinger")) {
      const bb = bollinger(closes);
      const c = INDICATOR_INFO.bollinger.color;
      add(chart.addSeries(LineSeries, { ...lineOpts, color: c })).setData(indicatorData(bars, bb.upper));
      add(chart.addSeries(LineSeries, { ...lineOpts, color: `${c}99`, lineStyle: LineStyle.Dashed })).setData(indicatorData(bars, bb.mid));
      add(chart.addSeries(LineSeries, { ...lineOpts, color: c })).setData(indicatorData(bars, bb.lower));
    }
    let pane = 0;
    if (ind.has("rsi")) {
      pane++;
      const r = add(chart.addSeries(LineSeries, { color: INDICATOR_INFO.rsi.color, lineWidth: 1, priceLineVisible: false, title: "RSI 14", autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) }, pane));
      r.setData(indicatorData(bars, rsi(closes, 14)));
      r.createPriceLine({ price: 70, color: "#f2364588", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      r.createPriceLine({ price: 30, color: "#08998188", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
    }
    if (ind.has("macd")) {
      pane++;
      const m = macd(closes);
      const ref = Math.abs(closes[closes.length - 1] ?? 1);
      const precision = relative || ref >= 10 ? 2 : 4;
      const fmt = { type: "price" as const, precision, minMove: 10 ** -precision };
      const h = add(chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: fmt }, pane));
      h.setData(m.hist.map((v, i) => (v == null ? null : { time: t(bars[i].time), value: v, color: v >= 0 ? "rgba(8,153,129,0.6)" : "rgba(242,54,69,0.6)" })).filter((x): x is NonNullable<typeof x> => x !== null));
      add(chart.addSeries(LineSeries, { color: "#2962ff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "MACD", priceFormat: fmt }, pane)).setData(indicatorData(bars, m.line));
      add(chart.addSeries(LineSeries, { color: "#ff9800", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "Signal", priceFormat: fmt }, pane)).setData(indicatorData(bars, m.signal));
    }
    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);

    watermarkRef.current?.detach();
    watermarkRef.current = createTextWatermark(chart.panes()[0], {
      horzAlign: "center", vertAlign: "center",
      lines: [{ text: watermark, color: "rgba(178,181,190,0.06)", fontSize: 56, fontStyle: "bold" }],
    });

    // 2) restaure la vue : seul l'utilisateur déplace le graphique
    const lastTime = bars[bars.length - 1].time;
    const newLast = logicalOf(lastTime);
    const fit = !prev || prev.fitKey !== fitKey || prev.resetNonce !== resetNonce;
    if (fit) {
      ts.fitContent();
    } else if (prevLogical && prevLastLogical != null && newLast != null) {
      const width = prevLogical.to - prevLogical.from;
      const anchoredRight = prevLogical.to >= prevLastLogical - 0.5;
      if (anchoredRight || prev.assetKey !== assetKey) {
        // vue collée à la dernière bougie : même zoom, même marge à droite
        const gap = prevLogical.to - prevLastLogical;
        ts.setVisibleLogicalRange({ from: (newLast + gap - width) as Logical, to: (newLast + gap) as Logical });
      } else if (prevTimeRange) {
        // vue dans l'historique : mêmes dates
        try { ts.setVisibleRange(prevTimeRange); } catch { ts.setVisibleLogicalRange(prevLogical); }
      }
    }
    const unitChanged = !prev || prev.unitKey !== unitKey;
    if (fit || unitChanged || prevAuto || !prevPrice) {
      rightScale.setAutoScale(true);
    } else {
      rightScale.setAutoScale(false);
      rightScale.setVisibleRange(prevPrice);
    }
    view.current = { fitKey, assetKey, unitKey, resetNonce, lastTime };
  }, [main, overlays, settings, futureTimes, fitKey, assetKey, unitKey, resetNonce, barSeconds, watermark, valueFmt]);

  // --- figures et repères : mis à jour sans reconstruire les séries (la vue ne bouge pas)
  const { shapes, markers } = props;
  useEffect(() => {
    layer.current.setShapes(shapes);
  }, [shapes, main, settings]);

  useEffect(() => {
    const plugin = markersRef.current;
    const bars = main?.display;
    if (!plugin || !bars?.length) return;
    const barTimes = new Set(bars.map((b) => b.time));
    plugin.setMarkers(
      markers
        .map((m) => ({ ...m, time: barTimes.has(m.time) ? m.time : closeAtOrBefore(bars, m.time)?.time ?? m.time }))
        .sort((a, b) => a.time - b.time)
        .map((m) => ({ ...m, time: t(m.time) }) as SeriesMarker<Time>),
    );
  }, [markers, main, settings]);

  // --- interactions : tracé, sélection, déplacement des dessins
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const pts: Pt[] = [];
    let drag: { id: string; handle: number; start: Pt; orig: Pt[]; moved: boolean; sx: number; sy: number; next: Pt[] | null } | null = null;
    let swallowClick = false;
    let hoverRaf = 0;

    const local = (clientX: number, clientY: number) => {
      const chart = chartRef.current;
      const canvas = box.current;
      if (!chart || !canvas) return null;
      const r = canvas.getBoundingClientRect();
      const left = chart.priceScale("left").width();
      const right = chart.priceScale("right").width();
      const x = clientX - r.left - left;
      const y = clientY - r.top;
      const paneH = chart.panes()[0]?.getHeight() ?? r.height;
      const inPane = x >= 0 && x <= r.width - left - right && y >= 0 && y <= paneH;
      return { x, y, inPane, rel: { x: clientX - (wrap.current?.getBoundingClientRect().left ?? 0), y: clientY - (wrap.current?.getBoundingClientRect().top ?? 0) } };
    };

    const preview = (mouse: Pt | null) => {
      const p = propsRef.current;
      const tool = p.drawTool;
      if (tool === "cursor") { layer.current.setPreview([]); return; }
      const all = mouse ? [...pts, mouse] : [...pts];
      if (!all.length || (tool === "rebase")) { layer.current.setPreview([]); return; }
      const kind = tool === "zone" ? "zone" : tool;
      const st = tool === "zone" ? { color: "#2962ff", width: 1, style: "dashed" as const } : DEFAULT_STYLE[tool];
      const shape = manualShape(
        { id: "__preview", kind, points: all, color: st.color, width: st.width, style: st.style, extendRight: "extendRight" in st ? st.extendRight : undefined },
        { relative: p.settings.mode === "relative", fmt: p.valueFmt, barSeconds: p.barSeconds, source: "preview" },
      );
      layer.current.setPreview([shape]);
    };

    const down = (clientX: number, clientY: number, e: Event) => {
      // clics dans les éléments posés sur le graphique (menu, légende) : on les laisse passer
      if (e.target instanceof Element && e.target.closest(".draw-menu, .legend, .chart-hint")) return;
      const p = propsRef.current;
      const pos = local(clientX, clientY);
      if (!pos || !pos.inPane || !mainSeries.current) return;
      // outil de dessin actif : chaque clic pose un point
      if (p.drawTool !== "cursor") {
        e.stopPropagation();
        e.preventDefault();
        const pt = layer.current.toData(pos.x, pos.y, p.magnet);
        if (!pt) return;
        pts.push(pt);
        if (pts.length >= TOOL_POINTS[p.drawTool]) {
          const done = pts.splice(0);
          layer.current.setPreview([]);
          setPlacing(0);
          p.onPlace(p.drawTool, done);
        } else {
          setPlacing(pts.length);
          preview(pt);
        }
        return;
      }
      // curseur : sélection / déplacement d'une figure
      const hit = layer.current.pick(pos.x, pos.y);
      if (!hit) {
        p.onShapeClick(null, null);
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      const shape = p.shapes.find((s) => s.id === hit.id);
      const start = layer.current.toData(pos.x, pos.y, false);
      if (!shape || !start) return;
      drag = { id: hit.id, handle: shape.editable ? hit.handle : -2, start, orig: shape.points, moved: false, sx: clientX, sy: clientY, next: null };
      chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
    };

    const move = (clientX: number, clientY: number) => {
      const p = propsRef.current;
      const pos = local(clientX, clientY);
      if (drag) {
        if (!pos) return;
        if (Math.hypot(clientX - drag.sx, clientY - drag.sy) > 3) drag.moved = true;
        if (!drag.moved || drag.handle === -2) return;
        const cur = layer.current.toData(pos.x, pos.y, p.magnet && drag.handle >= 0);
        if (!cur) return;
        const dt = cur.time - drag.start.time;
        const dv = cur.value - drag.start.value;
        const next = drag.handle >= 0
          ? drag.orig.map((q, i) => (i === drag!.handle ? cur : q))
          : drag.orig.map((q) => ({ time: q.time + dt, value: q.value + dv }));
        drag.next = next;
        layer.current.setOverride(drag.id, next);
        return;
      }
      if (!pos) return;
      if (p.drawTool !== "cursor") {
        preview(pos.inPane ? layer.current.toData(pos.x, pos.y, p.magnet) : null);
        return;
      }
      // survol : curseur « main » au-dessus d'une figure
      cancelAnimationFrame(hoverRaf);
      hoverRaf = requestAnimationFrame(() => {
        const hit = pos.inPane ? layer.current.pick(pos.x, pos.y) : null;
        const editable = hit && p.shapes.find((s) => s.id === hit.id)?.editable;
        el.style.cursor = hit ? (hit.handle >= 0 && editable ? "grab" : editable ? "move" : "pointer") : "";
      });
    };

    const up = (clientX: number, clientY: number) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
      const p = propsRef.current;
      if (d.moved && d.next && d.handle !== -2) {
        swallowClick = true;
        p.onShapeMove(d.id, d.next);
        // l'override est retiré quand les nouvelles figures arrivent (voir effet ci-dessous)
      } else {
        layer.current.setOverride(d.id, null);
        const pos = local(clientX, clientY);
        p.onShapeClick(d.id, pos ? pos.rel : null);
      }
    };

    const onMouseDown = (e: MouseEvent) => { if (e.button === 0) down(e.clientX, e.clientY, e); };
    const onMouseMove = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onMouseUp = (e: MouseEvent) => up(e.clientX, e.clientY);
    const onTouchStart = (e: TouchEvent) => { const tch = e.touches[0]; if (tch) down(tch.clientX, tch.clientY, e); };
    const onTouchMove = (e: TouchEvent) => { const tch = e.touches[0]; if (tch) move(tch.clientX, tch.clientY); };
    const onTouchEnd = (e: TouchEvent) => { const tch = e.changedTouches[0]; if (tch) up(tch.clientX, tch.clientY); };
    const onClick = (e: MouseEvent) => { if (swallowClick) { swallowClick = false; e.stopPropagation(); } };
    const onLeave = () => { if (propsRef.current.drawTool !== "cursor") preview(null); };
    const onContext = (e: MouseEvent) => {
      // clic droit sur une figure : ouvre son menu (comme TradingView)
      if (e.target instanceof Element && e.target.closest(".draw-menu, .legend")) return;
      const pos = local(e.clientX, e.clientY);
      if (!pos?.inPane) return;
      const hit = layer.current.pick(pos.x, pos.y);
      if (!hit) return;
      e.preventDefault();
      propsRef.current.onShapeClick(hit.id, pos.rel);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { pts.length = 0; setPlacing(0); layer.current.setPreview([]); }
    };

    el.addEventListener("mousedown", onMouseDown, true);
    el.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    el.addEventListener("click", onClick, true);
    el.addEventListener("contextmenu", onContext);
    el.addEventListener("mouseleave", onLeave);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(hoverRaf);
      el.removeEventListener("mousedown", onMouseDown, true);
      el.removeEventListener("touchstart", onTouchStart, true);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("contextmenu", onContext);
      el.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // changement d'outil : on abandonne le tracé en cours
  useEffect(() => {
    layer.current.setPreview([]);
    setPlacing(0);
  }, [props.drawTool]);

  // nouvelles figures reçues : on retire les positions provisoires de glisser-déposer
  useEffect(() => {
    for (const s of shapes) layer.current.setOverride(s.id, null);
  }, [shapes]);

  // --- mise à jour temps réel de la dernière bougie (sans tout reconstruire)
  const { live } = props;
  useEffect(() => {
    const relative = settings.mode === "relative";
    const apply = (inp: SeriesInput, series: ISeriesApi<SeriesType> | null | undefined, candles: boolean) => {
      const price = live[inp.key];
      const r = inp.raw[inp.raw.length - 1];
      const d = inp.display[inp.display.length - 1];
      if (price == null || !series || !r || !d) return;
      const v = toDisplay(price, r, d, relative);
      try {
        if (candles) series.update({ time: t(d.time), open: d.open, high: Math.max(d.high, v), low: Math.min(d.low, v), close: v });
        else series.update({ time: t(d.time), value: v });
      } catch { /* série recréée entre-temps */ }
    };
    if (main) apply(main, mainSeries.current, settings.chartType === "candles");
    for (const o of overlays) apply(o, overlaySeries.current.get(o.key), false);
  }, [live, main, overlays, settings.mode, settings.chartType]);

  // --- légende
  const legend: LegendRow[] = useMemo(() => {
    const relative = settings.mode === "relative";
    const mk = (s: SeriesInput, isMain: boolean): LegendRow => {
      const hovering = hoverTime != null;
      const atRaw = hovering ? closeAtOrBefore(s.raw, hoverTime) : s.raw[s.raw.length - 1];
      const atDisp = hovering ? closeAtOrBefore(s.display, hoverTime) : s.display[s.display.length - 1];
      const livePrice = !hovering ? live[s.key] : undefined;
      const rawClose = livePrice ?? atRaw?.close;
      let change: number | null = null;
      if (atRaw && atDisp && rawClose != null) {
        change = relative ? toDisplay(rawClose, atRaw, atDisp, true) : (rawClose / s.raw[0].close - 1) * 100;
      }
      const ohlc = isMain && atRaw && hovering && settings.chartType === "candles" ? `O ${s.fmtRaw(atRaw.open)}  H ${s.fmtRaw(atRaw.high)}  B ${s.fmtRaw(atRaw.low)}  C ${s.fmtRaw(atRaw.close)}` : undefined;
      return { key: s.key, label: s.label, color: s.color, value: rawClose != null ? s.fmtRaw(rawClose) : "—", change, ohlc, isMain };
    };
    const rows: LegendRow[] = [];
    if (main) rows.push(mk(main, true));
    for (const o of overlays) rows.push(mk(o, false));
    return rows;
  }, [hoverTime, main, overlays, settings.mode, settings.chartType, live]);

  const tool = props.drawTool;
  return (
    <div ref={wrap} className={`chart-wrap ${tool !== "cursor" ? "crosshair-mode" : ""}`}>
      <div ref={box} className="chart-canvas" />
      <div className="legend">
        {legend.map((r) => (
          <div key={r.key} className={`legend-row ${r.isMain ? "main" : ""}`}>
            <span className="dot" style={{ background: r.color }} />
            <button className="legend-name" title={r.isMain ? "Actif principal" : "Cliquer pour en faire l'actif principal"} onClick={() => !r.isMain && props.onMakeMain(r.key)}>
              {r.label}
            </button>
            <span className="legend-val">{r.value}</span>
            <span className="legend-chg" style={{ color: r.change == null ? undefined : r.change >= 0 ? "var(--up)" : "var(--down)" }}>
              {fmtPct(r.change)}
            </span>
            {r.ohlc && <span className="legend-ohlc">{r.ohlc}</span>}
            {!r.isMain && (
              <button className="legend-x" title="Retirer" onClick={() => props.onRemoveOverlay(r.key)}>×</button>
            )}
          </div>
        ))}
      </div>
      {tool !== "cursor" && (
        <div className="chart-hint">
          <b>{DRAW_TOOL_INFO[tool].label}</b> — {DRAW_TOOL_INFO[tool].hint[Math.min(placing, DRAW_TOOL_INFO[tool].hint.length - 1)]}
          <span className="muted"> · Échap pour annuler</span>
        </div>
      )}
      {props.children}
    </div>
  );
}

/** Convertit un prix réel dans l'unité affichée (prix, ou % depuis la base en mode relatif). */
function toDisplay(price: number, lastRaw: Bar, lastDisp: Bar, relative: boolean): number {
  if (!relative || !lastRaw.close) return price;
  return ((100 + lastDisp.close) * price) / lastRaw.close - 100;
}
