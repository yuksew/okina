import { totalReturn } from "../indicators.js";
import { monthEndCloses } from "../calendar.js";
import type { SeriesMap, Strategy, TargetWeights } from "../types.js";

export interface S3Config {
  /** 相対モメンタムで比較するリスク資産（例: SPY, EFA） */
  risky: string[];
  /** 絶対モメンタム不成立時の退避先（例: AGG） */
  safe: string;
  /** 絶対モメンタムの基準資産（Tビル代替、例: SHY） */
  cashProxy: string;
  /** モメンタム計測期間（月）。文献標準は12 */
  lookbackMonths?: number;
}

/**
 * S3: デュアルモメンタム（GEM系, Antonacci）
 * 月末に lookback ヶ月リターンを比較:
 * 1. 相対: リスク資産のうちリターン最大のものを選ぶ
 * 2. 絶対: その資産のリターンが cashProxy を上回るときのみ保有、下回るなら safe へ全額
 * 集中投資（常に1資産100%）である点に注意。
 */
export function makeS3(config: S3Config): Strategy {
  const lookback = config.lookbackMonths ?? 12;
  const symbols = [...new Set([...config.risky, config.safe, config.cashProxy])];
  return {
    id: `s3-gem-${lookback}m-${config.risky.join("-")}`,
    description: `デュアルモメンタム ${config.risky.join("/")} vs ${config.cashProxy}, 退避 ${config.safe}（${lookback}ヶ月、月次）`,
    symbols,
    rebalance: "monthly",
    warmupDays: (lookback + 1) * 23,
    targetWeights(_date: string, history: SeriesMap): TargetWeights {
      const momentum = (sym: string): number | null => {
        const monthly = monthEndCloses(history[sym] ?? []).map((m) => m.value);
        return totalReturn(monthly, lookback);
      };
      const weights: TargetWeights = {};
      for (const s of symbols) weights[s] = 0;

      let winner: string | null = null;
      let winnerRet = -Infinity;
      for (const s of config.risky) {
        const r = momentum(s);
        if (r !== null && r > winnerRet) {
          winner = s;
          winnerRet = r;
        }
      }
      const cashRet = momentum(config.cashProxy);
      if (winner === null || cashRet === null) return weights; // データ不足時は現金

      if (winnerRet > cashRet) weights[winner] = 1;
      else weights[config.safe] = 1;
      return weights;
    },
  };
}
