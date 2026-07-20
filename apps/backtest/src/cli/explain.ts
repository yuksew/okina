/**
 * P1ゲート判定の診断CLI: 年次リターン・最悪DD局面・要因分解を出力する。
 *   pnpm run explain
 */
import { makeS1, makeS2, makeS3, makeS4, type Strategy } from "@okina/strategy";
import { loadSeries, openDb } from "../db.js";
import { DEFAULT_COSTS, runBacktest, type EquityPoint } from "../engine.js";
import { UNIVERSES } from "../universe.js";

const ALIGN_START = "2006-01-27"; // report.ts の共通ウィンドウと揃える

interface DdEpisode {
  peakDate: string;
  troughDate: string;
  depth: number;
  recoveryDate: string | null;
}

function yearlyReturns(eq: EquityPoint[]): Map<string, number> {
  const byYear = new Map<string, number>(); // year -> 年末値
  for (const p of eq) byYear.set(p.date.slice(0, 4), p.value);
  const years = [...byYear.keys()].sort();
  const out = new Map<string, number>();
  for (let i = 1; i < years.length; i++) {
    out.set(years[i]!, byYear.get(years[i]!)! / byYear.get(years[i - 1]!)! - 1);
  }
  return out;
}

function ddEpisodes(eq: EquityPoint[], topN = 3): DdEpisode[] {
  const episodes: DdEpisode[] = [];
  let peak = eq[0]!;
  let trough = eq[0]!;
  let inDd = false;
  for (const p of eq) {
    if (p.value >= peak.value) {
      if (inDd) {
        episodes.push({
          peakDate: peak.date,
          troughDate: trough.date,
          depth: 1 - trough.value / peak.value,
          recoveryDate: p.date,
        });
        inDd = false;
      }
      peak = p;
      trough = p;
    } else {
      inDd = true;
      if (p.value < trough.value) trough = p;
    }
  }
  if (inDd) {
    episodes.push({
      peakDate: peak.date,
      troughDate: trough.date,
      depth: 1 - trough.value / peak.value,
      recoveryDate: null,
    });
  }
  return episodes.sort((a, b) => b.depth - a.depth).slice(0, topN);
}

function runAligned(strategy: Strategy) {
  const db = openDb();
  const series = loadSeries(db, strategy.symbols);
  db.close();
  const r = runBacktest({ series, strategy, initialCapital: 1_000_000, costs: DEFAULT_COSTS });
  const eq = r.equity.filter((p) => p.date >= ALIGN_START);
  return { r, eq };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function main() {
  const targets: { key: string; label: string; strategy: Strategy }[] = [
    { key: "S1", label: "S1 SPY70/AGG30", strategy: makeS1({ SPY: 0.7, AGG: 0.3 }, "yearly") },
    { key: "S2", label: "S2 GTAA5 10mSMA", strategy: makeS2([...UNIVERSES.gtaa5], 10) },
    { key: "S3", label: "S3 GEM 12m", strategy: makeS3({ risky: [...UNIVERSES.gemRisky], safe: "AGG", cashProxy: "SHY" }) },
    { key: "S4", label: "S4 Top3 blend", strategy: makeS4({ universe: [...UNIVERSES.rotation], topN: 3 }) },
    // 要因分解用
    { key: "SPY", label: "SPY 100% B&H", strategy: makeS1({ SPY: 1 }, "yearly") },
    { key: "SPYf", label: "SPY 100% +10mSMA", strategy: makeS2(["SPY"], 10) },
    { key: "EQW", label: "GTAA5等WTフィルタ無", strategy: makeS1({ SPY: 0.2, EFA: 0.2, IEF: 0.2, VNQ: 0.2, GLD: 0.2 }, "monthly") },
  ];

  const results = targets.map((t) => ({ ...t, ...runAligned(t.strategy) }));

  // 年次リターン一覧
  const yr = results.map((x) => ({ key: x.key, map: yearlyReturns(x.eq) }));
  const allYears = [...new Set(yr.flatMap((x) => [...x.map.keys()]))].sort();
  console.log("\n=== 年次リターン（共通ウィンドウ、コスト込み・税抜き） ===");
  console.log(["年", ...results.map((x) => x.key.padStart(6))].join(" | "));
  for (const y of allYears) {
    console.log(
      [y, ...yr.map((x) => (x.map.has(y) ? pct(x.map.get(y)!).padStart(6) : "     -"))].join(" | "),
    );
  }

  console.log("\n=== 最悪ドローダウン3局面 ===");
  for (const x of results) {
    console.log(`\n${x.label}`);
    for (const e of ddEpisodes(x.eq)) {
      console.log(
        `  ${pct(e.depth).padStart(6)}  ${e.peakDate} → ${e.troughDate}（回復 ${e.recoveryDate ?? "未回復"}）`,
      );
    }
  }

  console.log("\n=== コスト・回転 ===");
  for (const x of results) {
    console.log(
      `${x.label.padEnd(22)} 回転率/年 ${pct(x.r.annualTurnover).padStart(7)}  コスト累計 ${Math.round(x.r.totalCosts).toLocaleString().padStart(10)}`,
    );
  }
}

main();
