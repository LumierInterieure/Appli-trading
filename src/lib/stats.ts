import type { Bar } from "../../shared/types.ts";

const DAY = 86400;

/** Clôture de la dernière bougie dont la date est <= t. */
export function closeAtOrBefore(bars: Bar[], t: number): Bar | null {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? bars[ans] : null;
}

export function barAtOrAfter(bars: Bar[], t: number): Bar | null {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time >= t) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return ans >= 0 ? bars[ans] : null;
}

export const PERF_PERIODS = [
  { id: "1D", label: "1J" },
  { id: "1W", label: "1S" },
  { id: "1M", label: "1M" },
  { id: "3M", label: "3M" },
  { id: "6M", label: "6M" },
  { id: "YTD", label: "YTD" },
  { id: "1Y", label: "1A" },
  { id: "3Y", label: "3A" },
  { id: "5Y", label: "5A" },
] as const;
export type PerfPeriod = (typeof PERF_PERIODS)[number]["id"];

export function periodStart(period: PerfPeriod, now: number): number {
  const d = new Date(now * 1000);
  const sub = (months: number) => {
    const x = new Date(d);
    x.setUTCMonth(x.getUTCMonth() - months);
    return Math.floor(x.getTime() / 1000);
  };
  switch (period) {
    case "1D": return now - DAY;
    case "1W": return now - 7 * DAY;
    case "1M": return sub(1);
    case "3M": return sub(3);
    case "6M": return sub(6);
    case "YTD": return Date.UTC(d.getUTCFullYear(), 0, 1) / 1000 - 1;
    case "1Y": return sub(12);
    case "3Y": return sub(36);
    case "5Y": return sub(60);
  }
}

/**
 * Variation en % sur une période. `livePrice` remplace la dernière clôture si
 * fourni. Pour 1J on compare à la clôture précédente.
 */
export function periodChange(bars: Bar[], period: PerfPeriod, livePrice?: number, prevClose?: number): number | null {
  if (!bars.length) return null;
  const last = livePrice ?? bars[bars.length - 1].close;
  if (period === "1D") {
    const ref = prevClose ?? bars[bars.length - 2]?.close;
    return ref ? (last / ref - 1) * 100 : null;
  }
  const lastT = bars[bars.length - 1].time;
  const start = periodStart(period, lastT);
  if (bars[0].time > start + 5 * DAY) return null; // historique insuffisant
  const ref = closeAtOrBefore(bars, start);
  return ref ? (last / ref.close - 1) * 100 : null;
}

export function changeBetween(bars: Bar[], from: number, to: number): number | null {
  const a = closeAtOrBefore(bars, from) ?? barAtOrAfter(bars, from);
  const b = closeAtOrBefore(bars, to);
  if (!a || !b || b.time < a.time) return null;
  return (b.close / a.close - 1) * 100;
}

export function logReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0 && closes[i] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  return r;
}

export function stdev(x: number[]): number {
  if (x.length < 2) return 0;
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1));
}

export function mean(x: number[]): number {
  return x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0;
}

/** Volatilité annualisée (%) sur les n derniers rendements journaliers. */
export function annualizedVol(bars: Bar[], n = 20, periodsPerYear = 252): number {
  const r = logReturns(bars.slice(-n - 1).map((b) => b.close));
  return stdev(r) * Math.sqrt(periodsPerYear) * 100;
}

export function maxDrawdown(bars: Bar[]): { dd: number; fromHigh: number } {
  let peak = -Infinity, dd = 0;
  for (const b of bars) {
    peak = Math.max(peak, b.close);
    dd = Math.min(dd, b.close / peak - 1);
  }
  const last = bars[bars.length - 1]?.close ?? 0;
  return { dd: dd * 100, fromHigh: (last / peak - 1) * 100 };
}

