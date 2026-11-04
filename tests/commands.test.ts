import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSETS } from "../shared/assets.ts";
import { parseCommand } from "../src/lib/commands.ts";
import { DEFAULT_SETTINGS } from "../src/lib/state.ts";

const p = (s: string) => parseCommand(s, ASSETS, DEFAULT_SETTINGS).actions;

test("extension de fibonacci sur le bitcoin en 1 an", () => {
  const a = p("Fais une extension de Fibonacci sur le bitcoin en 1 an");
  assert.deepEqual(a.filter((x) => x.type === "toolOn"), [{ type: "toolOn", tool: "fibExtension" }]);
  assert.ok(a.some((x) => x.type === "setMain" && x.id === "btc"));
  assert.ok(a.some((x) => x.type === "set" && x.patch.timeframe === "1Y"));
});

test("retracement simple", () => {
  const a = p("fibo");
  assert.deepEqual(a, [{ type: "toolOn", tool: "fibRetracement" }]);
});

test("comparaison multi-actifs en relatif", () => {
  const a = p("compare nasdaq, btc et dxy en relatif sur 6 mois");
  assert.ok(a.some((x) => x.type === "setMain" && x.id === "nasdaq"));
  assert.ok(a.some((x) => x.type === "setOverlays" && x.ids.join() === "btc,dxy"));
  assert.ok(a.some((x) => x.type === "set" && x.patch.mode === "relative"));
  assert.ok(a.some((x) => x.type === "set" && x.patch.timeframe === "6M"));
});

test("nasdaq 100 vs nasdaq composite et s&p 500", () => {
  const a = p("s&p 500 avec nasdaq 100");
  assert.ok(a.some((x) => x.type === "setMain" && x.id === "spx"));
  assert.ok(a.some((x) => x.type === "setOverlays" && x.ids.join() === "ndx"));
});

test("alerte de prix", () => {
  const a = p("alerte si btc passe sous 95 000");
  const al = a.find((x) => x.type === "alert");
  assert.ok(al && al.type === "alert");
  assert.equal(al.alert.assetId, "btc");
  assert.equal(al.alert.kind, "below");
  assert.equal(al.alert.value, 95000);
});

test("alerte de variation", () => {
  const a = p("préviens-moi si le nasdaq baisse de 5% sur 1 semaine");
  const al = a.find((x) => x.type === "alert");
  assert.ok(al && al.type === "alert");
  assert.equal(al.alert.kind, "changeDown");
  assert.equal(al.alert.value, 5);
  assert.equal(al.alert.period, "1W");
});

test("analyse IA", () => {
  const a = p("analyse le marché avec l'IA et fais des prévisions sur btc et brent");
  const an = a.find((x) => x.type === "analyze");
  assert.ok(an && an.type === "analyze" && an.ai);
  assert.deepEqual(an.focus, ["btc", "brent"]);
});

test("retirer un outil", () => {
  assert.deepEqual(p("enlève les supports"), [{ type: "toolOff", tool: "supportResistance" }]);
});

test("taux 10 ans et période 10 ans ne se confondent pas", () => {
  const a = p("taux 10 ans sur 10 ans");
  assert.ok(a.some((x) => x.type === "setMain" && x.id === "us10y"));
  assert.ok(a.some((x) => x.type === "set" && x.patch.timeframe === "10Y"));
});
