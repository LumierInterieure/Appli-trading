import type { Bar } from "../../shared/types.ts";
import { atr, lastValid } from "./indicators.ts";

export interface Pivot {
  index: number;
  time: number;
  price: number;
  type: "H" | "L";
  /** false pour le dernier extrême, pas encore validé par un retournement. */
  confirmed: boolean;
}

/**
 * ZigZag : un pivot est validé quand le prix repart en sens inverse d'au
 * moins `threshold` (en unités de prix). Fonctionne aussi en mode relatif (%).
 */
export function zigzag(bars: Bar[], threshold: number): Pivot[] {
  const n = bars.length;
  if (n < 3 || !(threshold > 0)) return [];
  const piv: Pivot[] = [];
  const mk = (i: number, type: "H" | "L", confirmed = true): Pivot => ({
    index: i, time: bars[i].time, price: type === "H" ? bars[i].high : bars[i].low, type, confirmed,
  });
  let dir = 0;
  let hi = 0, lo = 0;
  for (let i = 1; i < n; i++) {
    const b = bars[i];
    if (dir === 0) {
      if (b.high > bars[hi].high) hi = i;
      if (b.low < bars[lo].low) lo = i;
      if (bars[hi].high - bars[lo].low >= threshold) {
        if (lo < hi) { piv.push(mk(lo, "L")); dir = 1; }
        else { piv.push(mk(hi, "H")); dir = -1; }
      }
    } else if (dir === 1) {
      if (b.high >= bars[hi].high) hi = i;
      if (bars[hi].high - b.low >= threshold) {
        piv.push(mk(hi, "H"));
        dir = -1;
        lo = hi + 1;
        for (let j = hi + 1; j <= i; j++) if (bars[j].low < bars[lo].low) lo = j;
      }
    } else {
      if (b.low <= bars[lo].low) lo = i;
      if (b.high - bars[lo].low >= threshold) {
        piv.push(mk(lo, "L"));
        dir = 1;
        hi = lo + 1;
        for (let j = lo + 1; j <= i; j++) if (bars[j].high > bars[hi].high) hi = j;
      }
    }
  }
  if (dir === 1 && hi > (piv[piv.length - 1]?.index ?? -1)) piv.push(mk(hi, "H", false));
  if (dir === -1 && lo > (piv[piv.length - 1]?.index ?? -1)) piv.push(mk(lo, "L", false));
  return piv;
}

export type Sensitivity = "fine" | "normal" | "large";

const MULTS: Record<Sensitivity, number> = { fine: 2.5, normal: 4.5, large: 8 };

/** Seuil ZigZag adaptatif basé sur l'ATR, ajusté pour garder un nombre de pivots lisible. */
export function adaptivePivots(bars: Bar[], sensitivity: Sensitivity = "normal", maxPivots = 24): { pivots: Pivot[]; threshold: number } {
  const a = lastValid(atr(bars, 14));
  const range = Math.max(...bars.map((b) => b.high)) - Math.min(...bars.map((b) => b.low));
  let threshold = a ? a * MULTS[sensitivity] : range * 0.08;
  threshold = Math.max(threshold, range * 0.015);
  let pivots = zigzag(bars, threshold);
  for (let k = 0; k < 8 && pivots.length > maxPivots; k++) {
    threshold *= 1.35;
    pivots = zigzag(bars, threshold);
  }
  for (let k = 0; k < 6 && pivots.filter((p) => p.confirmed).length < 3; k++) {
    threshold /= 1.5;
    pivots = zigzag(bars, threshold);
  }
  return { pivots, threshold };
}
