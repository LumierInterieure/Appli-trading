import type { Bar } from "../../shared/types.ts";
import type { Drawing, Marker, Pt, ToolOutput, ToolReport } from "./drawings.ts";
import { atr, lastValid, linreg, rsi } from "./indicators.ts";
import { adaptivePivots, type Pivot, type Sensitivity, zigzag } from "./pivots.ts";
import { forecastPaths } from "./stats.ts";

export type ToolId = "fibRetracement" | "fibExtension" | "trendlines" | "supportResistance" | "channel" | "forecast" | "divergences" | "pivotPoints";

export const TOOL_INFO: Record<ToolId, { label: string; short: string; help: string }> = {
  fibRetracement: { label: "Retracement de Fibonacci", short: "Fibo Retr.", help: "Repère automatiquement la dernière impulsion majeure (ZigZag) et trace les niveaux 23,6 / 38,2 / 50 / 61,8 / 78,6 %." },
  fibExtension: { label: "Extension de Fibonacci", short: "Fibo Ext.", help: "Trouve le dernier schéma A-B-C (impulsion puis correction) et projette les objectifs 61,8 / 100 / 127,2 / 161,8 / 261,8 % depuis C." },
  trendlines: { label: "Lignes de tendance", short: "Tendances", help: "Relie les pivots hauts (résistance) et bas (support) les plus récents non cassés, prolongés jusqu'à aujourd'hui." },
  supportResistance: { label: "Supports / Résistances", short: "S/R", help: "Regroupe les pivots en zones touchées plusieurs fois ; affiche les plus proches au-dessus et au-dessous du prix." },
  channel: { label: "Canal de régression", short: "Canal", help: "Régression linéaire sur la période affichée avec bandes à ±1σ et ±2σ." },
  forecast: { label: "Projection statistique", short: "Prévision", help: "Cône de Monte-Carlo (rééchantillonnage des rendements historiques) : médiane et intervalles 50 % / 90 %." },
  divergences: { label: "Divergences RSI", short: "Divergences", help: "Signale les divergences haussières/baissières entre le prix et le RSI(14) sur les pivots récents." },
  pivotPoints: { label: "Points pivots", short: "Pivots", help: "Points pivots classiques (P, R1-R3, S1-S3) calculés sur la bougie précédente de la période supérieure." },
};

const FIB_COLORS: Record<string, string> = {
  "0": "#9598a1", "0.236": "#f23645", "0.382": "#ff9800", "0.5": "#4caf50", "0.618": "#089981",
  "0.786": "#00bcd4", "1": "#9598a1", "1.272": "#2962ff", "1.414": "#7e57c2", "1.618": "#e91e63", "2": "#ab47bc", "2.618": "#f23645", "3.618": "#9c27b0",
};

export interface ToolContext {
  bars: Bar[];
  /** Formatage des valeurs (prix ou %). */
  fmt: (v: number) => string;
  sensitivity: Sensitivity;
  barSeconds: number;
  alwaysOpen: boolean;
  forecastHorizon: number;
}

function pct(r: number) {
  return `${(r * 100).toFixed(1).replace(".0", "")} %`;
}

function hseg(id: string, from: number, to: number, value: number, color: string, label: string, style: "solid" | "dashed" | "dotted" = "solid", autoscale = true): Drawing {
  return { kind: "line", id, points: [{ time: from, value }, { time: to, value }], color, width: 1, style, label, showLabel: true, autoscale };
}

function confirmedPivots(ctx: ToolContext, sens?: Sensitivity) {
  return adaptivePivots(ctx.bars, sens ?? ctx.sensitivity).pivots;
}

// ---------------------------------------------------------------- Fibonacci

