import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "../shared/types.ts";
import { zigzag } from "../src/lib/pivots.ts";
import { fibExtension, fibRetracement, runTools, supportResistance } from "../src/lib/tools.ts";
import { forecastPaths, periodChange } from "../src/lib/stats.ts";
import { rsi, sma } from "../src/lib/indicators.ts";

/** Série construite à la main : 0→100 (A→B), 100→70 (C), puis reprise vers 90. */
function abcSeries(): Bar[] {
  const pts: number[] = [];
  for (let i = 0; i <= 50; i++) pts.push(10 + (90 * i) / 50); // A=10 → B=100
  for (let i = 1; i <= 20; i++) pts.push(100 - (30 * i) / 20); // → C=70
  for (let i = 1; i <= 15; i++) pts.push(70 + (20 * i) / 15); // → 90
  return pts.map((p, i) => ({ time: 1_700_000_000 + i * 86400, open: p, high: p + 0.5, low: p - 0.5, close: p }));
}

const ctx = (bars: Bar[]) => ({ bars, fmt: (v: number) => v.toFixed(2), sensitivity: "normal" as const, barSeconds: 86400, alwaysOpen: true, forecastHorizon: 10 });

test("zigzag repère A, B, C", () => {
  const piv = zigzag(abcSeries(), 10);
  const conf = piv.filter((p) => p.confirmed);
  assert.equal(conf[0].type, "L");
  assert.ok(Math.abs(conf[0].price - 9.5) < 1e-9);
  assert.equal(conf[1].type, "H");
  assert.ok(Math.abs(conf[1].price - 100.5) < 1e-9);
  assert.equal(conf[2].type, "L");
  assert.ok(Math.abs(conf[2].price - 69.5) < 1e-9);
});

test("extension de Fibonacci placée depuis C avec la longueur AB", () => {
  const out = fibExtension(ctx(abcSeries()));
  const ext100 = out.drawings.find((d) => d.kind === "line" && d.id === "fibE-1");
  assert.ok(ext100 && ext100.kind === "line");
  // C (69.5) + (B - A) (100.5 - 9.5 = 91) = 160.5
  assert.ok(Math.abs(ext100.points[0].value - 160.5) < 1e-6, String(ext100.points[0].value));
  const ext618 = out.drawings.find((d) => d.kind === "line" && d.id === "fibE-0.618");
  assert.ok(ext618 && ext618.kind === "line" && Math.abs(ext618.points[0].value - (69.5 + 91 * 0.618)) < 1e-6);
  assert.match(out.reports[0].title, /haussière/);
});

test("retracement de Fibonacci sur la dernière jambe validée", () => {
  const out = fibRetracement(ctx(abcSeries()));
  const r618 = out.drawings.find((d) => d.kind === "line" && d.id === "fibR-0.618");
  assert.ok(r618 && r618.kind === "line");
  const v = r618.points[0].value;
  // jambe A→B (la plus grande) : 100.5 - 0.618 × 91
  assert.ok(Math.abs(v - (100.5 - 0.618 * 91)) < 1e-6, String(v));
});

test("tous les outils s'exécutent sans erreur", () => {
  const out = runTools(["fibRetracement", "fibExtension", "trendlines", "supportResistance", "channel", "forecast", "divergences", "pivotPoints"], ctx(abcSeries()));
  assert.ok(out.reports.length >= 6);
  assert.ok(supportResistance(ctx(abcSeries())).reports.length === 1);
});

test("indicateurs de base", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const r = rsi(Array.from({ length: 30 }, (_, i) => i), 14);
  assert.equal(r[29], 100);
});

test("variation sur période et projection", () => {
  const bars = abcSeries();
  const ch = periodChange(bars, "1M");
  // il y a un mois : en pleine correction (~94) ; aujourd'hui 90
  assert.ok(ch != null && ch < 0 && ch > -10, String(ch));
  const fc = forecastPaths(bars.map((b) => b.close), 10, 500);
  assert.ok(fc);
  assert.ok(fc.p05[10] < fc.p50[10] && fc.p50[10] < fc.p95[10]);
});

test("filtre des prix temps réel incohérents", async () => {
  const { isPlausibleLive } = await import("../src/lib/stats.ts");
  const last = { time: 0, open: 100, high: 101, low: 99, close: 100 };
  assert.equal(isPlausibleLive(103, last, 86400), true);
  assert.equal(isPlausibleLive(171, last, 86400), false); // ex. TOTAL3ES recalé (×1,71)
  assert.equal(isPlausibleLive(89, last, 300), false); // −11 % sur une bougie de 5 min
  assert.equal(isPlausibleLive(NaN, last, 86400), false);
});
