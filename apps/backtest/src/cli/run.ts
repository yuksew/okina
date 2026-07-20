/**
 * バックテスト実行CLI
 *   pnpm backtest --strategy s1
 *   pnpm backtest --strategy s2 --from 2005-01-01 --capital 1000000
 */
import { makeS1, makeS2, makeS3, makeS4, type Strategy } from "@okina/strategy";
import { loadSeries, openDb } from "../db.js";
import { DEFAULT_COSTS, runBacktest } from "../engine.js";
import { computeMetrics } from "../metrics.js";
import { UNIVERSES } from "../universe.js";

function buildStrategy(name: string): Strategy {
  switch (name) {
    case "s1":
      return makeS1({ SPY: 0.7, AGG: 0.3 }, "yearly");
    case "s2":
      return makeS2([...UNIVERSES.gtaa5], 10);
    case "s3":
      return makeS3({ risky: [...UNIVERSES.gemRisky], safe: "AGG", cashProxy: "SHY" });
    case "s4":
      return makeS4({ universe: [...UNIVERSES.rotation], topN: 3 });
    default:
      throw new Error(`unknown strategy: ${name} (s1|s2|s3|s4)`);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: { strategy?: string; from?: string; to?: string; capital?: number } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--strategy") opts.strategy = args[++i];
    else if (args[i] === "--from") opts.from = args[++i];
    else if (args[i] === "--to") opts.to = args[++i];
    else if (args[i] === "--capital") opts.capital = Number(args[++i]);
  }
  if (!opts.strategy) throw new Error("usage: pnpm backtest --strategy <s1|s2> [--from YYYY-MM-DD] [--to YYYY-MM-DD]");
  return opts;
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

function main() {
  const opts = parseArgs();
  const strategy = buildStrategy(opts.strategy!);
  const db = openDb();
  const series = loadSeries(db, strategy.symbols);
  db.close();

  const result = runBacktest({
    series,
    strategy,
    initialCapital: opts.capital ?? 1_000_000,
    costs: DEFAULT_COSTS,
    from: opts.from,
    to: opts.to,
  });
  const m = computeMetrics(result.equity);

  console.log(`\n=== ${result.strategyId} ===`);
  console.log(`期間            : ${result.from} .. ${result.to} (${m.years.toFixed(1)}年)`);
  console.log(`最終資産        : ${Math.round(m.endValue).toLocaleString()} (初期 ${result.initialCapital.toLocaleString()})`);
  console.log(`CAGR            : ${pct(m.cagr)}`);
  console.log(`年率ボラ        : ${pct(m.annualVol)}`);
  console.log(`シャープ        : ${m.sharpe.toFixed(2)}`);
  console.log(`最大DD          : ${pct(m.maxDrawdown)}  ${m.maxDrawdown <= 0.2 ? "(許容20%以内 ✓)" : "(許容20%超過 ✗)"}`);
  console.log(`カルマー        : ${m.calmar === Infinity ? "-" : m.calmar.toFixed(2)}`);
  console.log(`最長水面下      : ${Math.round(m.maxUnderwaterDays)}日`);
  console.log(`年間回転率      : ${pct(result.annualTurnover)}`);
  console.log(`リバランス回数  : ${result.rebalanceCount} (取引 ${result.trades.length}件)`);
  console.log(`コスト累計      : ${Math.round(result.totalCosts).toLocaleString()}`);
}

main();
