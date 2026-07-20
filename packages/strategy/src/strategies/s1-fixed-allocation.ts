import type { SeriesMap, Strategy, TargetWeights, RebalanceFrequency } from "../types.js";

/**
 * S1: 固定配分 + 定期リバランス（ベンチマーク）
 * 例: SPY 70% / AGG 30%、年次リバランス
 */
export function makeS1(
  weights: TargetWeights,
  rebalance: RebalanceFrequency = "yearly",
): Strategy {
  const symbols = Object.keys(weights);
  const total = symbols.reduce((s, k) => s + (weights[k] ?? 0), 0);
  if (total > 1.000001) {
    throw new Error(`S1 weights must sum to <= 1, got ${total}`);
  }
  return {
    id: `s1-fixed-${symbols.map((s) => `${s}${Math.round((weights[s] ?? 0) * 100)}`).join("-")}-${rebalance}`,
    description: `固定配分 ${JSON.stringify(weights)} を${rebalance}リバランス`,
    symbols,
    rebalance,
    warmupDays: 0,
    targetWeights(_date: string, _history: SeriesMap): TargetWeights {
      return { ...weights };
    },
  };
}
