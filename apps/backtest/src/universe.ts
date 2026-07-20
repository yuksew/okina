/**
 * ETFユニバース定義。選定理由・設定日は docs/06-universe.md 参照。
 * stooq: Stooq のシンボル表記（無料・スモーク用）。Tiingo はティッカーそのまま。
 */
export interface UniverseEntry {
  symbol: string;
  stooq: string;
  assetClass: string;
}

export const ETF_MASTER: UniverseEntry[] = [
  { symbol: "SPY", stooq: "spy.us", assetClass: "米国株式" },
  { symbol: "QQQ", stooq: "qqq.us", assetClass: "米国株式(NASDAQ100)" },
  { symbol: "EFA", stooq: "efa.us", assetClass: "先進国株式(除く米国)" },
  { symbol: "EEM", stooq: "eem.us", assetClass: "新興国株式" },
  { symbol: "AGG", stooq: "agg.us", assetClass: "米国総合債券" },
  { symbol: "IEF", stooq: "ief.us", assetClass: "米国債7-10年" },
  { symbol: "TLT", stooq: "tlt.us", assetClass: "米国債20年+" },
  { symbol: "SHY", stooq: "shy.us", assetClass: "米国債1-3年(現金代替)" },
  { symbol: "VNQ", stooq: "vnq.us", assetClass: "米国リート" },
  { symbol: "GLD", stooq: "gld.us", assetClass: "金" },
];

/** 戦略ごとの使用シンボル */
export const UNIVERSES = {
  /** S1ベンチマーク: 株式/債券 */
  s1: ["SPY", "AGG"],
  /** S2 GTAA5: 株式・海外株・債券・リート・金 */
  gtaa5: ["SPY", "EFA", "IEF", "VNQ", "GLD"],
  /** S3 GEM: 相対モメンタム対象（退避 AGG / 基準 SHY は S3Config で指定） */
  gemRisky: ["SPY", "EFA"],
  /** S4 ローテーション対象（SHYは現金代替のため除外） */
  rotation: ["SPY", "QQQ", "EFA", "EEM", "AGG", "IEF", "TLT", "VNQ", "GLD"],
} as const;

export function stooqSymbol(symbol: string): string {
  const found = ETF_MASTER.find((e) => e.symbol === symbol);
  if (!found) throw new Error(`unknown symbol: ${symbol}`);
  return found.stooq;
}