export function fibRetracement(ctx: ToolContext): ToolOutput {
  const { bars, fmt } = ctx;
  const piv = confirmedPivots(ctx, ctx.sensitivity === "fine" ? "normal" : "large").filter((p) => p.confirmed);
  let a: { time: number; price: number; index: number }, b: { time: number; price: number; index: number };
  if (piv.length >= 2) {
    // dernière jambe validée : la plus significative parmi les deux dernières
    const legs = [];
    for (let i = Math.max(1, piv.length - 3); i < piv.length; i++) legs.push([piv[i - 1], piv[i]] as const);
    const last = legs[legs.length - 1];
    const biggest = legs.reduce((m, l) => (Math.abs(l[1].price - l[0].price) > Math.abs(m[1].price - m[0].price) * 1.6 ? l : m), last);
    [a, b] = biggest;
  } else {
    let hi = 0, lo = 0;
    bars.forEach((x, i) => { if (x.high > bars[hi].high) hi = i; if (x.low < bars[lo].low) lo = i; });
    const first = Math.min(hi, lo), second = Math.max(hi, lo);
    a = { index: first, time: bars[first].time, price: first === hi ? bars[hi].high : bars[lo].low };
    b = { index: second, time: bars[second].time, price: second === hi ? bars[hi].high : bars[lo].low };
  }
  const up = b.price > a.price;
  const diff = b.price - a.price;
  const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
  const end = bars[bars.length - 1].time;
  const drawings: Drawing[] = [];
  const lines: ToolReport["lines"] = [];
  const last = bars[bars.length - 1].close;
  for (const r of levels) {
    const v = b.price - diff * r;
    const color = FIB_COLORS[String(r)] ?? "#9598a1";
    drawings.push(hseg(`fibR-${r}`, a.time, end, v, color, `Fib ${pct(r)}`, r === 0 || r === 1 ? "solid" : "dashed", r <= 1));
    lines.push({ label: pct(r), value: fmt(v), color });
  }
  drawings.push({ kind: "line", id: "fibR-leg", points: [{ time: a.time, value: a.price }, { time: b.time, value: b.price }], color: "#787b86", width: 1, style: "dotted" });
  const retr = diff !== 0 ? (b.price - last) / diff : 0;
  return {
    drawings,
    reports: [{
      tool: "fibRetracement",
      title: `Retracement Fibonacci (${up ? "impulsion haussière" : "impulsion baissière"})`,
      lines,
      note: `Jambe ${fmt(a.price)} → ${fmt(b.price)}. Le prix actuel retrace ${(retr * 100).toFixed(1)} % de ce mouvement.`,
    }],
  };
}

/**
 * Cherche le schéma A-B-C le plus récent : impulsion A→B, correction B→C
 * (entre minR et maxR de AB), et C non invalidé (le prix n'a pas clôturé
 * au-delà de C depuis).
 */
function findABC(pivots: Pivot[], bars: Bar[], minR = 0.2, maxR = 1.0): [Pivot, Pivot, Pivot] | null {
  const conf = pivots.filter((p) => p.confirmed);
  for (let end = conf.length - 1; end >= 2; end--) {
    const C = conf[end], B = conf[end - 1], A = conf[end - 2];
    const ab = Math.abs(B.price - A.price);
    if (ab <= 0) continue;
    const r = Math.abs(C.price - B.price) / ab;
    if (r < minR || r > maxR) continue;
    const bull = B.price > A.price;
    let valid = true;
    for (let k = C.index + 1; k < bars.length; k++) {
      if (bull ? bars[k].close < C.price : bars[k].close > C.price) { valid = false; break; }
    }
    if (valid) return [A, B, C];
  }
  return null;
}

