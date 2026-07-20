import { sma } from "../indicators.js";
import { monthEndCloses } from "../calendar.js";
import type { SeriesMap, Strategy, TargetWeights } from "../types.js";

/**
 * S2: トレンドフィルタ型（Faber GTAA 簡易版）
 * 各資産を等ウェイトで持ち、「月末終値 > 直近 smaMonths ヶ月の月末終値SMA」の資産のみ保有。
 * 条件を満たさない資産の枠は現金退避。
 *
 * 判定は月末終値ベース（文献標準）。当日が月中の場合は「当日を月末とみなした」値で
 * 判定される点に注意（エンジン側が月末日にのみ呼ぶ想定）。
 */
export function makeS2(symbols: string[], smaMonths = 10): Strategy {
  if (symbols.length === 0) throw new Error("S2 requires at least 1 symbol");
  const perAsset = 1 / symbols.length;
  return {
    id: `s2-trend-${smaMonths}m-${symbols.join("-")}`,
    description: `${symbols.join(",")} 等ウェイト、${smaMonths}ヶ月SMAトレンドフィルタ（月次）`,
    symbols,
    rebalance: "monthly",
    // 月末値が smaMonths+1 個必要。営業日換算で余裕を持たせる（23営業日/月）
    warmupDays: (smaMonths + 1) * 23,
    targetWeights(_date: string, history: SeriesMap): TargetWeights {
      const weights: TargetWeights = {};
      for (const sym of symbols) {
        const bars = history[sym] ?? [];
        const monthly = monthEndCloses(bars).map((m) => m.value);
        const avg = sma(monthly, smaMonths);
        const last = monthly[monthly.length - 1];
        weights[sym] =
          avg !== null && last !== undefined && last > avg ? perAsset : 0;
      }
      return weights;
    },
  };
}
