import type { AssetDef } from "../../shared/types.ts";

export function decimalsFor(asset: AssetDef | undefined, price: number): number {
  if (asset?.decimals != null) return asset.decimals;
  const a = Math.abs(price);
  if (a >= 1000) return 0;
  if (a >= 100) return 1;
  if (a >= 10) return 2;
  if (a >= 1) return 3;
  return 5;
}

export function fmtPrice(v: number | null | undefined, asset?: AssetDef): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (asset?.id === "total3es" || Math.abs(v) >= 1e9) return fmtBig(v);
  const d = decimalsFor(asset, v);
  return v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtBig(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(3)} T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)} Md`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)} M`;
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

export function fmtPct(v: number | null | undefined, digits = 2, sign = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${sign && v > 0 ? "+" : ""}${s} %`;
}

export function pctColor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "var(--muted)";
  return v > 0 ? "var(--up)" : "var(--down)";
}

/** Fond de cellule type heatmap pour une variation en %. */
export function heat(v: number | null | undefined, scale = 10): string {
  if (v == null || !Number.isFinite(v)) return "transparent";
  const a = Math.min(1, Math.abs(v) / scale) * 0.55 + 0.05;
  return v >= 0 ? `rgba(8,153,129,${a.toFixed(2)})` : `rgba(242,54,69,${a.toFixed(2)})`;
}

export function fmtDate(t: number, withTime = false): string {
  const d = new Date(t * 1000);
  return withTime
    ? d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
