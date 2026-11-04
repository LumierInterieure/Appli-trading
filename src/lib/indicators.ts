import type { Bar } from "../../shared/types.ts";

export type Num = number | null;

export function sma(values: number[], n: number): Num[] {
  const out: Num[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values: number[], n: number): Num[] {
  const out: Num[] = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI de Wilder. */
export function rsi(closes: number[], n = 14): Num[] {
  const out: Num[] = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line: Num[] = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i]! - es[i]! : null));
  const start = line.findIndex((v) => v != null);
  const sig: Num[] = new Array(closes.length).fill(null);
  if (start >= 0) {
    const sub = ema(line.slice(start) as number[], signal);
    sub.forEach((v, j) => (sig[start + j] = v));
  }
  const hist: Num[] = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i]! : null));
  return { line, signal: sig, hist };
}

export function bollinger(closes: number[], n = 20, k = 2) {
  const mid = sma(closes, n);
  const upper: Num[] = [], lower: Num[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] == null) { upper.push(null); lower.push(null); continue; }
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (closes[j] - mid[i]!) ** 2;
    const sd = Math.sqrt(s / n);
    upper.push(mid[i]! + k * sd);
    lower.push(mid[i]! - k * sd);
  }
  return { mid, upper, lower };
}

export function atr(bars: Bar[], n = 14): Num[] {
  const out: Num[] = new Array(bars.length).fill(null);
  if (bars.length < 2) return out;
  const tr = bars.map((b, i) =>
    i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)),
  );
  if (bars.length <= n) {
    const avg = tr.reduce((a, b) => a + b, 0) / tr.length;
    out[bars.length - 1] = avg;
    return out;
  }
  let prev = tr.slice(1, n + 1).reduce((a, b) => a + b, 0) / n;
  out[n] = prev;
  for (let i = n + 1; i < bars.length; i++) {
    prev = (prev * (n - 1) + tr[i]) / n;
    out[i] = prev;
  }
  return out;
}

export function lastValid(values: Num[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return values[i];
  return null;
}

/** Régression linéaire y = a + b·x sur x = 0..n-1. */
export function linreg(values: number[]) {
  const n = values.length;
  if (n < 2) return { a: values[0] ?? 0, b: 0, sd: 0, r2: 0 };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += values[i]; sxy += i * values[i]; sxx += i * i; }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  let ss = 0, st = 0;
  const mean = sy / n;
  for (let i = 0; i < n; i++) { ss += (values[i] - (a + b * i)) ** 2; st += (values[i] - mean) ** 2; }
  return { a, b, sd: Math.sqrt(ss / n), r2: st ? 1 - ss / st : 0 };
}
