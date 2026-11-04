import type { Bar, Quote } from "../shared/types.ts";
import { TtlCache } from "./cache.ts";
import { fetchChart, fetchQuote, UpstreamError } from "./yahoo.ts";

/**
 * TOTAL3ES = capitalisation crypto totale hors BTC, ETH et stablecoins.
 * Aucun fournisseur gratuit ne donne son historique : on le reconstruit à
 * partir des principaux altcoins (prix Yahoo × offre en circulation
 * CoinGecko), puis on recale le niveau sur la valeur réelle actuelle
 * calculée depuis l'endpoint /global de CoinGecko.
 */
interface Component {
  yahoo: string;
  gecko: string;
  /** Offre en circulation approximative (repli si CoinGecko indisponible). */
  supply: number;
}

const COMPONENTS: Component[] = [
  { yahoo: "XRP-USD", gecko: "ripple", supply: 60e9 },
  { yahoo: "BNB-USD", gecko: "binancecoin", supply: 139e6 },
  { yahoo: "SOL-USD", gecko: "solana", supply: 545e6 },
  { yahoo: "DOGE-USD", gecko: "dogecoin", supply: 151e9 },
  { yahoo: "TRX-USD", gecko: "tron", supply: 94.7e9 },
  { yahoo: "ADA-USD", gecko: "cardano", supply: 36.5e9 },
  { yahoo: "LINK-USD", gecko: "chainlink", supply: 678e6 },
  { yahoo: "AVAX-USD", gecko: "avalanche-2", supply: 422e6 },
  { yahoo: "XLM-USD", gecko: "stellar", supply: 32e9 },
  { yahoo: "BCH-USD", gecko: "bitcoin-cash", supply: 19.9e6 },
  { yahoo: "HBAR-USD", gecko: "hedera-hashgraph", supply: 42.4e9 },
  { yahoo: "LTC-USD", gecko: "litecoin", supply: 76.3e6 },
  { yahoo: "DOT-USD", gecko: "polkadot", supply: 1.63e9 },
  { yahoo: "SHIB-USD", gecko: "shiba-inu", supply: 589e12 },
  { yahoo: "XMR-USD", gecko: "monero", supply: 18.4e6 },
  { yahoo: "ETC-USD", gecko: "ethereum-classic", supply: 153e6 },
];

const STABLE_KEYS = ["usdt", "usdc", "usde", "dai", "usds", "fdusd", "pyusd", "tusd", "usd1", "busd"];

interface Calibration {
  supplies: Map<string, number>;
  /** Facteur de passage panier -> capitalisation TOTAL3ES réelle. */
  k: number;
  source: "coingecko" | "fallback";
}

const calCache = new TtlCache<Calibration>(4);
const histCache = new TtlCache<Bar[]>(200);

