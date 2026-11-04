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

async function getJson(path: string, timeoutMs = 10000): Promise<any> {
  let lastErr: unknown;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) {
        const body = await res.json().catch(() => null);
        throw new UpstreamError(body?.chart?.error?.description ?? "Symbole introuvable");
      }
      if (!res.ok) throw new UpstreamError(`Yahoo HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (e instanceof UpstreamError && !e.network && !/HTTP 5|HTTP 429/.test(e.message)) throw e;
      lastErr = e;
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
  const ts: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const meta = result.meta ?? {};
  const offset: number = meta.gmtoffset ?? 0;
  const alignDaily = DAILY_PLUS.has(interval);
  const map = new Map<number, Bar>();
  for (let i = 0; i < ts.length; i++) {
    const c = quote.close?.[i];
    if (c == null || !Number.isFinite(c)) continue;
    let t = ts[i];
    if (alignDaily) t = Math.floor((t + offset) / 86400) * 86400;
    const o = quote.open?.[i] ?? c;
    const h = quote.high?.[i] ?? Math.max(o, c);
    const l = quote.low?.[i] ?? Math.min(o, c);
    map.set(t, { time: t, open: o, high: Math.max(h, o, c), low: Math.min(l, o, c), close: c, volume: quote.volume?.[i] ?? undefined });
  }
  const bars = [...map.values()].sort((a, b) => a.time - b.time);
  // Corrige la dernière bougie avec le dernier prix connu.
  const last = bars[bars.length - 1];
  if (last && Number.isFinite(meta.regularMarketPrice)) {
    last.close = meta.regularMarketPrice;
    last.high = Math.max(last.high, last.close);
    last.low = Math.min(last.low, last.close);
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
