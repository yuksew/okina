import {
  blendStrategies,
  makeS1,
  makeS2,
  makeS4,
  type Strategy,
} from "@okina/strategy";

/**
 * 採用構成（docs/10-p1-gate-decision.md）。
 * バックテスト（apps/backtest/src/cli/report.ts の mainCandidates）と同一パラメータであること。
 */

/** コア: NISA・S5静的配分 */
export function coreStrategy(): Strategy {
  return makeS1({ SPY: 0.3, AGG: 0.7 }, "yearly");
}

/** サテライト: 特定口座・S2/S4ブレンド */
export function satelliteStrategy(): Strategy {
  return blendStrategies(
    [
      { strategy: makeS2(["SPY", "EFA", "IEF", "VNQ", "GLD"], 10), weight: 0.5 },
      {
        strategy: makeS4({
          universe: ["SPY", "QQQ", "EFA", "EEM", "AGG", "IEF", "TLT", "VNQ", "GLD"],
          topN: 4,
          lookbackMonths: [3, 6, 12],
        }),
        weight: 0.5,
      },
    ],
    "blend-s2-s4t4-5050",
  );
}

/** 取込対象の全シンボル */
export function allSymbols(): string[] {
  return [...new Set([...coreStrategy().symbols, ...satelliteStrategy().symbols])];
}

export const RISK = {
  /** ポートフォリオ全体のDD警告ライン（01-strategy-spec §4） */
  ddWarning: 0.15,
  /** DD限界。到達で戦略停止判断を強制通知 */
  ddLimit: 0.2,
  /** コアの配分乖離許容（±） */
  coreDriftLimit: 0.05,
  /** データ鮮度: 価格最終日が営業日ベースでこの日数より古ければ stale */
  staleAfterBusinessDays: 3,
} as const;
