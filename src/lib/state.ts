import type { Sensitivity } from "./pivots.ts";
import type { PerfPeriod } from "./stats.ts";
import type { ToolId } from "./tools.ts";

export type IndicatorId = "sma20" | "sma50" | "sma200" | "ema21" | "bollinger" | "volume" | "rsi" | "macd";

export const INDICATOR_INFO: Record<IndicatorId, { label: string; pane: boolean; color: string }> = {
  sma20: { label: "MM20", pane: false, color: "#b39ddb" },
  sma50: { label: "MM50", pane: false, color: "#fff176" },
  sma200: { label: "MM200", pane: false, color: "#eceff1" },
  ema21: { label: "EMA21", pane: false, color: "#80cbc4" },
  bollinger: { label: "Bollinger", pane: false, color: "#7e57c2" },
  volume: { label: "Volume", pane: false, color: "#5d606b" },
  rsi: { label: "RSI", pane: true, color: "#ab47bc" },
  macd: { label: "MACD", pane: true, color: "#2962ff" },
};

export interface ChartSettings {
  mainId: string;
  overlays: string[];
  timeframe: string;
  mode: "absolute" | "relative";
  sharedScale: boolean;
  chartType: "candles" | "line" | "area";
  logScale: boolean;
  tools: ToolId[];
  indicators: IndicatorId[];
  sensitivity: Sensitivity;
  forecastHorizon: number;
  /** Date de base du mode relatif (null = début de la période). */
  rebaseTime: number | null;
}

export const DEFAULT_SETTINGS: ChartSettings = {
  mainId: "spx",
  overlays: ["nasdaq", "btc"],
  timeframe: "1Y",
  mode: "relative",
  sharedScale: false,
  chartType: "candles",
  logScale: false,
  tools: [],
  indicators: ["volume"],
  sensitivity: "normal",
  forecastHorizon: 30,
  rebaseTime: null,
};

export interface Template {
  id: string;
  name: string;
  builtin?: boolean;
  tools: ToolId[];
  indicators: IndicatorId[];
  mode?: ChartSettings["mode"];
  chartType?: ChartSettings["chartType"];
  timeframe?: string;
}

export const BUILTIN_TEMPLATES: Template[] = [
  { id: "swing", name: "Swing : Fibo + S/R + MM", builtin: true, tools: ["fibRetracement", "supportResistance"], indicators: ["sma20", "sma50", "volume"], mode: "absolute", chartType: "candles" },
  { id: "targets", name: "Objectifs : Fibo Ext. + Prévision", builtin: true, tools: ["fibExtension", "forecast", "supportResistance"], indicators: ["volume"], mode: "absolute", chartType: "candles" },
  { id: "trend", name: "Tendance : MM50/200 + Canal + Obliques", builtin: true, tools: ["channel", "trendlines"], indicators: ["sma50", "sma200"], mode: "absolute", chartType: "candles" },
  { id: "momentum", name: "Momentum : RSI + MACD + Divergences", builtin: true, tools: ["divergences"], indicators: ["rsi", "macd", "ema21"], mode: "absolute", chartType: "candles" },
  { id: "compare", name: "Comparaison relative (%)", builtin: true, tools: [], indicators: [], mode: "relative", chartType: "line" },
];

export interface Alert {
  id: string;
  assetId: string;
  kind: "above" | "below" | "changeUp" | "changeDown";
  value: number;
  period?: PerfPeriod;
  active: boolean;
  repeat: boolean;
  createdAt: number;
  lastTriggered?: number;
}

export interface AlertEvent {
  id: string;
  alertId: string;
  time: number;
  text: string;
}

export function describeAlert(a: Alert, name: string): string {
  switch (a.kind) {
    case "above": return `${name} au-dessus de ${a.value.toLocaleString("fr-FR")}`;
    case "below": return `${name} en dessous de ${a.value.toLocaleString("fr-FR")}`;
    case "changeUp": return `${name} en hausse de ${a.value} % ou plus sur ${a.period}`;
    case "changeDown": return `${name} en baisse de ${a.value} % ou plus sur ${a.period}`;
  }
}

export const SERIES_COLORS = ["#2962ff", "#ff9800", "#e91e63", "#00bcd4", "#8bc34a", "#ab47bc", "#f7c948", "#ff5722", "#26a69a", "#9e9e9e", "#3f51b5", "#cddc39"];
