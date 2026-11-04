import { ASSET_BY_SYMBOL, INTERVAL_SECONDS } from "../shared/assets.ts";
import type { Bar, Quote } from "../shared/types.ts";

/**
 * Générateur de données simulées, déterministe par symbole, cohérent entre
 * unités de temps. Utilisé quand les fournisseurs de données sont
 * injoignables (ou si DEMO=1). Les données sont clairement signalées "démo".
 */

const DAY = 86400;
const START = Date.UTC(2010, 0, 4) / 1000;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(seed: number): number {
  // mulberry32 one-shot
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function gauss(seed: number): number {
  const u = Math.max(1e-12, rand(seed));
  const v = rand(seed ^ 0x9e3779b9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Sensibilité au facteur "marché" commun (rend les corrélations de la démo réalistes). */
const BETA: Record<string, number> = {
  "Indices US": 0.85, "Indices monde": 0.7, Actions: 0.7, Crypto: 0.5, "Matières premières": 0.25,
  Devises: -0.3, Taux: 0.25, Volatilité: -0.75, Perso: 0.5,
};

function params(symbol: string) {
  const a = ASSET_BY_SYMBOL.get(symbol);
  const h = hashStr(symbol);
  let beta = BETA[a?.category ?? "Perso"] ?? 0.5;
  if (a?.id === "gold" || a?.id === "silver") beta = 0.1;
  if (a?.id === "eurusd") beta = 0.3;
  return {
    h,
    beta,
    price: a?.demoPrice ?? 50 + (h % 400),
    vol: a?.demoVol ?? 0.3,
    alwaysOpen: a?.alwaysOpen ?? false,
  };
}

const MARKET_SEED = 0x51f15e;

const dailyCache = new Map<string, { day0: number; closes: Float64Array; until: number }>();

/** Clôtures journalières (log) depuis 2010 jusqu'à aujourd'hui. */
function dailyLogCloses(symbol: string) {
  const today = Math.floor(Date.now() / 1000 / DAY) * DAY;
  const cached = dailyCache.get(symbol);
  if (cached && cached.until === today) return cached;
  const { h, price, vol, beta } = params(symbol);
  const n = Math.floor((today - START) / DAY) + 1;
  const idio = Math.sqrt(Math.max(0, 1 - beta * beta));
  const closes = new Float64Array(n);
  const sd = vol / Math.sqrt(365);
  let x = 0;
  // régimes de tendance lents pour un aspect réaliste
  for (let i = 0; i < n; i++) {
    const regime = Math.sin(i / 180 + (h % 97)) * 0.0009 + Math.sin(i / 47 + (h % 13)) * 0.0006;
    const common = gauss(MARKET_SEED ^ Math.imul(i + 1, 2246822519));
    const shock = (beta * common + idio * gauss(h ^ Math.imul(i + 1, 2654435761))) * sd;
    x += regime + shock + 0.00012;
    closes[i] = x;
  }
  const shift = Math.log(price) - closes[n - 1];
  for (let i = 0; i < n; i++) closes[i] += shift;
  const entry = { day0: START, closes, until: today };
  dailyCache.set(symbol, entry);
  return entry;
}

/** Valeur (log) intrajournalière par pont brownien déterministe. */
function logPriceAt(symbol: string, t: number): number {
  const { h, vol } = params(symbol);
  const { day0, closes } = dailyLogCloses(symbol);
  const idx = Math.floor((t - day0) / DAY);
  if (idx <= 0) return closes[0];
  if (idx >= closes.length) return closes[closes.length - 1];
  const o = closes[idx - 1];
  const c = closes[idx];
  const f = ((t - day0) % DAY) / DAY;
  const sd = vol / Math.sqrt(365);
  let noise = 0;
  for (let k = 1; k <= 6; k++) {
    const amp = gauss(h ^ Math.imul(idx * 7 + k, 40503)) / k;
    noise += amp * Math.sin(Math.PI * k * f);
  }
  return o + (c - o) * f + noise * sd * 0.6;
}

function isOpen(symbol: string, t: number): boolean {
  if (params(symbol).alwaysOpen) return true;
  const d = new Date(t * 1000);
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return true;
}

const RANGE_SECONDS: Record<string, number> = {
  "1d": DAY, "5d": 5 * DAY, "1mo": 31 * DAY, "3mo": 92 * DAY, "6mo": 183 * DAY,
  "1y": 365 * DAY, "2y": 730 * DAY, "5y": 1826 * DAY, "10y": 3652 * DAY,
};

export function demoHistory(symbol: string, range: string, interval: string): Bar[] {
  const now = Math.floor(Date.now() / 1000);
  const step = INTERVAL_SECONDS[interval] ?? DAY;
  let from: number;
  if (range === "ytd") from = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
  else if (range === "max") from = START + DAY;
  else from = now - (RANGE_SECONDS[range] ?? 365 * DAY);
  if (range === "1d") {
    // dernière séance : depuis minuit UTC (ou le dernier jour ouvré)
    let d = Math.floor(now / DAY) * DAY;
    while (!isOpen(symbol, d + 43200)) d -= DAY;
    from = d;
  }
  const { h, vol } = params(symbol);
  const bars: Bar[] = [];
  const daily = step >= DAY;
  let t = daily ? Math.floor(from / DAY) * DAY : Math.floor(from / step) * step;
  const sub = 6;
  while (t <= now) {
    const end = Math.min(t + step, now);
    if (isOpen(symbol, daily ? t + 43200 : t) || step > DAY) {
      const pts: number[] = [];
      for (let k = 0; k <= sub; k++) pts.push(logPriceAt(symbol, t + ((end - t) * k) / sub));
      const o = Math.exp(pts[0]);
      const c = Math.exp(pts[sub]);
      const wig = (vol / Math.sqrt(365)) * Math.sqrt(Math.min(1, step / DAY)) * 0.35;
      const hi = Math.exp(Math.max(...pts) + Math.abs(gauss(h ^ t)) * wig);
      const lo = Math.exp(Math.min(...pts) - Math.abs(gauss(h ^ (t + 1))) * wig);
      const volume = Math.round(1e6 * (1 + rand(h ^ (t * 3))));
      bars.push({ time: t, open: o, high: Math.max(hi, o, c), low: Math.min(lo, o, c), close: c, volume });
    }
    t += step;
  }
  return bars;
}

export function demoQuote(symbol: string): Quote {
  const now = Math.floor(Date.now() / 1000);
  const intraday = demoHistory(symbol, "1d", "5m");
  const jitter = gauss(params(symbol).h ^ Math.floor(Date.now() / 3000)) * 0.0004;
  const price = Math.exp(logPriceAt(symbol, now) + jitter);
  const first = intraday[0]?.time ?? now;
  const prev = Math.exp(logPriceAt(symbol, first - 1));
  return {
    symbol,
    price,
    previousClose: prev,
    change: price - prev,
    changePct: ((price - prev) / prev) * 100,
    time: now,
    spark: intraday.map((b) => b.close),
    demo: true,
  };
}
