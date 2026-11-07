import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChart } from "../server/yahoo.ts";

const day = (iso: string) => Date.parse(iso) / 1000;

test("dernière ligne sans clôture (Nikkei) : complétée, la veille n'est pas déformée", () => {
  // réponse réelle de Yahoo du 06/11/2026 : la séance du jour arrive avec close = null
  const res = parseChart(
    {
      meta: { gmtoffset: 32400, regularMarketPrice: 57435, regularMarketTime: day("2026-11-06T06:45:02Z"), regularMarketDayHigh: 60500, regularMarketDayLow: 57200 },
      timestamp: [day("2026-11-04T00:00:00Z"), day("2026-11-05T00:00:00Z"), day("2026-11-06T00:00:00Z")],
      indicators: { quote: [{ open: [62973.2, 62384.7, 60374.4], high: [63500, 62600, null], low: [62000, 61000, null], close: [62188.6, 61077.9, null], volume: [1, 1, null] }] },
    },
    "1d",
  );
  assert.equal(res.bars.length, 3);
  const [, nov5, nov6] = res.bars;
  assert.equal(new Date(nov5.time * 1000).toISOString().slice(0, 10), "2026-11-05");
  assert.equal(nov5.close, 61077.9, "la clôture de la veille ne doit pas être écrasée par le prix du jour");
  assert.equal(new Date(nov6.time * 1000).toISOString().slice(0, 10), "2026-11-06");
  assert.equal(nov6.open, 60374.4);
  assert.equal(nov6.close, 57435);
  assert.equal(nov6.high, 60500);
  assert.equal(nov6.low, 57200);
});

test("dernier prix d'un autre jour : n'est pas appliqué à la dernière bougie", () => {
  const res = parseChart(
    {
      meta: { gmtoffset: 3600, regularMarketPrice: 8139, regularMarketTime: day("2026-11-06T17:05:00Z") },
      timestamp: [day("2026-11-04T08:00:00Z"), day("2026-11-05T08:00:00Z")],
      indicators: { quote: [{ open: [8034.5, 8248.9], high: [8200, 8260], low: [8000, 8190], close: [8177.9, 8205.4] }] },
    },
    "1d",
  );
  assert.equal(res.bars.at(-1)!.close, 8205.4);
  assert.equal(res.bars.at(-1)!.low, 8190);
});

test("intraday : le prix final n'étire pas une bougie terminée", () => {
  const t0 = day("2026-11-06T20:50:00Z");
  const res = parseChart(
    {
      meta: { gmtoffset: -18000, regularMarketPrice: 7376.86, regularMarketTime: day("2026-11-06T21:37:09Z") },
      timestamp: [t0, t0 + 300],
      indicators: { quote: [{ open: [7391.9, 7374.8], high: [7391.9, 7382.6], low: [7375.3, 7373.5], close: [7375.4, 7374.9] }] },
    },
    "5m",
  );
  assert.equal(res.bars.at(-1)!.close, 7374.9);
});

test("hebdo : la ligne « en cours » est fusionnée dans la semaine, datée du lundi", () => {
  const res = parseChart(
    {
      meta: { gmtoffset: -18000, regularMarketPrice: 7376.86, regularMarketTime: day("2026-11-06T21:37:09Z") },
      timestamp: [day("2026-10-19T04:00:00Z"), day("2026-10-26T04:00:00Z"), day("2026-11-02T05:00:00Z"), day("2026-11-06T21:00:00Z")],
      indicators: { quote: [{ open: [7700, 7639.7, 7610.8, 7377.6], high: [7770, 7758.4, 7715.6, 7444.2], low: [7612, 7527.6, 7350.4, 7369.5], close: [7623.7, 7580.1, 7353.7, 7376.9] }] },
    },
    "1wk",
  );
  assert.equal(res.bars.length, 3);
  const w = res.bars.at(-1)!;
  assert.equal(new Date(w.time * 1000).getUTCDay(), 1, "la semaine commence un lundi");
  assert.equal(w.open, 7610.8);
  assert.equal(w.close, 7376.86);
  assert.equal(w.low, 7350.4);
});
