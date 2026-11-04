import type { AssetDef } from "./types.ts";

/**
 * Catalogue des actifs. Les premiers (core) sont ceux demandés ; les autres
 * sont ajoutés car ils comptent pour lire le marché (taux, volatilité, or,
 * méga-caps, indices européens...). N'importe quel autre ticker Yahoo peut
 * être ajouté depuis l'interface.
 */
export const ASSETS: AssetDef[] = [
  // --- Sélection demandée ---
  { id: "nasdaq", symbol: "^IXIC", name: "Nasdaq Composite", short: "NASDAQ", category: "Indices US", core: true, aliases: ["nasdaq", "ixic", "nasdaq composite"], demoPrice: 21500, demoVol: 0.22 },
  { id: "spx", symbol: "^GSPC", name: "S&P 500", short: "SPX", category: "Indices US", core: true, aliases: ["sp500", "s&p", "s&p500", "spx", "sp 500", "s&p 500"], demoPrice: 6600, demoVol: 0.17 },
  { id: "btc", symbol: "BTC-USD", name: "Bitcoin", short: "BTC", category: "Crypto", core: true, binance: "btcusdt", alwaysOpen: true, decimals: 0, aliases: ["btc", "bitcoin"], demoPrice: 105000, demoVol: 0.5 },
  { id: "dxy", symbol: "DX-Y.NYB", name: "Dollar Index (DXY)", short: "DXY", category: "Devises", core: true, decimals: 3, aliases: ["dxy", "dollar", "dollar index"], demoPrice: 99, demoVol: 0.08 },
  { id: "total3es", symbol: "@TOTAL3ES", name: "TOTAL3ES (altcoins hors BTC, ETH & stables)", short: "TOTAL3ES", category: "Crypto", core: true, alwaysOpen: true, decimals: 0, aliases: ["total3es", "total3", "altcoins", "alts"], demoPrice: 8.5e11, demoVol: 0.65, description: "Capitalisation des principaux altcoins (hors BTC, ETH et stablecoins), recalée sur la capitalisation réelle CoinGecko quand disponible." },
  { id: "msciworld", symbol: "URTH", name: "MSCI World (ETF URTH)", short: "MSCI W", category: "Indices monde", core: true, aliases: ["msci", "msci world", "world", "urth"], demoPrice: 175, demoVol: 0.15 },
  { id: "us10y", symbol: "^TNX", name: "US 10Y (taux, 10Y1!)", short: "US10Y", category: "Taux", core: true, decimals: 3, aliases: ["10y", "10y1!", "us10y", "tnx", "taux 10 ans", "taux us"], demoPrice: 4.2, demoVol: 0.25 },
  { id: "brent", symbol: "BZ=F", name: "Pétrole Brent", short: "BRENT", category: "Matières premières", core: true, aliases: ["brent", "petrole", "pétrole", "oil"], demoPrice: 68, demoVol: 0.33 },

  // --- Ajouts importants ---
  { id: "ndx", symbol: "^NDX", name: "Nasdaq 100", short: "NDX", category: "Indices US", aliases: ["ndx", "nasdaq 100", "nq"], demoPrice: 24500, demoVol: 0.23 },
  { id: "dji", symbol: "^DJI", name: "Dow Jones", short: "DOW", category: "Indices US", aliases: ["dow", "dow jones", "dji"], demoPrice: 46000, demoVol: 0.15 },
  { id: "rut", symbol: "^RUT", name: "Russell 2000 (small caps)", short: "RUT", category: "Indices US", aliases: ["russell", "rut", "small caps"], demoPrice: 2400, demoVol: 0.24 },
  { id: "sox", symbol: "^SOX", name: "Semi-conducteurs (SOX)", short: "SOX", category: "Indices US", aliases: ["sox", "semi", "semis", "semi-conducteurs"], demoPrice: 6500, demoVol: 0.38 },
  { id: "cac", symbol: "^FCHI", name: "CAC 40", short: "CAC40", category: "Indices monde", aliases: ["cac", "cac40", "cac 40"], demoPrice: 8000, demoVol: 0.17 },
  { id: "dax", symbol: "^GDAXI", name: "DAX", short: "DAX", category: "Indices monde", aliases: ["dax"], demoPrice: 24000, demoVol: 0.18 },
  { id: "sx5e", symbol: "^STOXX50E", name: "Euro Stoxx 50", short: "SX5E", category: "Indices monde", aliases: ["stoxx", "euro stoxx", "sx5e"], demoPrice: 5500, demoVol: 0.17 },
  { id: "nikkei", symbol: "^N225", name: "Nikkei 225", short: "NIKKEI", category: "Indices monde", aliases: ["nikkei", "japon"], demoPrice: 45000, demoVol: 0.22 },
  { id: "hsi", symbol: "^HSI", name: "Hang Seng", short: "HSI", category: "Indices monde", aliases: ["hang seng", "hsi", "chine"], demoPrice: 25000, demoVol: 0.25 },
  { id: "eth", symbol: "ETH-USD", name: "Ethereum", short: "ETH", category: "Crypto", binance: "ethusdt", alwaysOpen: true, decimals: 1, aliases: ["eth", "ethereum"], demoPrice: 3800, demoVol: 0.65 },
  { id: "sol", symbol: "SOL-USD", name: "Solana", short: "SOL", category: "Crypto", binance: "solusdt", alwaysOpen: true, decimals: 2, aliases: ["sol", "solana"], demoPrice: 190, demoVol: 0.8 },
  { id: "us3m", symbol: "^IRX", name: "US 3 mois (T-Bill)", short: "US3M", category: "Taux", decimals: 3, aliases: ["us3m", "irx", "taux court", "t-bill"], demoPrice: 3.9, demoVol: 0.15 },
  { id: "us05y", symbol: "^FVX", name: "US 5Y (taux)", short: "US5Y", category: "Taux", decimals: 3, aliases: ["us5y", "fvx", "taux 5 ans"], demoPrice: 3.8, demoVol: 0.25 },
  { id: "us30y", symbol: "^TYX", name: "US 30Y (taux)", short: "US30Y", category: "Taux", decimals: 3, aliases: ["us30y", "tyx", "taux 30 ans"], demoPrice: 4.7, demoVol: 0.2 },
  { id: "vix", symbol: "^VIX", name: "VIX (volatilité S&P 500)", short: "VIX", category: "Volatilité", decimals: 2, aliases: ["vix", "volatilite", "volatilité", "peur"], demoPrice: 17, demoVol: 0.9 },
  { id: "gold", symbol: "GC=F", name: "Or", short: "GOLD", category: "Matières premières", decimals: 1, aliases: ["or", "gold", "xau"], demoPrice: 4000, demoVol: 0.18 },
  { id: "silver", symbol: "SI=F", name: "Argent", short: "SILVER", category: "Matières premières", decimals: 3, aliases: ["argent", "silver", "xag"], demoPrice: 48, demoVol: 0.3 },
  { id: "wti", symbol: "CL=F", name: "Pétrole WTI", short: "WTI", category: "Matières premières", aliases: ["wti", "crude"], demoPrice: 64, demoVol: 0.35 },
  { id: "copper", symbol: "HG=F", name: "Cuivre", short: "COPPER", category: "Matières premières", decimals: 3, aliases: ["cuivre", "copper"], demoPrice: 5, demoVol: 0.25 },
  { id: "natgas", symbol: "NG=F", name: "Gaz naturel", short: "NATGAS", category: "Matières premières", decimals: 3, aliases: ["gaz", "natgas", "gas"], demoPrice: 3.5, demoVol: 0.6 },
  { id: "eurusd", symbol: "EURUSD=X", name: "EUR/USD", short: "EURUSD", category: "Devises", decimals: 4, aliases: ["eurusd", "euro", "eur/usd"], demoPrice: 1.16, demoVol: 0.08 },
  { id: "usdjpy", symbol: "JPY=X", name: "USD/JPY", short: "USDJPY", category: "Devises", decimals: 2, aliases: ["usdjpy", "yen", "usd/jpy"], demoPrice: 150, demoVol: 0.1 },
  { id: "aapl", symbol: "AAPL", name: "Apple", short: "AAPL", category: "Actions", aliases: ["apple", "aapl"], demoPrice: 260, demoVol: 0.28 },
  { id: "msft", symbol: "MSFT", name: "Microsoft", short: "MSFT", category: "Actions", aliases: ["microsoft", "msft"], demoPrice: 520, demoVol: 0.25 },
  { id: "nvda", symbol: "NVDA", name: "Nvidia", short: "NVDA", category: "Actions", aliases: ["nvidia", "nvda"], demoPrice: 190, demoVol: 0.5 },
  { id: "amzn", symbol: "AMZN", name: "Amazon", short: "AMZN", category: "Actions", aliases: ["amazon", "amzn"], demoPrice: 230, demoVol: 0.32 },
  { id: "googl", symbol: "GOOGL", name: "Alphabet", short: "GOOGL", category: "Actions", aliases: ["google", "alphabet", "googl"], demoPrice: 250, demoVol: 0.3 },
  { id: "meta", symbol: "META", name: "Meta", short: "META", category: "Actions", aliases: ["meta", "facebook"], demoPrice: 720, demoVol: 0.38 },
  { id: "tsla", symbol: "TSLA", name: "Tesla", short: "TSLA", category: "Actions", aliases: ["tesla", "tsla"], demoPrice: 430, demoVol: 0.6 },
];

