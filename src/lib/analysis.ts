import type { AssetDef, Bar, Quote } from "../../shared/types.ts";
import { fmtPct, fmtPrice } from "./format.ts";
import { lastValid, macd, rsi, sma } from "./indicators.ts";
import { adaptivePivots } from "./pivots.ts";
import { annualizedVol, correlation, forecastPaths, logReturns, maxDrawdown, PERF_PERIODS, type PerfPeriod, periodChange, stdev } from "./stats.ts";

export interface UniverseEntry {
  asset: AssetDef;
  bars: Bar[]; // journalier
  quote?: Quote;
  demo?: boolean;
}

export interface Signal {
  assetId: string;
  short: string;
  type: "haussier" | "baissier" | "info";
  text: string;
}

export interface AssetDiag {
  id: string;
  name: string;
  short: string;
  core: boolean;
  price: number;
  perf: Partial<Record<PerfPeriod, number | null>>;
  sma50: number | null;
  sma200: number | null;
  rsi: number | null;
  macdHist: number | null;
  vol20: number;
  volRank: number; // percentile 0-100 de la vol 20j sur l'historique
  fromHigh: number;
  high52: number;
  low52: number;
  trend: "haussière" | "baissière" | "neutre";
  score: number; // -100..100
  bias: "Haussier" | "Baissier" | "Neutre";
  support?: number;
  resistance?: number;
  forecast?: { days: number; p05: number; p50: number; p95: number; probUp: number };
  notes: string[];
}

export interface MarketReport {
  generatedAt: number;
  demo: boolean;
  regime: { score: number; label: string; drivers: string[] };
  assets: AssetDiag[];
  correlations: { ids: string[]; labels: string[]; matrix: (number | null)[][] };
  curve?: { us10y: number; us3m: number; spread: number; spread3mAgo?: number };
  signals: Signal[];
}

function volPercentile(bars: Bar[]): number {
  const closes = bars.map((b) => b.close);
  const r = logReturns(closes);
  if (r.length < 120) return 50;
  const vols: number[] = [];
  for (let i = 20; i <= r.length; i += 5) vols.push(stdev(r.slice(i - 20, i)));
  const cur = stdev(r.slice(-20));
  const below = vols.filter((v) => v < cur).length;
  return Math.round((below / vols.length) * 100);
}

export function diagnose(entry: UniverseEntry): AssetDiag | null {
  const { asset, bars, quote } = entry;
  if (bars.length < 30) return null;
  const closes = bars.map((b) => b.close);
  const price = quote?.price ?? closes[closes.length - 1];
  const ppy = asset.alwaysOpen ? 365 : 252;
  const s50 = lastValid(sma(closes, 50));
  const s200 = lastValid(sma(closes, 200));
  const r = lastValid(rsi(closes, 14));
  const m = macd(closes);
  const mh = lastValid(m.hist);
  const perf: AssetDiag["perf"] = {};
  for (const p of PERF_PERIODS) perf[p.id] = periodChange(bars, p.id, quote?.price, quote?.previousClose);
  const last252 = bars.slice(-ppy);
  const high52 = Math.max(...last252.map((b) => b.high));
  const low52 = Math.min(...last252.map((b) => b.low));
  const { fromHigh } = maxDrawdown(last252);
  const vol20 = annualizedVol(bars, 20, ppy);

  let sc = 0;
  const notes: string[] = [];
  if (s50 != null) sc += price > s50 ? 1 : -1;
  if (s200 != null) sc += price > s200 ? 1.5 : -1.5;
  if (s50 != null && s200 != null) sc += s50 > s200 ? 1 : -1;
  if (r != null) sc += r > 60 ? 0.75 : r < 40 ? -0.75 : 0;
  if (mh != null) sc += mh > 0 ? 0.5 : -0.5;
  const p3 = perf["3M"];
  if (p3 != null) sc += p3 > 0 ? 0.75 : -0.75;
  const score = Math.round((sc / 5.5) * 100);
  const trend = score > 30 ? "haussière" : score < -30 ? "baissière" : "neutre";

  if (r != null && r > 70) notes.push(`RSI en surachat (${r.toFixed(0)})`);
  if (r != null && r < 30) notes.push(`RSI en survente (${r.toFixed(0)})`);
  if (s200 != null) notes.push(`${price > s200 ? "au-dessus" : "sous"} la MM200 (${fmtPct((price / s200 - 1) * 100, 1)})`);
  if (fromHigh > -2) notes.push("proche du plus haut 52 semaines");
  else if (fromHigh < -20) notes.push(`à ${fmtPct(fromHigh, 1)} du plus haut 52 semaines`);

  // niveaux : pivots les plus proches
  const { pivots } = adaptivePivots(bars.slice(-260), "normal");
  const conf = pivots.filter((p) => p.confirmed);
  const resistance = conf.filter((p) => p.price > price).sort((a, b) => a.price - b.price)[0]?.price;
  const support = conf.filter((p) => p.price < price).sort((a, b) => b.price - a.price)[0]?.price;

  const days = asset.alwaysOpen ? 30 : 21;
  const fc = forecastPaths(closes, days, 1200);
  const forecast = fc ? { days, p05: fc.p05[days], p50: fc.p50[days], p95: fc.p95[days], probUp: fc.probUp } : undefined;

  const prob = forecast?.probUp ?? 0.5;
  const combined = score / 100 * 0.7 + (prob - 0.5) * 2 * 0.3;
  const bias = combined > 0.2 ? "Haussier" : combined < -0.2 ? "Baissier" : "Neutre";

  return {
    id: asset.id, name: asset.name, short: asset.short, core: !!asset.core, price, perf,
    sma50: s50, sma200: s200, rsi: r, macdHist: mh, vol20, volRank: volPercentile(bars), fromHigh, high52, low52,
    trend, score, bias, support, resistance, forecast, notes,
  };
}