export function fibExtension(ctx: ToolContext): ToolOutput {
  const { bars, fmt } = ctx;
  let abc: [Pivot, Pivot, Pivot] | null = null;
  const order: Sensitivity[] = ctx.sensitivity === "large" ? ["large", "normal", "fine"] : ctx.sensitivity === "fine" ? ["fine", "normal", "large"] : ["normal", "large", "fine"];
  for (const [minR, maxR] of [[0.2, 1.0], [0.1, 1.6]] as const) {
    for (const s of order) {
      abc = findABC(confirmedPivots(ctx, s), bars, minR, maxR);
      if (abc) break;
    }
    if (abc) break;
  }
  if (!abc) return { drawings: [], reports: [{ tool: "fibExtension", title: "Extension de Fibonacci", lines: [], note: "Pas de schéma A-B-C exploitable sur cette période : élargissez la période ou changez la sensibilité." }] };
  const [A, B, C] = abc;
  const move = B.price - A.price;
  const bull = move > 0;
  const levels = [0, 0.382, 0.618, 1, 1.272, 1.414, 1.618, 2, 2.618];
  const end = bars[bars.length - 1].time;
  const drawings: Drawing[] = [
    { kind: "line", id: "fibE-ab", points: [{ time: A.time, value: A.price }, { time: B.time, value: B.price }], color: "#2962ff", width: 2, style: "solid" },
    { kind: "line", id: "fibE-bc", points: [{ time: B.time, value: B.price }, { time: C.time, value: C.price }], color: "#2962ff", width: 2, style: "dashed" },
    { kind: "markers", id: "fibE-m", markers: [
      { time: A.time, position: A.type === "H" ? "aboveBar" : "belowBar", shape: "circle", color: "#2962ff", text: "A" },
      { time: B.time, position: B.type === "H" ? "aboveBar" : "belowBar", shape: "circle", color: "#2962ff", text: "B" },
      { time: C.time, position: C.type === "H" ? "aboveBar" : "belowBar", shape: "circle", color: "#2962ff", text: "C" },
    ] },
  ];
  const last = bars[bars.length - 1].close;
  const lines: ToolReport["lines"] = [];
  let nextTarget: { r: number; v: number } | null = null;
  for (const r of levels) {
    const v = C.price + move * r;
    const color = FIB_COLORS[String(r)] ?? "#9598a1";
    drawings.push(hseg(`fibE-${r}`, C.time, end, v, color, `Ext ${pct(r)}`, r === 1 || r === 1.618 ? "solid" : "dashed", r <= 1.618));
    const reached = bull ? last >= v : last <= v;
    lines.push({ label: `${pct(r)}${reached ? " ✓" : ""}`, value: fmt(v), color });
    if (!reached && !nextTarget && r > 0) nextTarget = { r, v };
  }
  const retr = Math.abs(C.price - B.price) / Math.abs(move);
  return {
    drawings,
    reports: [{
      tool: "fibExtension",
      title: `Extension de Fibonacci ${bull ? "haussière" : "baissière"} (A-B-C)`,
      lines,
      note: `A ${fmt(A.price)} → B ${fmt(B.price)} → C ${fmt(C.price)} (correction de ${(retr * 100).toFixed(1)} %). ${
        nextTarget ? `Prochain objectif : ${pct(nextTarget.r)} à ${fmt(nextTarget.v)}.` : "Tous les objectifs tracés sont atteints."
      } Invalidation si le prix casse C (${fmt(C.price)}).`,
    }],
  };
}

// ---------------------------------------------------------------- Tendances & niveaux

export function trendlines(ctx: ToolContext): ToolOutput {
  const { bars, fmt } = ctx;
  const piv = confirmedPivots(ctx).filter((p) => p.confirmed);
  const n = bars.length;
  const end = bars[n - 1].time;
  const tol = (lastValid(atr(bars, 14)) ?? 0) * 0.3;
  const drawings: Drawing[] = [];
  const lines: ToolReport["lines"] = [];
  const last = bars[n - 1].close;
  const build = (type: "H" | "L") => {
    const ps = piv.filter((p) => p.type === type).slice(-8);
    // toutes les paires valides (droite non cassée en clôture, hors dernière bougie),
    // puis on garde celle qui est la plus proche du prix actuel et la plus récente
    let best: { p1: Pivot; slope: number; vEnd: number; score: number } | null = null;
    for (let j = ps.length - 1; j >= 1; j--) {
      for (let i = j - 1; i >= 0; i--) {
        const p1 = ps[i], p2 = ps[j];
        const slope = (p2.price - p1.price) / (p2.index - p1.index);
        let ok = true;
        for (let k = p1.index; k < n - 1; k++) {
          const v = p1.price + slope * (k - p1.index);
          if (type === "H" ? bars[k].close > v + tol : bars[k].close < v - tol) { ok = false; break; }
        }
        if (!ok) continue;
        const vEnd = p1.price + slope * (n - 1 - p1.index);
        const unit = tol / 0.3 || Math.abs(last) * 0.01 || 1;
        const score = Math.abs(vEnd - last) / unit + ((n - 1 - p2.index) / n) * 6 + (p2.index - p1.index < 5 ? 3 : 0);
        if (!best || score < best.score) best = { p1, slope, vEnd, score };
      }
    }
    if (!best) return;
    const { p1, slope, vEnd } = best;
    const color = type === "H" ? "#f23645" : "#089981";
    const name = type === "H" ? "Résistance oblique" : "Support oblique";
    drawings.push({ kind: "line", id: `tl-${type}`, points: [{ time: p1.time, value: p1.price }, { time: end, value: vEnd }], color, width: 2, style: "solid", label: name, showLabel: true });
    const dir = slope > 0 ? "montante" : slope < 0 ? "descendante" : "plate";
    const broken = type === "H" ? last > vEnd + tol : last < vEnd - tol;
    lines.push({ label: `${name} (${dir})${broken ? " — CASSÉE" : ""}`, value: fmt(vEnd), color });
  };
  build("H");
  build("L");
  return { drawings, reports: [{ tool: "trendlines", title: "Lignes de tendance automatiques", lines, note: lines.length ? "Valeurs projetées sur la dernière bougie." : "Aucune ligne de tendance valide trouvée." }] };
}

