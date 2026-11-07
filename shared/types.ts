export interface Bar {
  /** Unix timestamp (seconds, UTC). Daily+ bars are aligned to 00:00 UTC of the exchange-local date. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface HistoryResponse {
  symbol: string;
  interval: string;
  range: string;
  currency?: string;
  bars: Bar[];
  demo: boolean;
  /** Dernières données valides servies car le fournisseur ne répond pas. */
  stale?: boolean;
  note?: string;
}

export interface Quote {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  time: number;
  currency?: string;
  marketState?: string;
  /** Intraday closes for a sparkline. */
  spark: number[];
  demo: boolean;
  stale?: boolean;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
}

export type Category =
  | "Indices US"
  | "Indices monde"
  | "Crypto"
  | "Taux"
  | "Devises"
  | "Matières premières"
  | "Volatilité"
  | "Actions"
  | "Perso";

export interface AssetDef {
  /** Identifiant interne stable (aussi utilisé dans les commandes). */
  id: string;
  /** Symbole Yahoo Finance, ou "@TOTAL3ES" pour l'indice synthétique. */
  symbol: string;
  name: string;
  short: string;
  category: Category;
  /** Fait partie de la sélection demandée par l'utilisateur. */
  core?: boolean;
  decimals?: number;
  /** Flux temps réel Binance (ex. "btcusdt"). */
  binance?: string;
  /** Mots-clés reconnus par la barre de commandes. */
  aliases?: string[];
  /** Marché 24/7 (crypto). */
  alwaysOpen?: boolean;
  /** Prix de référence pour le mode démo. */
  demoPrice?: number;
  demoVol?: number;
  description?: string;
}
