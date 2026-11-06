import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ASSETS } from "../shared/assets.ts";
import type { HistoryResponse, Quote } from "../shared/types.ts";
import { aiConfigured, streamAnalysis } from "./ai.ts";
import { mapLimit, TtlCache } from "./cache.ts";
import { demoHistory, demoQuote } from "./demo.ts";
import { total3esHistory, total3esQuote } from "./total3es.ts";
import { fetchChart, fetchQuote, searchSymbols, UpstreamError } from "./yahoo.ts";

try {
  process.loadEnvFile();
} catch {
  /* pas de .env : ok */
}

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const FORCE_DEMO = process.env.DEMO === "1" || process.env.DEMO === "true" || process.argv.includes("--demo");
/** Mode production : sert aussi l'interface compilée (dossier dist). */
const PROD = process.env.NODE_ENV === "production" || process.argv.includes("--prod");

/** Si le fournisseur est injoignable, on bascule en démo pendant un moment. */
let upstreamDownUntil = 0;
function useDemo() {
  return FORCE_DEMO || Date.now() < upstreamDownUntil;
}
function markDown(err: unknown) {
  if (err instanceof UpstreamError && err.network) upstreamDownUntil = Date.now() + 60_000;
}

const historyCache = new TtlCache<HistoryResponse>();
const quoteCache = new TtlCache<Quote>();

function historyTtl(interval: string) {
  if (interval.endsWith("m")) return 30_000;
  if (interval === "1d") return 5 * 60_000;
  return 30 * 60_000;
}

const SYMBOL_RE = /^[A-Za-z0-9^=.\-@_:]{1,32}$/;

async function getHistory(symbol: string, range: string, interval: string): Promise<HistoryResponse> {
  const demo = (): HistoryResponse => ({ symbol, range, interval, bars: demoHistory(symbol, range, interval), demo: true });
  if (useDemo()) return demo();
  try {
    return await historyCache.wrap(`${symbol}|${range}|${interval}`, historyTtl(interval), async () => {
      if (symbol === "@TOTAL3ES") {
        const { bars, note } = await total3esHistory(range, interval);
        return { symbol, range, interval, bars, demo: false, note, currency: "USD" };
      }
      const { bars, meta } = await fetchChart(symbol, range, interval);
      return { symbol, range, interval, bars, demo: false, currency: meta.currency };
    });
  } catch (err) {
    markDown(err);
    if (err instanceof UpstreamError && !err.network) throw err;
    return demo();
  }
}

async function getQuote(symbol: string): Promise<Quote> {
  if (useDemo()) return demoQuote(symbol);
  try {
    return await quoteCache.wrap(symbol, symbol === "@TOTAL3ES" ? 30_000 : 10_000, () =>
      symbol === "@TOTAL3ES" ? total3esQuote() : fetchQuote(symbol),
    );
  } catch (err) {
    markDown(err);
    if (err instanceof UpstreamError && !err.network) throw err;
    return demoQuote(symbol);
  }
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/status", (_req, res) => {
  res.json({ demo: useDemo(), forcedDemo: FORCE_DEMO, ai: aiConfigured(), assets: ASSETS.length });
});

app.get("/api/history", async (req, res) => {
  const symbol = String(req.query.symbol ?? "");
  const range = String(req.query.range ?? "1y");
  const interval = String(req.query.interval ?? "1d");
  if (!SYMBOL_RE.test(symbol) || !/^[a-z0-9]{1,5}$/.test(range) || !/^[a-z0-9]{1,4}$/.test(interval)) {
    return res.status(400).json({ error: "Paramètres invalides" });
  }
  try {
    res.json(await getHistory(symbol, range, interval));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Erreur" });
  }
});

app.get("/api/quotes", async (req, res) => {
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => SYMBOL_RE.test(s))
    .slice(0, 80);
  const quotes = await mapLimit(symbols, 8, async (s) => {
    try {
      return await getQuote(s);
    } catch (err) {
      return { symbol: s, error: err instanceof Error ? err.message : "Erreur" };
    }
  });
  res.json({ quotes, demo: useDemo() });
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q ?? "").slice(0, 40).trim();
  if (!q) return res.json({ results: [] });
  const local = ASSETS.filter((a) => (a.name + " " + a.symbol + " " + (a.aliases ?? []).join(" ")).toLowerCase().includes(q.toLowerCase())).map((a) => ({
    symbol: a.symbol,
    name: a.name,
    exchange: "catalogue",
    type: a.category,
  }));
  if (useDemo()) return res.json({ results: local.length ? local : [{ symbol: q.toUpperCase(), name: `${q.toUpperCase()} (démo)`, type: "démo" }] });
  try {
    const remote = await searchSymbols(q);
    res.json({ results: [...local, ...remote.filter((r) => !local.some((l) => l.symbol === r.symbol))] });
  } catch (err) {
    markDown(err);
    res.json({ results: local });
  }
});

app.post("/api/ai/analyze", async (req, res) => {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  await streamAnalysis(req.body ?? {}, res, controller.signal);
});

if (PROD) {
  const dist = path.resolve(here, "../dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  const mode = FORCE_DEMO ? " (mode DÉMO forcé)" : "";
  console.log(`API marché prête sur http://localhost:${PORT}${mode}`);
  if (PROD) console.log(`Application : http://localhost:${PORT}`);
  if (!aiConfigured()) console.log("Astuce : ajoutez ANTHROPIC_API_KEY dans .env pour activer l'analyse par Claude.");
});