export function supportResistance(ctx: ToolContext): ToolOutput {
  const { bars, fmt } = ctx;
  const a = lastValid(atr(bars, 14)) ?? (bars[bars.length - 1].close * 0.01);
  const piv = zigzag(bars, a * 2.2).filter((p) => p.confirmed);
  const tol = a * 0.8;
  const clusters: { price: number; touches: number; last: number }[] = [];
  for (const p of piv) {
    const c = clusters.find((c) => Math.abs(c.price - p.price) <= tol);
    if (c) {
      c.price = (c.price * c.touches + p.price) / (c.touches + 1);
      c.touches++;
      c.last = Math.max(c.last, p.index);
    } else clusters.push({ price: p.price, touches: 1, last: p.index });
  }
  const last = bars[bars.length - 1].close;
  const n = bars.length;
  const score = (c: (typeof clusters)[number]) => c.touches * 2 + (c.last / n) * 2;
  const strong = clusters.filter((c) => c.touches >= 2 || c.last > n * 0.75);
  const above = strong.filter((c) => c.price > last).sort((x, y) => x.price - y.price).slice(0, 6).sort((x, y) => score(y) - score(x)).slice(0, 3).sort((x, y) => x.price - y.price);
  const below = strong.filter((c) => c.price <= last).sort((x, y) => y.price - x.price).slice(0, 6).sort((x, y) => score(y) - score(x)).slice(0, 3).sort((x, y) => y.price - x.price);
  const drawings: Drawing[] = [];
  const lines: ToolReport["lines"] = [];
  above.forEach((c, i) => {
    drawings.push({ kind: "priceLine", id: `sr-r${i}`, price: c.price, color: "#f23645", title: `R${i + 1} (${c.touches}×)`, style: "dashed", width: 1 });
    lines.push({ label: `R${i + 1} · ${c.touches} contact(s)`, value: `${fmt(c.price)} (${(((c.price - last) / Math.abs(last || 1)) * 100).toFixed(2)} %)`, color: "#f23645" });
  });
  below.forEach((c, i) => {
    drawings.push({ kind: "priceLine", id: `sr-s${i}`, price: c.price, color: "#089981", title: `S${i + 1} (${c.touches}×)`, style: "dashed", width: 1 });
    lines.push({ label: `S${i + 1} · ${c.touches} contact(s)`, value: `${fmt(c.price)} (${(((c.price - last) / Math.abs(last || 1)) * 100).toFixed(2)} %)`, color: "#089981" });
  });
  return { drawings, reports: [{ tool: "supportResistance", title: "Supports et résistances", lines, note: "Zones issues du regroupement des pivots (tolérance 0,8 ATR)." }] };
}

export function regressionChannel(ctx: ToolContext): ToolOutput {
  const { bars, fmt } = ctx;
  const closes = bars.map((b) => b.close);
  const { a, b, sd, r2 } = linreg(closes);
  const mk = (k: number): Pt[] => [{ time: bars[0].time, value: a + k * sd }, { time: bars[bars.length - 1].time, value: a + b * (bars.length - 1) + k * sd }];
  const drawings: Drawing[] = [
    { kind: "line", id: "ch-mid", points: mk(0), color: "#ff9800", width: 1, style: "dashed", label: "Régression", showLabel: true },
    { kind: "line", id: "ch-u1", points: mk(1), color: "rgba(255,152,0,0.45)", width: 1, style: "dotted" },
    { kind: "line", id: "ch-l1", points: mk(-1), color: "rgba(255,152,0,0.45)", width: 1, style: "dotted" },
    { kind: "line", id: "ch-u2", points: mk(2), color: "#ff9800", width: 1, style: "solid", label: "+2σ", showLabel: true, autoscale: true },
    { kind: "line", id: "ch-l2", points: mk(-2), color: "#ff9800", width: 1, style: "solid", label: "−2σ", showLabel: true, autoscale: true },
  ];
  const lastMid = a + b * (bars.length - 1);
  const z = sd ? (closes[closes.length - 1] - lastMid) / sd : 0;
  return {
    drawings,
    reports: [{
      tool: "channel",
      title: "Canal de régression linéaire",
      lines: [
        { label: "+2σ", value: fmt(lastMid + 2 * sd) },
        { label: "Médiane", value: fmt(lastMid) },
        { label: "−2σ", value: fmt(lastMid - 2 * sd) },
        { label: "Position (z-score)", value: z.toFixed(2) },
        { label: "R² (qualité de tendance)", value: r2.toFixed(2) },
      ],
      note: z > 1.5 ? "Prix en haut du canal : extension, risque de retour à la moyenne." : z < -1.5 ? "Prix en bas du canal : survente relative." : "Prix à l'intérieur du canal.",
    }],
  };
}