export const ASSET_BY_SYMBOL = new Map(ASSETS.map((a) => [a.symbol, a]));
export const ASSET_BY_ID = new Map(ASSETS.map((a) => [a.id, a]));

export function customAsset(symbol: string, name?: string): AssetDef {
  const s = symbol.toUpperCase();
  return { id: `x:${s}`, symbol: s, name: name || s, short: s.replace(/[\^=]/g, "").slice(0, 10), category: "Perso", aliases: [s.toLowerCase()] };
}

/** Périodes proposées : plage Yahoo + intervalle de bougie. */
export interface Timeframe {
  id: string;
  label: string;
  range: string;
  interval: string;
  /** Approx. durée d'une bougie en secondes (pour projections). */
  barSeconds: number;
}

export const TIMEFRAMES: Timeframe[] = [
  { id: "1D", label: "1J", range: "1d", interval: "5m", barSeconds: 300 },
  { id: "5D", label: "5J", range: "5d", interval: "15m", barSeconds: 900 },
  { id: "1M", label: "1M", range: "1mo", interval: "60m", barSeconds: 3600 },
  { id: "3M", label: "3M", range: "3mo", interval: "1d", barSeconds: 86400 },
  { id: "6M", label: "6M", range: "6mo", interval: "1d", barSeconds: 86400 },
  { id: "YTD", label: "YTD", range: "ytd", interval: "1d", barSeconds: 86400 },
  { id: "1Y", label: "1A", range: "1y", interval: "1d", barSeconds: 86400 },
  { id: "2Y", label: "2A", range: "2y", interval: "1d", barSeconds: 86400 },
  { id: "5Y", label: "5A", range: "5y", interval: "1wk", barSeconds: 7 * 86400 },
  { id: "10Y", label: "10A", range: "10y", interval: "1wk", barSeconds: 7 * 86400 },
  { id: "MAX", label: "MAX", range: "max", interval: "1mo", barSeconds: 30 * 86400 },
];

export const INTERVAL_SECONDS: Record<string, number> = {
  "1m": 60, "2m": 120, "5m": 300, "15m": 900, "30m": 1800, "60m": 3600, "90m": 5400, "1h": 3600,
  "1d": 86400, "5d": 5 * 86400, "1wk": 7 * 86400, "1mo": 30 * 86400, "3mo": 91 * 86400,
};
