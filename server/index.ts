import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ASSETS } from "../shared/assets.ts";
import type { HistoryResponse, Quote } from "../shared/types.ts";
import { aiConfigured, streamAnalysis } from "./ai.ts";
import { mapLimit, TtlCache } from "./cache.ts";
import { demoHistory, demoQuote } from "./demo.ts";
import { total3esHistory, total3esQuote } from "./total3es.ts";
import { fetchChart, fetchQuote, fetchQuotesBatch, searchSymbols, UpstreamError } from "./yahoo.ts";

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

/**
 * Mode démo : forcé (--demo), ou automatique UNIQUEMENT si Yahoo n'a jamais
 * répondu depuis le démarrage (utilisation hors-ligne). Dès que de vraies
 * données ont été reçues, on ne mélange plus jamais avec des données
 * simulées : en cas d'erreur passagère, on resert les dernières valeurs
 * valides.
 */
let everReal = false;
let upstreamDownUntil = 0;
function useDemo() {
  return FORCE_DEMO || (!everReal && Date.now() < upstreamDownUntil);
}
function markOk() {
  everReal = true;
  upstreamDownUntil = 0;
}
function markDown(err: unknown) {
  if (err instanceof UpstreamError && err.network) upstreamDownUntil = Date.now() + 60_000;
}

const historyCache = new TtlCache<HistoryResponse>();
const lastGoodHistory = new Map<string, HistoryResponse>();
const lastGoodQuote = new Map<string, Quote & { at: number }>();

function historyTtl(interval: string) {
  if (interval.endsWith("m")) return 30_000;
  if (interval === "1d") return 5 * 60_000;
  return 30 * 60_000;
}

const SYMBOL_RE = /^[A-Za-z0-9^=.\-@_:]{1,32}$/;

async function getHistory(symbol: string, range: string, interval: string): Promise<HistoryResponse> {
  const key = `${symbol}|${range}|${interval}`;
  const demo = (): HistoryResponse => ({ symbol, range, interval, bars: demoHistory(symbol, range, interval), demo: true });
  if (useDemo()) return demo();
  try {
    // TOTAL3ES a son propre cache (non recalé) : il est recalé à chaque appel avec le même
    // facteur que sa cotation, pour que l'historique et le prix en direct restent cohérents.
    const h =
      symbol === "@TOTAL3ES"
        ? await total3esHistory(range, interval).then(({ bars, note }): HistoryResponse => ({ symbol, range, interval, bars, demo: false, note, currency: "USD" }))
        : await historyCache.wrap(key, historyTtl(interval), async () => {
            const { bars, meta } = await fetchChart(symbol, range, interval);
            return { symbol, range, interval, bars, demo: false, currency: meta.currency };
          });
    markOk();
    lastGoodHistory.set(key, h);
    return h;
  } catch (err) {
    markDown(err);
    const stale = lastGoodHistory.get(key);
    if (stale) return { ...stale, stale: true };
    if (err instanceof UpstreamError && !err.network) throw err;
    if (!everReal) return demo();
    throw err;
  }
}

const QUOTE_TTL = 10_000;
let quotesInflight: Promise<void> | null = null;
const wanted = new Set<string>();

/** Rafraîchit en un minimum d'appels groupés toutes les cotations demandées et périmées. */
async function refreshQuotes(symbols: string[]) {
  for (const s of symbols) wanted.add(s);
  // un seul rafraîchissement groupé à la fois ; les appels concurrents l'attendent
  while (quotesInflight) await quotesInflight;
  const now = Date.now();
  const stale = [...wanted].filter((s) => {
    const q = lastGoodQuote.get(s);
    return !q || now - q.at > (s === "@TOTAL3ES" ? 30_000 : QUOTE_TTL);
  });
  wanted.clear();
  if (!stale.length) return;
  quotesInflight = (async () => {
    const regular = stale.filter((s) => s !== "@TOTAL3ES");
    const jobs: Promise<unknown>[] = [];
    if (regular.length) {
      jobs.push(
        fetchQuotesBatch(regular).then((m) => {
          markOk();
          for (const [s, q] of m) lastGoodQuote.set(s, { ...q, at: Date.now() });
        }),
      );
    }
    if (stale.includes("@TOTAL3ES")) {
      jobs.push(total3esQuote().then((q) => { markOk(); lastGoodQuote.set("@TOTAL3ES", { ...q, at: Date.now() }); }));
    }
    const results = await Promise.allSettled(jobs);
    for (const r of results) if (r.status === "rejected") markDown(r.reason);
    // symboles absents de la réponse groupée (rare) : appel individuel
    const missing = regular.filter((s) => !lastGoodQuote.has(s));
    await mapLimit(missing, 2, async (s) => {
      try {
        const q = await fetchQuote(s);
        markOk();
        lastGoodQuote.set(s, { ...q, at: Date.now() });
      } catch (err) {
        markDown(err);
      }
    });
  })().finally(() => { quotesInflight = null; });
  await quotesInflight;
}

async function getQuotes(symbols: string[]): Promise<(Quote | { symbol: string; error: string })[]> {
  if (useDemo()) return symbols.map((s) => demoQuote(s));
  await refreshQuotes(symbols);
  if (useDemo()) return symbols.map((s) => demoQuote(s));
  const now = Date.now();
  return symbols.map((s) => {
    const q = lastGoodQuote.get(s);
    if (!q) return { symbol: s, error: "Cotation indisponible" };
    const { at, ...quote } = q;
    return now - at > 60_000 ? { ...quote, stale: true } : quote;
  });
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
  const quotes = await getQuotes(symbols);
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