function detectSignals(entry: UniverseEntry): Signal[] {
  const { asset, bars } = entry;
  const out: Signal[] = [];
  if (bars.length < 210) return out;
  const closes = bars.map((b) => b.close);
  const s50 = sma(closes, 50), s200 = sma(closes, 200);
  const n = closes.length;
  const lookback = 5;
  for (let i = n - lookback; i < n; i++) {
    if (s50[i] == null || s200[i] == null || s50[i - 1] == null || s200[i - 1] == null) continue;
    if (s50[i - 1]! <= s200[i - 1]! && s50[i]! > s200[i]!) out.push({ assetId: asset.id, short: asset.short, type: "haussier", text: "Golden cross (MM50 croise au-dessus de la MM200)" });
    if (s50[i - 1]! >= s200[i - 1]! && s50[i]! < s200[i]!) out.push({ assetId: asset.id, short: asset.short, type: "baissier", text: "Death cross (MM50 croise sous la MM200)" });
  }
  const s200l = s200[n - 1], s200p = s200[n - 2];
  if (s200l != null && s200p != null) {
    if (closes[n - 2] < s200p && closes[n - 1] > s200l) out.push({ assetId: asset.id, short: asset.short, type: "haussier", text: "Reprise au-dessus de la MM200" });
    if (closes[n - 2] > s200p && closes[n - 1] < s200l) out.push({ assetId: asset.id, short: asset.short, type: "baissier", text: "Passage sous la MM200" });
  }
  const r = rsi(closes, 14);
  const rl = r[n - 1];
  if (rl != null && rl > 75) out.push({ assetId: asset.id, short: asset.short, type: "info", text: `RSI très élevé (${rl.toFixed(0)}) — risque de consolidation` });
  if (rl != null && rl < 25) out.push({ assetId: asset.id, short: asset.short, type: "info", text: `RSI très bas (${rl.toFixed(0)}) — rebond technique possible` });
  const ppy = asset.alwaysOpen ? 365 : 252;
  const prevYear = bars.slice(-ppy, -1);
  if (prevYear.length > 100) {
    const hi = Math.max(...prevYear.map((b) => b.high));
    const lo = Math.min(...prevYear.map((b) => b.low));
    if (closes[n - 1] > hi) out.push({ assetId: asset.id, short: asset.short, type: "haussier", text: "Nouveau plus haut 52 semaines" });
    if (closes[n - 1] < lo) out.push({ assetId: asset.id, short: asset.short, type: "baissier", text: "Nouveau plus bas 52 semaines" });
  }
  const ret = closes[n - 1] / closes[n - 2] - 1;
  const sd = stdev(logReturns(closes.slice(-61, -1)));
  if (sd > 0 && Math.abs(ret) > 3 * sd) out.push({ assetId: asset.id, short: asset.short, type: ret > 0 ? "haussier" : "baissier", text: `Mouvement inhabituel du jour (${fmtPct(ret * 100)} ≈ ${(Math.abs(ret) / sd).toFixed(1)}σ)` });
  return out;
}

