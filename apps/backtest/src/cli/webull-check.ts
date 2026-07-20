/**
 * サテライト執行先の代替検証: 採用ブレンドをウィブル現行手数料（0.22%）で再計算。
 * moomoo業務停止（2026-06-19〜09-18新規受付不可）を受けた臨時チェック。
 *   pnpm exec tsx src/cli/webull-check.ts
 */
import { blendStrategies, makeS2, makeS4 } from "@okina/strategy";
import { loadSeries, openDb } from "../db.js";
import { MOOMOO_COSTS, WEBULL_COSTS, runBacktest, type CostModel } from "../engine.js";
import { computeMetrics } from "../metrics.js";
import { UNIVERSES } from "../universe.js";

function makeBlend() {
  return blendStrategies(
    [
      { strategy: makeS2([...UNIVERSES.gtaa5], 10), weight: 0.5 },
      { strategy: makeS4({ universe: [...UNIVERSES.rotation], topN: 4, lookbackMonths: [3, 6, 12] }), weight: 0.5 },
    ],
    "blend-s2-s4t4-5050",
  );
}

function run(label: string, costs: CostModel) {
  const blend = makeBlend();
  const db = openDb();
  const series = loadSeries(db, blend.symbols);
  db.close();
  const r = runBacktest({ series, strategy: blend, initialCapital: 1_000_000, costs, taxRate: 0.20315 });
  const m = computeMetrics(r.equity.filter((p) => p.date >= "2006-01-27"));
  console.log(
    `${label.padEnd(28)} CAGR ${(m.cagr * 100).toFixed(1)}%  Sharpe ${m.sharpe.toFixed(2)}  MaxDD ${(m.maxDrawdown * 100).toFixed(1)}% ${m.maxDrawdown <= 0.2 ? "✓" : "✗"}`,
  );
}

run("ブレンド @moomoo 0.132%", MOOMOO_COSTS);
run("ブレンド @Webull現行 0.22%", WEBULL_COSTS);