export function forecastCone(ctx: ToolContext): ToolOutput {
  const { bars, fmt, barSeconds, forecastHorizon, alwaysOpen } = ctx;
  const closes = bars.map((b) => b.close);
  // en mode relatif les valeurs sont des %, on revient en indice base 100 pour la simulation
  const isRelative = closes.some((c) => c <= 0);
  const series = isRelative ? closes.map((c) => 100 + c) : closes;
  const fc = forecastPaths(series, forecastHorizon);
  if (!fc) return { drawings: [], reports: [] };
  const back = (v: number) => (isRelative ? v - 100 : v);
  const t0 = bars[bars.length - 1].time;
  const times: number[] = [t0];
  let t = t0;
  while (times.length <= forecastHorizon) {
    t += barSeconds;
    if (!alwaysOpen && barSeconds >= 86400 && barSeconds < 7 * 86400) {
      const wd = new Date(t * 1000).getUTCDay();
      if (wd === 0 || wd === 6) continue;
    }
    times.push(t);
  }
  const line = (arr: number[]): Pt[] => arr.map((v, i) => ({ time: times[i], value: back(v) }));
  const drawings: Drawing[] = [
    { kind: "line", id: "fc-p50", points: line(fc.p50), color: "#2962ff", width: 2, style: "dashed", label: "Médiane", showLabel: true, autoscale: true },
    { kind: "line", id: "fc-p25", points: line(fc.p25), color: "rgba(41,98,255,0.6)", width: 1, style: "dotted" },
    { kind: "line", id: "fc-p75", points: line(fc.p75), color: "rgba(41,98,255,0.6)", width: 1, style: "dotted" },
    { kind: "line", id: "fc-p05", points: line(fc.p05), color: "rgba(242,54,69,0.8)", width: 1, style: "solid", label: "P5", showLabel: true, autoscale: true },
    { kind: "line", id: "fc-p95", points: line(fc.p95), color: "rgba(8,153,129,0.9)", width: 1, style: "solid", label: "P95", showLabel: true, autoscale: true },
  ];
  const h = forecastHorizon;
  return {
    drawings,
    reports: [{
      tool: "forecast",
      title: `Projection Monte-Carlo (${h} bougies)`,
      lines: [
        { label: "Probabilité de hausse", value: `${(fc.probUp * 100).toFixed(0)} %` },
        { label: "Médiane", value: fmt(back(fc.p50[h])) },
        { label: "Intervalle 50 %", value: `${fmt(back(fc.p25[h]))} – ${fmt(back(fc.p75[h]))}` },
        { label: "Intervalle 90 %", value: `${fmt(back(fc.p05[h]))} – ${fmt(back(fc.p95[h]))}`, color: "#9598a1" },
        { label: "Volatilité utilisée (par bougie)", value: `${(fc.sigma * 100).toFixed(2)} %` },
      ],
      note: "Modèle statistique (rééchantillonnage par blocs des rendements, tendance amortie). Ce n'est pas une prédiction certaine.",
    }],
  };
}

