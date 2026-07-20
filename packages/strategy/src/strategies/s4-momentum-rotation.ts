import { totalReturn } from "../indicators.js";
import { monthEndCloses } from "../calendar.js";
import type { SeriesMap, Strategy, TargetWeights } from "../types.js";

export interface S4Config {
  /** ローテーション対象ユニバース */
  universe: string[];
  /** 保有本数 */
  topN?: number;
  /** モメンタムスコア = 指定期間（月）リターンの平均。文献でよく使われる 3/6/12 の平均 */
  lookbackMonths?: number[];
}

/**
 * S4: ETFモメンタムローテーション（Top-N）
 * 月末にユニバースをブレンドモメンタムでランク付けし、上位N本を等ウェイト保有。
 * 上位でもスコアが0以下の枠は現金退避（絶対モメンタムフィルタ）。
 */
export function makeS4(config: S4Config): Strategy {
  const topN = config.topN ?? 3;
  const lookbacks = config.lookbackMonths ?? [3, 6, 12];
  const maxLookback = Math.max(...lookbacks);
  if (topN <= 0 || topN > config.universe.length) {
    throw new Error(`invalid topN: ${topN}`);
  }
  return {
    id: `s4-rot-top${topN}-${lookbacks.join("_")}m`,
    description: `モメンタムローテーション Top${topN}/${config.universe.length}本（${lookbacks.join("/")}ヶ月平均、月次）`,
    symbols: [...config.universe],
    rebalance: "monthly",
    warmupDays: (maxLookback + 1) * 23,
    targetWeights(_date: string, history: SeriesMap): TargetWeights {
      const weights: TargetWeights = {};
      const scores: { sym: string; score: number }[] = [];
      for (const sym of config.universe) {
        weights[sym] = 0;
        const monthly = monthEndCloses(history[sym] ?? []).map((m) => m.value);
        const rets = lookbacks.map((lb) => totalReturn(monthly, lb));
        if (rets.some((r) => r === null)) continue; // データ不足銘柄は対象外
        const vals = rets as number[];
        const score = vals.reduce((s, r) => s + r, 0) / vals.length;
        scores.push({ sym, score });
      }
      scores.sort((a, b) => b.score - a.score);
      for (const { sym, score } of scores.slice(0, topN)) {
        if (score > 0) weights[sym] = 1 / topN; // スコア<=0の枠は現金のまま
      }
      return weights;
    },
  };
}
