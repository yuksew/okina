import type { SeriesMap, Strategy, TargetWeights } from "../types.js";

/**
 * 複数戦略のウェイト加重合成（例: S2 50% + S4 50%）。
 * 各戦略のターゲットウェイトを配分比で足し合わせる。リバランス頻度は全戦略で同一であること。
 */
export function blendStrategies(
  parts: { strategy: Strategy; weight: number }[],
  id?: string,
): Strategy {
  if (parts.length === 0) throw new Error("blend requires at least 1 strategy");
  const totalW = parts.reduce((s, p) => s + p.weight, 0);
  if (Math.abs(totalW - 1) > 1e-9) {
    throw new Error(`blend weights must sum to 1, got ${totalW}`);
  }
  const freq = parts[0]!.strategy.rebalance;
  if (parts.some((p) => p.strategy.rebalance !== freq)) {
    throw new Error("blend requires all strategies to share the same rebalance frequency");
  }
  const symbols = [...new Set(parts.flatMap((p) => p.strategy.symbols))];
  return {
    id: id ?? `blend-${parts.map((p) => `${Math.round(p.weight * 100)}x${p.strategy.id}`).join("+")}`,
    description: `ブレンド: ${parts.map((p) => `${p.strategy.id}×${p.weight}`).join(" + ")}`,
    symbols,
    rebalance: freq,
    warmupDays: Math.max(...parts.map((p) => p.strategy.warmupDays)),
    targetWeights(date: string, history: SeriesMap): TargetWeights {
      const out: TargetWeights = {};
      for (const sym of symbols) out[sym] = 0;
      for (const p of parts) {
        const w = p.strategy.targetWeights(date, history);
        for (const sym of p.strategy.symbols) {
          out[sym] = (out[sym] ?? 0) + p.weight * (w[sym] ?? 0);
        }
      }
      return out;
    },
  };
}