export function buildReport(universe: UniverseEntry[]): MarketReport {
  const diags = universe.map(diagnose).filter((d): d is AssetDiag => d !== null);
  const by = new Map(diags.map((d) => [d.id, d]));
  const drivers: string[] = [];
  let score = 0;
  const add = (v: number, text: string) => { score += v; drivers.push(`${v > 0 ? "▲" : v < 0 ? "▼" : "•"} ${text}`); };

  const spx = by.get("spx");
  if (spx) {
    if (spx.sma200 != null) add(spx.price > spx.sma200 ? 1 : -1, `S&P 500 ${spx.price > spx.sma200 ? "au-dessus" : "sous"} sa MM200`);
    if (spx.perf["1M"] != null) add(spx.perf["1M"]! > 0 ? 0.5 : -0.5, `S&P 500 ${fmtPct(spx.perf["1M"])} sur 1 mois`);
  }
  const ndx = by.get("ndx") ?? by.get("nasdaq");
  if (ndx?.perf["1M"] != null && spx?.perf["1M"] != null) {
    const rel = ndx.perf["1M"]! - spx.perf["1M"]!;
    if (Math.abs(rel) > 1) add(rel > 0 ? 0.5 : -0.5, `Tech ${rel > 0 ? "surperforme" : "sous-performe"} le S&P de ${fmtPct(Math.abs(rel), 1, false)} sur 1 mois`);
  }
  const vix = by.get("vix");
  if (vix) {
    const v = vix.price;
    add(v < 15 ? 1 : v < 20 ? 0.25 : v < 28 ? -1 : -2, `VIX à ${v.toFixed(1)} (${v < 15 ? "complaisance" : v < 20 ? "calme" : v < 28 ? "stress" : "panique"})`);
  }
  const dxy = by.get("dxy");
  if (dxy?.perf["1M"] != null) {
    const p = dxy.perf["1M"]!;
    if (Math.abs(p) > 1) add(p > 0 ? -0.75 : 0.75, `Dollar (DXY) ${fmtPct(p, 1)} sur 1 mois (${p > 0 ? "resserrement des conditions financières" : "assouplissement"})`);
    else drivers.push(`• Dollar stable (${fmtPct(p, 1)} sur 1 mois)`);
  }
  const tnx = by.get("us10y");
  const bars10 = universe.find((u) => u.asset.id === "us10y")?.bars;
  if (tnx && bars10 && bars10.length > 25) {
    const bp = (tnx.price - bars10[bars10.length - 22].close) * 100;
    if (Math.abs(bp) > 15) add(bp > 0 ? -0.75 : 0.5, `Taux 10 ans US ${bp > 0 ? "+" : ""}${bp.toFixed(0)} pb sur 1 mois (${tnx.price.toFixed(2)} %)`);
    else drivers.push(`• Taux 10 ans US stable à ${tnx.price.toFixed(2)} % (${bp > 0 ? "+" : ""}${bp.toFixed(0)} pb / 1 mois)`);
  }
  const btc = by.get("btc");
  if (btc?.sma200 != null) add(btc.price > btc.sma200 ? 0.5 : -0.5, `Bitcoin ${btc.price > btc.sma200 ? "au-dessus" : "sous"} sa MM200`);
  const t3 = by.get("total3es");
  if (t3?.perf["1M"] != null && btc?.perf["1M"] != null) {
    const rel = t3.perf["1M"]! - btc.perf["1M"]!;
    if (Math.abs(rel) > 3) add(rel > 0 ? 0.5 : -0.25, `Altcoins (TOTAL3ES) ${rel > 0 ? "surperforment" : "sous-performent"} BTC de ${fmtPct(Math.abs(rel), 1, false)} sur 1 mois (${rel > 0 ? "appétit pour le risque élevé" : "fuite vers la qualité dans la crypto"})`);
  }
  const brent = by.get("brent");
  if (brent?.perf["1M"] != null && Math.abs(brent.perf["1M"]!) > 8) add(brent.perf["1M"]! > 0 ? -0.5 : 0.25, `Brent ${fmtPct(brent.perf["1M"], 1)} sur 1 mois (${brent.perf["1M"]! > 0 ? "risque inflationniste" : "détente sur l'énergie"})`);
  const gold = by.get("gold"), copper = by.get("copper");
  if (gold?.perf["3M"] != null && copper?.perf["3M"] != null) {
    const rel = copper.perf["3M"]! - gold.perf["3M"]!;
    if (Math.abs(rel) > 4) add(rel > 0 ? 0.5 : -0.5, `Ratio cuivre/or ${rel > 0 ? "en hausse" : "en baisse"} sur 3 mois (${rel > 0 ? "anticipations de croissance" : "prudence sur la croissance"})`);
  }
  const rut = by.get("rut");
  if (rut?.perf["3M"] != null && spx?.perf["3M"] != null) {
    const rel = rut.perf["3M"]! - spx.perf["3M"]!;
    if (Math.abs(rel) > 3) add(rel > 0 ? 0.5 : -0.25, `Small caps ${rel > 0 ? "surperforment" : "sous-performent"} sur 3 mois (largeur de marché ${rel > 0 ? "saine" : "étroite"})`);
  }

  let curve: MarketReport["curve"];
  const irx = by.get("us3m");
  const barsIrx = universe.find((u) => u.asset.id === "us3m")?.bars;
  if (tnx && irx) {
    const spread = tnx.price - irx.price;
    let spread3mAgo: number | undefined;
    if (bars10 && barsIrx && bars10.length > 70 && barsIrx.length > 70) spread3mAgo = bars10[bars10.length - 64].close - barsIrx[barsIrx.length - 64].close;
    curve = { us10y: tnx.price, us3m: irx.price, spread, spread3mAgo };
    if (spread < 0) drivers.push(`• Courbe des taux inversée (10A − 3M = ${(spread * 100).toFixed(0)} pb) : signal récessif historique`);
    else if (spread3mAgo != null && spread3mAgo < 0) drivers.push(`• Courbe des taux en ré-pentification après inversion (${(spread * 100).toFixed(0)} pb) : phase souvent volatile`);
    else drivers.push(`• Courbe des taux positive (10A − 3M = ${(spread * 100).toFixed(0)} pb)`);
  }

  const label = score >= 2 ? "Risk-on" : score >= 0.75 ? "Plutôt risk-on" : score <= -2 ? "Risk-off" : score <= -0.75 ? "Plutôt risk-off" : "Neutre / mixte";

  // corrélations 90j entre actifs principaux
  const corrIds = ["spx", "nasdaq", "btc", "total3es", "dxy", "us10y", "brent", "gold", "msciworld", "vix", "eth"].filter((id) => universe.some((u) => u.asset.id === id && u.bars.length > 30));
  const entries = corrIds.map((id) => universe.find((u) => u.asset.id === id)!);
  const matrix = entries.map((a) => entries.map((b) => (a === b ? 1 : correlation(a.bars, b.bars, 90))));

  const signals = universe.flatMap(detectSignals);

  return {
    generatedAt: Date.now(),
    demo: universe.some((u) => u.demo),
    regime: { score: Math.round(score * 100) / 100, label, drivers },
    assets: diags,
    correlations: { ids: corrIds, labels: entries.map((e) => e.asset.short), matrix },
    curve,
    signals,
  };
}