async function geckoJson(path: string) {
  const res = await fetch(`https://api.coingecko.com/api/v3${path}`, {
    headers: { Accept: "application/json", "User-Agent": "market-desk/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  return res.json();
}

async function calibration(): Promise<Calibration> {
  return calCache.wrap("cal", (c) => (c.source === "coingecko" ? 6 * 3600e3 : 10 * 60e3), async () => {
    const supplies = new Map(COMPONENTS.map((c) => [c.yahoo, c.supply]));
    try {
      const ids = COMPONENTS.map((c) => c.gecko).join(",");
      const [markets, global] = await Promise.all([
        geckoJson(`/coins/markets?vs_currency=usd&ids=${ids}&per_page=50`),
        geckoJson(`/global`),
      ]);
      let basketCap = 0;
      for (const m of markets as any[]) {
        const comp = COMPONENTS.find((c) => c.gecko === m.id);
        if (comp && m.circulating_supply > 0) supplies.set(comp.yahoo, m.circulating_supply);
        if (comp && m.market_cap > 0) basketCap += m.market_cap;
      }
      const g = global?.data;
      const total = g?.total_market_cap?.usd;
      const pct = g?.market_cap_percentage ?? {};
      let excluded = (pct.btc ?? 0) + (pct.eth ?? 0);
      for (const k of STABLE_KEYS) excluded += pct[k] ?? 0;
      const realCap = total ? total * (1 - excluded / 100) : 0;
      const k = realCap > 0 && basketCap > 0 ? realCap / basketCap : 1;
      return { supplies, k, source: "coingecko" };
    } catch {
      return { supplies, k: 1, source: "fallback" };
    }
  });
}

function bucket(t: number, interval: string) {
  const step = interval.endsWith("m") ? Number(interval.slice(0, -1)) * 60 : interval === "60m" || interval === "1h" ? 3600 : 0;
  return step ? Math.floor(t / step) * step : t;
}

export async function total3esHistory(range: string, interval: string): Promise<{ bars: Bar[]; note: string }> {
  const cal = await calibration();
  const key = `${range}|${interval}`;
  const ttl = interval.endsWith("m") ? 60e3 : 10 * 60e3;
  const bars = await histCache.wrap(key, ttl, async () => {
    const results = await Promise.allSettled(COMPONENTS.map((c) => fetchChart(c.yahoo, range, interval)));
    const ok = results
      .map((r, i) => ({ r, c: COMPONENTS[i] }))
      .filter((x): x is { r: PromiseFulfilledResult<Awaited<ReturnType<typeof fetchChart>>>; c: Component } => x.r.status === "fulfilled" && x.r.value.bars.length > 0);
    if (ok.length < COMPONENTS.length / 2) {
      const firstErr = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      throw firstErr?.reason instanceof UpstreamError ? firstErr.reason : new UpstreamError("Composants TOTAL3ES indisponibles", true);
    }
    // Union des dates, report de la dernière valeur connue par composant.
    const times = new Set<number>();
    const series = ok.map(({ r, c }) => {
      const m = new Map<number, Bar>();
      for (const b of r.value.bars) {
        const t = bucket(b.time, interval);
        m.set(t, b);
        times.add(t);
      }
      return { m, supply: cal.supplies.get(c.yahoo) ?? c.supply };
    });
    const sorted = [...times].sort((a, b) => a - b);
    const lastSeen: (Bar | undefined)[] = series.map(() => undefined);
    const out: Bar[] = [];
    for (const t of sorted) {
      let o = 0, h = 0, l = 0, c = 0, complete = true;
      series.forEach((s, i) => {
        const b = s.m.get(t) ?? (lastSeen[i] ? { ...lastSeen[i]!, open: lastSeen[i]!.close, high: lastSeen[i]!.close, low: lastSeen[i]!.close } : undefined);
        if (s.m.has(t)) lastSeen[i] = s.m.get(t);
        if (!b) { complete = false; return; }
        o += b.open * s.supply; h += b.high * s.supply; l += b.low * s.supply; c += b.close * s.supply;
      });
      if (complete) out.push({ time: t, open: o, high: h, low: l, close: c });
    }
    return out;
  });
  // Recalage du niveau sur la capitalisation réelle actuelle.
  const k = cal.k;
  const scaled = k === 1 ? bars : bars.map((b) => ({ time: b.time, open: b.open * k, high: b.high * k, low: b.low * k, close: b.close * k }));
  const note =
    cal.source === "coingecko"
      ? `Reconstruit à partir de ${COMPONENTS.length} altcoins majeurs, recalé sur la capitalisation réelle CoinGecko (hors BTC, ETH, stablecoins).`
      : `Reconstruit à partir de ${COMPONENTS.length} altcoins majeurs (offre approximative, CoinGecko indisponible) — niveau indicatif, variations fiables.`;
  return { bars: scaled, note };
}

export async function total3esQuote(): Promise<Quote> {
  const cal = await calibration();
  const [quotes, intraday] = await Promise.all([
    Promise.allSettled(COMPONENTS.map((c) => fetchQuote(c.yahoo))),
    total3esHistory("1d", "5m").catch(() => ({ bars: [] as Bar[], note: "" })),
  ]);
  let price = 0, prev = 0, n = 0;
  quotes.forEach((q, i) => {
    if (q.status !== "fulfilled") return;
    const s = cal.supplies.get(COMPONENTS[i].yahoo) ?? COMPONENTS[i].supply;
    price += q.value.price * s;
    prev += q.value.previousClose * s;
    n++;
  });
  if (n < COMPONENTS.length / 2) throw new UpstreamError("TOTAL3ES indisponible", true);
  price *= cal.k;
  prev *= cal.k;
  return {
    symbol: "@TOTAL3ES",
    price,
    previousClose: prev,
    change: price - prev,
    changePct: ((price - prev) / prev) * 100,
    time: Math.floor(Date.now() / 1000),
    currency: "USD",
    spark: intraday.bars.slice(-80).map((b) => b.close),
    demo: false,
  };
}
