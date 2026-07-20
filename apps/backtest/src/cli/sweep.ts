/**
 * 静的配分（NISA・非課税・低コスト）の株式比率スイープ。
 * 「回転戦略はそもそも必要か」の対抗検証。
 *   pnpm exec tsx src/cli/sweep.ts
 */
import { makeS1 } from "@okina/strategy";
import { loadSeries, openDb } from "../db.js";
import { NISA_COSTS, runBacktest } from "../engine.js";
import { computeMetrics } from "../metrics.js";

const ALIGN_START = "2006-01-27";
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const db = openDb();
const series = loadSeries(db, ["SPY", "AGG", "GLD"]);
db.close();

console.log("配分(年次リバランス, NISA非課税) | CAGR | Sharpe | MaxDD | 水面下");
for (const eq of [0.3, 0.4, 0.5, 0.6, 0.7]) {
  const s = makeS1({ SPY: eq, AGG: 1 - eq }, "yearly");
  const r = runBacktest({ series, strategy: s, initialCapital: 1_000_000, costs: NISA_COSTS });
  const m = computeMetrics(r.equity.filter((p) => p.date >= ALIGN_START));
  console.log(
    `SPY${Math.round(eq * 100)}/AGG${Math.round((1 - eq) * 100)} | ${pct(m.cagr)} | ${m.sharpe.toFixed(2)} | ${pct(m.maxDrawdown)} ${m.maxDrawdown <= 0.2 ? "✓" : "✗"} | ${Math.round(m.maxUnderwaterDays / 30.44)}ヶ月`,
  );
}
// 金を混ぜた3資産版（分散効果の確認）
for (const [eq, gld] of [[0.4, 0.1], [0.5, 0.1], [0.4, 0.15]] as const) {
  const s = makeS1({ SPY: eq, GLD: gld, AGG: 1 - eq - gld }, "yearly");
  const r = runBacktest({ series, strategy: s, initialCapital: 1_000_000, costs: NISA_COSTS });
  const m = computeMetrics(r.equity.filter((p) => p.date >= ALIGN_START));
  console.log(
    `SPY${Math.round(eq * 100)}/GLD${Math.round(gld * 100)}/AGG${Math.round((1 - eq - gld) * 100)} | ${pct(m.cagr)} | ${m.sharpe.toFixed(2)} | ${pct(m.maxDrawdown)} ${m.maxDrawdown <= 0.2 ? "✓" : "✗"} | ${Math.round(m.maxUnderwaterDays / 30.44)}ヶ月`,
  );
}