/** Rapport rédigé (Markdown) à partir du diagnostic local. */
export function reportMarkdown(rep: MarketReport, assets: Map<string, AssetDef>, focus: string[] = []): string {
  const L: string[] = [];
  L.push(`## Régime de marché : ${rep.regime.label} (score ${rep.regime.score > 0 ? "+" : ""}${rep.regime.score})`);
  if (rep.demo) L.push("> ⚠️ Données de démonstration (simulées) : l'analyse est illustrative.");
  L.push(...rep.regime.drivers.map((d) => `- ${d}`));
  L.push("");
  // corrélations notables
  const notable: string[] = [];
  const { ids, labels, matrix } = rep.correlations;
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const c = matrix[i][j];
      if (c != null && Math.abs(c) >= 0.5) notable.push(`${labels[i]} / ${labels[j]} : ${c > 0 ? "+" : ""}${c.toFixed(2)}`);
    }
  if (notable.length) {
    L.push("## Liens inter-marchés (corrélation 90 jours)");
    L.push(notable.slice(0, 10).map((n) => `- ${n}`).join("\n"));
    L.push("");
  }
  L.push("## Tableau de bord");
  L.push("| Actif | Prix | 1S | 1M | 3M | YTD | Tendance | RSI | Biais |");
  L.push("|---|---:|---:|---:|---:|---:|---|---:|---|");
  const ordered = [...rep.assets].sort((a, b) => Number(b.core) - Number(a.core));
  for (const d of ordered.slice(0, 22)) {
    const a = assets.get(d.id);
    L.push(`| ${d.short} | ${fmtPrice(d.price, a)} | ${fmtPct(d.perf["1W"], 1)} | ${fmtPct(d.perf["1M"], 1)} | ${fmtPct(d.perf["3M"], 1)} | ${fmtPct(d.perf.YTD, 1)} | ${d.trend} | ${d.rsi?.toFixed(0) ?? "—"} | **${d.bias}** |`);
  }
  L.push("");
  const focusDiags = (focus.length ? focus : rep.assets.filter((d) => d.core).map((d) => d.id)).map((id) => rep.assets.find((d) => d.id === id)).filter((d): d is AssetDiag => !!d);
  if (focusDiags.length) {
    L.push("## Prévisions à ~1 mois (statistiques + technique)");
    L.push("| Actif | Biais | P(hausse) | Médiane | Fourchette 90 % | Support | Résistance |");
    L.push("|---|---|---:|---:|---|---:|---:|");
    for (const d of focusDiags) {
      const a = assets.get(d.id);
      const f = d.forecast;
      L.push(`| ${d.short} | **${d.bias}** (score ${d.score > 0 ? "+" : ""}${d.score}) | ${f ? `${(f.probUp * 100).toFixed(0)} %` : "—"} | ${f ? fmtPrice(f.p50, a) : "—"} | ${f ? `${fmtPrice(f.p05, a)} – ${fmtPrice(f.p95, a)}` : "—"} | ${fmtPrice(d.support, a)} | ${fmtPrice(d.resistance, a)} |`);
    }
    L.push("");
    L.push("### Lecture par actif");
    for (const d of focusDiags) {
      const a = assets.get(d.id);
      const parts = [`tendance ${d.trend}`, ...d.notes];
      parts.push(`volatilité 20j ${d.vol20.toFixed(0)} % (percentile ${d.volRank})`);
      L.push(`- **${d.name}** (${fmtPrice(d.price, a)}) : ${parts.join(", ")}.${d.resistance ? ` Résistance ${fmtPrice(d.resistance, a)}` : ""}${d.support ? `, support ${fmtPrice(d.support, a)}` : ""}.`);
    }
    L.push("");
  }
  if (rep.signals.length) {
    L.push("## Signaux détectés automatiquement");
    for (const s of rep.signals) L.push(`- ${s.type === "haussier" ? "🟢" : s.type === "baissier" ? "🔴" : "🔵"} **${s.short}** — ${s.text}`);
    L.push("");
  }
  L.push("_Analyse automatique fondée sur des indicateurs techniques et des simulations statistiques ; ce n'est pas un conseil en investissement._");
  return L.join("\n");
}