export function rsiDivergences(ctx: ToolContext): ToolOutput {
  const { bars } = ctx;
  const r = rsi(bars.map((b) => b.close), 14);
  const piv = confirmedPivots(ctx, ctx.sensitivity === "large" ? "normal" : "fine").filter((p) => p.confirmed);
  const markers: Marker[] = [];
  const lines: ToolReport["lines"] = [];
  const drawings: Drawing[] = [];
  const check = (type: "H" | "L") => {
    const ps = piv.filter((p) => p.type === type).slice(-8);
    for (let i = 1; i < ps.length; i++) {
      const p1 = ps[i - 1], p2 = ps[i];
      const r1 = r[p1.index], r2 = r[p2.index];
      if (r1 == null || r2 == null) continue;
      const bearish = type === "H" && p2.price > p1.price && r2 < r1 - 2;
      const bullish = type === "L" && p2.price < p1.price && r2 > r1 + 2;
      if (!bearish && !bullish) continue;
      const color = bearish ? "#f23645" : "#089981";
      markers.push({ time: p2.time, position: bearish ? "aboveBar" : "belowBar", shape: bearish ? "arrowDown" : "arrowUp", color, text: bearish ? "Div. baissière" : "Div. haussière" });
      drawings.push({ kind: "line", id: `div-${type}-${i}`, points: [{ time: p1.time, value: p1.price }, { time: p2.time, value: p2.price }], color, width: 1, style: "dashed" });
      lines.push({ label: `${bearish ? "Baissière" : "Haussière"} — ${new Date(p2.time * 1000).toLocaleDateString("fr-FR")}`, value: `RSI ${r1.toFixed(0)} → ${r2.toFixed(0)}`, color });
    }
  };
  check("H");
  check("L");
  markers.sort((a, b) => a.time - b.time);
  if (markers.length) drawings.push({ kind: "markers", id: "div-m", markers });
  return { drawings, reports: [{ tool: "divergences", title: "Divergences RSI(14)", lines, note: lines.length ? "Une divergence signale un essoufflement, pas un retournement confirmé." : "Aucune divergence récente détectée." }] };
}

export function pivotPoints(ctx: ToolContext): ToolOutput {
  const { bars, fmt, barSeconds } = ctx;
  // période supérieure : jour pour l'intraday, semaine pour le journalier, mois au-delà
  const span = barSeconds < 86400 ? 86400 : barSeconds < 7 * 86400 ? 7 * 86400 : 30 * 86400;
  const key = (t: number) => (span === 86400 ? Math.floor(t / 86400) : span === 7 * 86400 ? Math.floor((t / 86400 + 3) / 7) : new Date(t * 1000).getUTCFullYear() * 12 + new Date(t * 1000).getUTCMonth());
  const lastKey = key(bars[bars.length - 1].time);
  const prev = bars.filter((b) => key(b.time) === lastKey - 1);
  const ref = prev.length ? prev : bars.slice(0, -1);
  if (!ref.length) return { drawings: [], reports: [] };
  const H = Math.max(...ref.map((b) => b.high)), L = Math.min(...ref.map((b) => b.low)), C = ref[ref.length - 1].close;
  const P = (H + L + C) / 3;
  const lv = { R3: H + 2 * (P - L), R2: P + (H - L), R1: 2 * P - L, P, S1: 2 * P - H, S2: P - (H - L), S3: L - 2 * (H - P) };
  const drawings: Drawing[] = [];
  const lines: ToolReport["lines"] = [];
  for (const [k, v] of Object.entries(lv)) {
    const color = k === "P" ? "#ff9800" : k.startsWith("R") ? "#f23645" : "#089981";
    drawings.push({ kind: "priceLine", id: `pp-${k}`, price: v, color, title: k, style: "dotted", width: 1 });
    lines.push({ label: k, value: fmt(v), color });
  }
  const name = span === 86400 ? "journaliers" : span === 7 * 86400 ? "hebdomadaires" : "mensuels";
  return { drawings, reports: [{ tool: "pivotPoints", title: `Points pivots ${name}`, lines }] };
}

const RUNNERS: Record<ToolId, (ctx: ToolContext) => ToolOutput> = {
  fibRetracement,
  fibExtension,
  trendlines,
  supportResistance,
  channel: regressionChannel,
  forecast: forecastCone,
  divergences: rsiDivergences,
  pivotPoints,
};

export function runTools(tools: ToolId[], ctx: ToolContext): ToolOutput {
  const out: ToolOutput = { drawings: [], reports: [] };
  if (ctx.bars.length < 10) return out;
  for (const t of tools) {
    try {
      const r = RUNNERS[t](ctx);
      out.drawings.push(...r.drawings);
      out.reports.push(...r.reports);
    } catch (e) {
      console.warn("outil", t, e);
    }
  }
  return out;
}