/** Rendements journaliers alignés par date. */
function dailyReturnMap(bars: Bar[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 1; i < bars.length; i++) {
    const day = Math.floor(bars[i].time / DAY);
    if (bars[i - 1].close > 0) m.set(day, Math.log(bars[i].close / bars[i - 1].close));
  }
  return m;
}

export function correlation(a: Bar[], b: Bar[], lookbackDays = 90): number | null {
  const ma = dailyReturnMap(a.slice(-lookbackDays - 1));
  const mb = dailyReturnMap(b.slice(-lookbackDays - 1));
  const xs: number[] = [], ys: number[] = [];
  for (const [d, r] of ma) {
    const s = mb.get(d);
    if (s !== undefined) { xs.push(r); ys.push(s); }
  }
  if (xs.length < 15) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Générateur pseudo-aléatoire déterministe (résultats stables entre rendus). */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: Float64Array, q: number) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface Forecast {
  p05: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[];
  probUp: number;
  sigma: number;
  drift: number;
}

/**
 * Projection Monte-Carlo par rééchantillonnage par blocs des rendements
 * historiques (garde les queues épaisses et l'autocorrélation courte),
 * volatilité recalée sur la volatilité récente (EWMA), dérive amortie.
 */
export function forecastPaths(closes: number[], horizon: number, nPaths = 1500): Forecast | null {
  const r = logReturns(closes);
  if (r.length < 30 || horizon < 1) return null;
  const hist = r.slice(-750);
  const m = mean(hist);
  const sdHist = stdev(hist) || 1e-9;
  // EWMA (lambda 0.94) pour la volatilité courante
  let v = sdHist ** 2;
  for (const x of hist.slice(-120)) v = 0.94 * v + 0.06 * x * x;
  const sigma = Math.sqrt(v);
  const scale = sigma / sdHist;
  // dérive : moyenne longue fortement amortie + un peu de momentum récent
  const mom = mean(hist.slice(-60));
  const drift = 0.25 * m + 0.1 * mom;
  const centered = hist.map((x) => (x - m) * scale);
  const rnd = mulberry32(closes.length * 7919 + Math.round(closes[closes.length - 1] * 1000));
  const block = 5;
  const p0 = closes[closes.length - 1];
  const cols: Float64Array[] = Array.from({ length: horizon + 1 }, () => new Float64Array(nPaths));
  for (let p = 0; p < nPaths; p++) {
    let x = 0, k = 0, start = 0;
    cols[0][p] = p0;
    for (let s = 1; s <= horizon; s++) {
      if (k % block === 0) start = Math.floor(rnd() * (centered.length - block));
      x += drift + centered[start + (k % block)];
      k++;
      cols[s][p] = p0 * Math.exp(x);
    }
  }
  const out: Forecast = { p05: [], p25: [], p50: [], p75: [], p95: [], probUp: 0, sigma, drift };
  for (let s = 0; s <= horizon; s++) {
    const sorted = cols[s].slice().sort();
    out.p05.push(quantile(sorted, 0.05));
    out.p25.push(quantile(sorted, 0.25));
    out.p50.push(quantile(sorted, 0.5));
    out.p75.push(quantile(sorted, 0.75));
    out.p95.push(quantile(sorted, 0.95));
  }
  let up = 0;
  for (let p = 0; p < nPaths; p++) if (cols[horizon][p] > p0) up++;
  out.probUp = up / nPaths;
  return out;
}

/**
 * Un prix en direct est-il cohérent avec la dernière bougie ? Écart maximal toléré
 * par rapport à sa clôture : 8 % en intraday, 20 % au-delà (largement au-dessus
 * des mouvements réels, mais bloque les incohérences de source ou d'échelle).
 */
export function isPlausibleLive(price: number, last: Bar, barSeconds: number): boolean {
  if (!Number.isFinite(price) || price <= 0 || !last.close) return false;
  const max = barSeconds < 86400 ? 0.08 : 0.2;
  return Math.abs(price / last.close - 1) <= max;
}
