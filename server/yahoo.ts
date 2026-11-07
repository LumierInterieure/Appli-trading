import { INTERVAL_SECONDS } from "../shared/assets.ts";
import type { Bar, Quote, SearchResult } from "../shared/types.ts";

const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
};

export class UpstreamError extends Error {
  constructor(message: string, public network = false) {
    super(message);
  }
}

/**
 * Limiteur global : Yahoo renvoie des erreurs 429 (trop de requêtes) si on
 * l'interroge trop vite. On plafonne le nombre d'appels simultanés.
 */
const MAX_CONCURRENT = 4;
let active = 0;
const waiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(path: string, timeoutMs = 10000): Promise<any> {
  let lastErr: unknown;
  // 3 tentatives, en alternant les deux serveurs Yahoo, avec pause croissante si limité (429) ou en erreur 5xx
  for (let attempt = 0; attempt < 3; attempt++) {
    const host = HOSTS[attempt % HOSTS.length];
    try {
      return await slot(async () => {
        const res = await fetch(host + path, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
        if (res.status === 404) {
          const body = await res.json().catch(() => null);
          throw new UpstreamError(body?.chart?.error?.description ?? "Symbole introuvable");
        }
        if (!res.ok) throw new UpstreamError(`Yahoo HTTP ${res.status}`, true);
        return await res.json();
      });
    } catch (e) {
      if (e instanceof UpstreamError && !e.network) throw e;
      lastErr = e;
      if (attempt < 2) await sleep(600 * (attempt + 1) ** 2);
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new UpstreamError(`Yahoo injoignable : ${msg}`, true);
}

export interface ChartResult {
  bars: Bar[];
  meta: {
    currency?: string;
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    regularMarketTime?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    gmtoffset?: number;
    exchangeTimezoneName?: string;
    instrumentType?: string;
    marketState?: string;
  };
}

const DAILY_PLUS = new Set(["1d", "5d", "1wk", "1mo", "3mo"]);

export async function fetchChart(symbol: string, range: string, interval: string): Promise<ChartResult> {
  const q = new URLSearchParams({ range, interval, includePrePost: "false", events: "div,splits" });
  const json = await getJson(`/v8/finance/chart/${encodeURIComponent(symbol)}?${q}`);
  const result = json?.chart?.result?.[0];
  if (!result) throw new UpstreamError(json?.chart?.error?.description ?? "Réponse Yahoo vide");
  return parseChart(result, interval);
}

/** Durée maximale d'une bougie journalière ou plus (les barres « max » peuvent être trimestrielles). */
const PERIOD_DAYS: Record<string, number> = { "1d": 1, "5d": 5, "1wk": 7, "1mo": 92, "3mo": 92 };

/**
 * Transforme la réponse Yahoo en bougies propres.
 *
 * Pièges gérés :
 * - la ligne de la séance en cours (ou tout juste terminée) arrive souvent SANS clôture :
 *   on la complète avec le dernier prix au lieu de la supprimer ;
 * - le dernier prix n'est appliqué à la dernière bougie que s'il appartient bien à sa
 *   période (sinon on étirait la bougie de la veille jusqu'au prix du jour) ;
 * - en hebdo/mensuel, la ligne « en cours » datée d'aujourd'hui est fusionnée dans la
 *   semaine / le mois courant.
 */
export function parseChart(result: any, interval: string): ChartResult {
  const ts: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const meta = result.meta ?? {};
  const offset: number = meta.gmtoffset ?? 0;
  const alignDaily = DAILY_PLUS.has(interval);
  const step = INTERVAL_SECONDS[interval] ?? 86400;
  const price: number | null = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : null;
  const rmt: number | null = Number.isFinite(meta.regularMarketTime) ? meta.regularMarketTime : null;

  // horodatage d'une bougie : début de séance (ou minuit local) -> jour le plus proche,
  // robuste au changement d'heure été/hiver
  const alignBar = (t: number) => (alignDaily ? Math.round((t + offset) / 86400) * 86400 : t);
  // le dernier prix appartient-il à la bougie qui commence à `barTime` ?
  const inPeriod = (barTime: number) => {
    if (rmt == null) return false;
    if (!alignDaily) return rmt >= barTime && rmt < barTime + step;
    const day = Math.floor((rmt + offset) / 86400) * 86400;
    return day >= barTime && day < barTime + (PERIOD_DAYS[interval] ?? 1) * 86400;
  };

  const map = new Map<number, Bar>();
  for (let i = 0; i < ts.length; i++) {
    const t = alignBar(ts[i]);
    let c: number | null | undefined = quote.close?.[i];
    if (c == null || !Number.isFinite(c)) {
      if (i === ts.length - 1 && price != null && inPeriod(t)) c = price;
      else continue;
    }
    const o = quote.open?.[i] ?? c;
    const h = quote.high?.[i] ?? Math.max(o, c);
    const l = quote.low?.[i] ?? Math.min(o, c);
    map.set(t, { time: t, open: o, high: Math.max(h, o, c), low: Math.min(l, o, c), close: c, volume: quote.volume?.[i] ?? undefined });
  }
  const bars = [...map.values()].sort((a, b) => a.time - b.time);

  if ((interval === "1wk" || interval === "1mo" || interval === "3mo") && bars.length >= 3) {
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const gap = prev.time - bars[bars.length - 3].time;
    if (last.time - prev.time < gap * 0.85) {
      prev.high = Math.max(prev.high, last.high);
      prev.low = Math.min(prev.low, last.low);
      prev.close = last.close;
      if (last.volume != null) prev.volume = Math.max(prev.volume ?? 0, last.volume);
      bars.pop();
    }
  }

  // dernier prix connu, seulement s'il appartient à la période de la dernière bougie
  const last = bars[bars.length - 1];
  if (last && price != null && inPeriod(last.time)) {
    last.close = price;
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    if (interval === "1d") {
      if (Number.isFinite(meta.regularMarketDayHigh)) last.high = Math.max(last.high, meta.regularMarketDayHigh);
      if (Number.isFinite(meta.regularMarketDayLow)) last.low = Math.min(last.low, meta.regularMarketDayLow);
    }
  }
  return { bars, meta };
}

function downsample(values: number[], max: number): number[] {
  if (values.length <= max) return values;
  const step = values.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(values[Math.floor(i * step)]);
  out[out.length - 1] = values[values.length - 1];
  return out;
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  const { bars, meta } = await fetchChart(symbol, "1d", "5m");
  const price = meta.regularMarketPrice ?? bars[bars.length - 1]?.close;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? bars[0]?.open ?? price;
  if (price == null || prev == null) throw new UpstreamError("Cotation indisponible");
  return {
    symbol,
    price,
    previousClose: prev,
    change: price - prev,
    changePct: prev ? ((price - prev) / prev) * 100 : 0,
    time: meta.regularMarketTime ?? Math.floor(Date.now() / 1000),
    currency: meta.currency,
    marketState: meta.marketState,
    spark: downsample(bars.map((b) => b.close), 80),
    demo: false,
  };
}

/**
 * Cotations groupées : un seul appel Yahoo pour 20 symboles maximum
 * (au lieu d'un appel par symbole), ce qui évite d'être limité par Yahoo.
 */
export async function fetchQuotesBatch(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  for (let i = 0; i < symbols.length; i += 20) {
    const chunk = symbols.slice(i, i + 20);
    const q = new URLSearchParams({ symbols: chunk.join(","), range: "1d", interval: "5m" });
    const json = await getJson(`/v8/finance/spark?${q}`);
    for (const sym of chunk) {
      const d = json?.[sym];
      if (!d) continue;
      const closes: number[] = (d.close ?? []).filter((v: number | null) => v != null && Number.isFinite(v));
      const price = closes[closes.length - 1];
      const prev = d.chartPreviousClose ?? d.previousClose;
      if (price == null || prev == null) continue;
      out.set(sym, {
        symbol: sym,
        price,
        previousClose: prev,
        change: price - prev,
        changePct: prev ? ((price - prev) / prev) * 100 : 0,
        time: d.end && d.timestamp?.length ? Math.min(d.end, d.timestamp[d.timestamp.length - 1] + (d.dataGranularity ?? 300)) : Math.floor(Date.now() / 1000),
        spark: downsample(closes, 80),
        demo: false,
      });
    }
  }
  return out;
}

export async function searchSymbols(query: string): Promise<SearchResult[]> {
  const q = new URLSearchParams({ q: query, quotesCount: "12", newsCount: "0", listsCount: "0" });
  const json = await getJson(`/v1/finance/search?${q}`);
  return (json?.quotes ?? [])
    .filter((x: any) => x.symbol)
    .map((x: any) => ({
      symbol: x.symbol,
      name: x.shortname || x.longname || x.symbol,
      exchange: x.exchDisp || x.exchange,
      type: x.quoteTypeDisp || x.quoteType,
    }));
}
