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
  LineSeries,
  LineStyle,
  type MouseEventParams,
  PriceScaleMode,
  type SeriesMarker,
  type SeriesType,
  type Time,
  TickMarkType,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Bar } from "../../shared/types.ts";
import type { Drawing, Marker, Pt } from "../lib/drawings.ts";
import { fmtPct } from "../lib/format.ts";
import { bollinger, ema, macd, type Num, rsi, sma } from "../lib/indicators.ts";
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

export interface Measure {
  id: string;
  a: Pt;
  b: Pt;
}

interface Props {
  main: SeriesInput | null;
  overlays: SeriesInput[];
  settings: ChartSettings;
  drawings: Drawing[];
  measures: Measure[];
  pendingPoint: Pt | null;
  /** Derniers prix temps réel (bruts) par clé d'actif. */
  live: Record<string, number | undefined>;
  interaction: "none" | "measure" | "rebase";
  onChartClick: (p: Pt) => void;
  onRemoveOverlay: (key: string) => void;
  onMakeMain: (key: string) => void;
  structureKey: string;
  barSeconds: number;
  watermark: string;
}

const UP = "#089981";
const DOWN = "#f23645";
const STYLE = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted } as const;

const t = (x: number) => x as UTCTimestamp;

function lineData(points: Pt[]) {
  const seen = new Set<number>();
  return points
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time)
    .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
    .map((p) => ({ time: t(p.time), value: p.value }));
}

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

export function Chart(props: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeries = useRef<ISeriesApi<SeriesType> | null>(null);
  const overlaySeries = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
  const allSeries = useRef<ISeriesApi<SeriesType>[]>([]);
  const lastStructure = useRef<string>("");
  const watermarkRef = useRef<{ detach: () => void } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [hoverTime, setHoverTime] = useState<number | null>(null);

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
      timeScale: { borderColor: "#1f2633", rightOffset: 6, timeVisible: false },
      localization: { locale: "fr-FR" },
    });
    chartRef.current = chart;
    let raf = 0;
    const onMove = (param: MouseEventParams<Time>) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setHoverTime(param.time != null ? (param.time as number) : null));
    };
    const onClick = (param: MouseEventParams<Time>) => {
      const p = propsRef.current;
      if (p.interaction === "none" || !param.point || !mainSeries.current) return;
      let time = param.time as number | undefined;
      if (time == null) {
        const ct = chart.timeScale().coordinateToTime(param.point.x);
        time = ct != null ? (ct as number) : undefined;
      }
      const value = mainSeries.current.coordinateToPrice(param.point.y);
      if (time == null || value == null) return;
      p.onChartClick({ time, value });
    };
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);
    return () => {
      cancelAnimationFrame(raf);
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // --- construction des séries (à chaque changement de données / réglages / outils)
  const { main, overlays, settings, drawings, measures, pendingPoint, structureKey, barSeconds, watermark } = props;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const prevRange = chart.timeScale().getVisibleRange();
    const fullKey = `${structureKey}|${main?.raw[0]?.time ?? ""}`;
    const sameStructure = lastStructure.current === fullKey;

    for (const s of allSeries.current) chart.removeSeries(s);
    allSeries.current = [];
    overlaySeries.current.clear();
    mainSeries.current = null;
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
    chart.priceScale("right").applyOptions({
      mode: settings.logScale && !relative ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
    if (relative) {
      ms.createPriceLine({ price: 0, color: "#5d606b", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
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

    // dessins automatiques
    const markers: Marker[] = [];
    for (const d of drawings) {
      if (d.kind === "priceLine") {
        ms.createPriceLine({ price: d.price, color: d.color, lineWidth: (d.width ?? 1) as 1, lineStyle: STYLE[d.style ?? "dashed"], axisLabelVisible: true, title: d.title });
      } else if (d.kind === "markers") {
        markers.push(...d.markers);
      } else {
        const data = lineData(d.points);
        if (data.length < 2) continue;
        const s = add(chart.addSeries(LineSeries, {
          color: d.color, lineWidth: (d.width ?? 1) as 1, lineStyle: STYLE[d.style ?? "solid"], priceLineVisible: false,
          lastValueVisible: !!d.showLabel, title: d.showLabel ? d.label ?? "" : "", crosshairMarkerVisible: false, priceFormat: mainFormat,
          ...(d.autoscale ? {} : { autoscaleInfoProvider: () => null }),
        }));
        s.setData(data);
      }
    }
    // mesures (outil règle)
    for (const m of measures) {
      const data = lineData([m.a, m.b]);
      const change = relative ? m.b.value - m.a.value : m.a.value !== 0 ? (m.b.value / m.a.value - 1) * 100 : 0;
      const color = change >= 0 ? "#22c55e" : "#f43f5e";
      if (data.length >= 2) {
        add(chart.addSeries(LineSeries, { color, lineWidth: 2, lineStyle: LineStyle.Solid, priceLineVisible: false, lastValueVisible: true, title: `${relative ? `${change >= 0 ? "+" : ""}${change.toFixed(2)} pts` : fmtPct(change)}`, crosshairMarkerVisible: false, priceFormat: mainFormat, autoscaleInfoProvider: () => null })).setData(data);
      }
    }
    if (pendingPoint) markers.push({ time: pendingPoint.time, position: "inBar", shape: "circle", color: "#f7c948", text: "A" });
    const barTimes = new Set(bars.map((b) => b.time));
    const validMarkers = markers
      .map((m) => ({ ...m, time: barTimes.has(m.time) ? m.time : closeAtOrBefore(bars, m.time)?.time ?? m.time }))
      .sort((a, b) => a.time - b.time)
      .map((m) => ({ ...m, time: t(m.time) }) as SeriesMarker<Time>);
    if (validMarkers.length) createSeriesMarkers(ms, validMarkers);

    watermarkRef.current?.detach();
    watermarkRef.current = createTextWatermark(chart.panes()[0], {
      horzAlign: "center", vertAlign: "center",
      lines: [{ text: watermark, color: "rgba(178,181,190,0.06)", fontSize: 56, fontStyle: "bold" }],
    });

    if (sameStructure && prevRange) {
      try { chart.timeScale().setVisibleRange(prevRange); } catch { chart.timeScale().fitContent(); }
    } else {
      chart.timeScale().fitContent();
    }
    lastStructure.current = fullKey;
  }, [main, overlays, settings, drawings, measures, pendingPoint, structureKey, barSeconds, watermark]);

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

  return (
    <div className={`chart-wrap ${props.interaction !== "none" ? "crosshair-mode" : ""}`}>
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
      {props.interaction !== "none" && (
        <div className="chart-hint">
          {props.interaction === "measure"
            ? pendingPoint ? "Cliquez le point d'arrivée (B)" : "Règle : cliquez le point de départ (A)"
            : "Cliquez une date pour rebaser la comparaison à 0 %"}
        </div>
      )}
    </div>
  );
}

/** Convertit un prix réel dans l'unité affichée (prix, ou % depuis la base en mode relatif). */
function toDisplay(price: number, lastRaw: Bar, lastDisp: Bar, relative: boolean): number {
  if (!relative || !lastRaw.close) return price;
  return ((100 + lastDisp.close) * price) / lastRaw.close - 100;
}