/** Instantané compact envoyé à Claude. */
export function snapshotForAI(rep: MarketReport) {
  const r = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
  return {
    demo: rep.demo,
    regime: rep.regime,
    yieldCurve: rep.curve ? { us10y: r(rep.curve.us10y), us3m: r(rep.curve.us3m), spread10y3m: r(rep.curve.spread), spread3mAgo: r(rep.curve.spread3mAgo) } : null,
    assets: rep.assets.map((d) => ({
      id: d.id, name: d.name, core: d.core, price: r(d.price, 4),
      perfPct: Object.fromEntries(Object.entries(d.perf).map(([k, v]) => [k, r(v, 1)])),
      sma50: r(d.sma50, 4), sma200: r(d.sma200, 4), rsi14: r(d.rsi, 0), macdHist: r(d.macdHist, 4),
      vol20Ann: r(d.vol20, 1), volPercentile: d.volRank, fromHigh52wPct: r(d.fromHigh, 1), high52w: r(d.high52, 4), low52w: r(d.low52, 4),
      trendScore: d.score, bias: d.bias, nearestSupport: r(d.support, 4), nearestResistance: r(d.resistance, 4),
      monteCarlo: d.forecast ? { horizonDays: d.forecast.days, p05: r(d.forecast.p05, 4), median: r(d.forecast.p50, 4), p95: r(d.forecast.p95, 4), probUp: r(d.forecast.probUp, 2) } : null,
    })),
    correlations90d: Object.fromEntries(
      rep.correlations.ids.map((id, i) => [id, Object.fromEntries(rep.correlations.ids.map((id2, j) => [id2, r(rep.correlations.matrix[i][j], 2)]).filter(([k]) => k !== id))]),
    ),
    signals: rep.signals.map((s) => `${s.short}: ${s.text}`),
  };
}
