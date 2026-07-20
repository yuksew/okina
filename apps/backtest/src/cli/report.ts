/**
 * 戦略比較＋感応度分析＋税・コストシナリオを一括実行し docs/07-backtest-report.md を生成する。
 *   pnpm run report
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blendStrategies,
  makeS1,
  makeS2,
  makeS3,
  makeS4,
  type Strategy,
} from "@okina/strategy";
import { loadSeries, openDb } from "../db.js";
import {
  MAJOR3_COSTS,
  MOOMOO_COSTS,
  NISA_COSTS,
  runBacktest,
  type BacktestResult,
  type CostModel,
  type EquityPoint,
} from "../engine.js";
import { computeMetrics, type Metrics } from "../metrics.js";
import { UNIVERSES } from "../universe.js";

const REPORT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "..", "docs", "07-backtest-report.md",
);

const TAX_RATE = 0.20315;

interface Scenario {
  name: string;
  costs: CostModel;
  costNote: string;
}

/** 特定口座（サテライト）側の執行先シナリオ。NISA側（S1）は常に NISA_COSTS */
const SCENARIOS: Scenario[] = [
  { name: "大手3社・特定口座", costs: MAJOR3_COSTS, costNote: "片道 約0.51%（手数料0.495%+スプレッド0.02%、為替0銭）" },
  { name: "moomoo・特定口座", costs: MOOMOO_COSTS, costNote: "片道 約0.15%（手数料0.132%+スプレッド0.02%、為替0銭）" },
];

interface Candidate {
  label: string;
  strategy: Strategy;
  /** 想定口座: nisa=非課税 / tokutei=特定口座（20.315%源泉徴収） */
  account: "nisa" | "tokutei";
}

function s2() {
  return makeS2([...UNIVERSES.gtaa5], 10);
}
function s4(topN: number) {
  return makeS4({ universe: [...UNIVERSES.rotation], topN, lookbackMonths: [3, 6, 12] });
}

function mainCandidates(): Candidate[] {
  return [
    { label: "S1 SPY70/AGG30（NISA・非課税）", strategy: makeS1({ SPY: 0.7, AGG: 0.3 }, "yearly"), account: "nisa" },
    { label: "S5 SPY30/AGG70（NISA・非課税）", strategy: makeS1({ SPY: 0.3, AGG: 0.7 }, "yearly"), account: "nisa" },
    { label: "S5' SPY40/GLD10/AGG50（NISA・非課税）", strategy: makeS1({ SPY: 0.4, GLD: 0.1, AGG: 0.5 }, "yearly"), account: "nisa" },
    { label: "S2 GTAA5 10ヶ月SMA", strategy: s2(), account: "tokutei" },
    { label: "S3 GEM 12ヶ月（参考・除外候補）", strategy: makeS3({ risky: [...UNIVERSES.gemRisky], safe: "AGG", cashProxy: "SHY" }), account: "tokutei" },
    { label: "S4 Top3", strategy: s4(3), account: "tokutei" },
    { label: "S4 Top4", strategy: s4(4), account: "tokutei" },
    { label: "ブレンド S2:S4Top4=50:50", strategy: blendStrategies([{ strategy: s2(), weight: 0.5 }, { strategy: s4(4), weight: 0.5 }], "blend-s2-s4t4-5050"), account: "tokutei" },
    { label: "ブレンド S2:S4Top4=70:30", strategy: blendStrategies([{ strategy: s2(), weight: 0.7 }, { strategy: s4(4), weight: 0.3 }], "blend-s2-s4t4-7030"), account: "tokutei" },
  ];
}

function sensitivityCandidates(): Candidate[] {
  return [
    { label: "S2 8ヶ月SMA", strategy: makeS2([...UNIVERSES.gtaa5], 8), account: "tokutei" },
    { label: "S2 12ヶ月SMA", strategy: makeS2([...UNIVERSES.gtaa5], 12), account: "tokutei" },
    { label: "S4 Top4 12ヶ月のみ", strategy: makeS4({ universe: [...UNIVERSES.rotation], topN: 4, lookbackMonths: [12] }), account: "tokutei" },
    { label: "S4 Top4 6/12ヶ月", strategy: makeS4({ universe: [...UNIVERSES.rotation], topN: 4, lookbackMonths: [6, 12] }), account: "tokutei" },
    { label: "ブレンド50:50 (S2=8m)", strategy: blendStrategies([{ strategy: makeS2([...UNIVERSES.gtaa5], 8), weight: 0.5 }, { strategy: s4(4), weight: 0.5 }], "blend-8m-5050"), account: "tokutei" },
    { label: "ブレンド50:50 (S2=12m)", strategy: blendStrategies([{ strategy: makeS2([...UNIVERSES.gtaa5], 12), weight: 0.5 }, { strategy: s4(4), weight: 0.5 }], "blend-12m-5050"), account: "tokutei" },
  ];
}

interface Row {
  label: string;
  result: BacktestResult;
  aligned: Metrics;
}

function runOne(c: Candidate, satelliteCosts: CostModel, alignStart: string | null): Omit<Row, "aligned"> & { equity: EquityPoint[] } {
  const db = openDb();
  const series = loadSeries(db, c.strategy.symbols);
  db.close();
  const result = runBacktest({
    series,
    strategy: c.strategy,
    initialCapital: 1_000_000,
    // NISA想定の候補は執行先シナリオに関わらずNISAコスト（売買無料・非課税）
    costs: c.account === "nisa" ? NISA_COSTS : satelliteCosts,
    taxRate: c.account === "tokutei" ? TAX_RATE : 0,
  });
  const equity = alignStart ? result.equity.filter((p) => p.date >= alignStart) : result.equity;
  return { label: c.label, result, equity };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const num = (x: number, d = 2) => x.toFixed(d);

function metricsLine(label: string, m: Metrics, r: BacktestResult): string {
  const ddMark = m.maxDrawdown <= 0.2 ? "✓" : "✗";
  return `| ${label} | ${pct(m.cagr)} | ${num(m.sharpe)} | ${pct(m.maxDrawdown)} ${ddMark} | ${num(m.calmar)} | ${Math.round(m.maxUnderwaterDays / 30.44)}ヶ月 | ${pct(r.annualTurnover)} | ${Math.round(r.totalTax / 1000).toLocaleString()}千円 |`;
}

function main() {
  // 共通ウィンドウはメイン候補で決める（コストで開始日は変わらない）
  const probe = mainCandidates().map((c) => runOne(c, MAJOR3_COSTS, null));
  const alignStart = probe.map((r) => r.equity[0]!.date).reduce((a, b) => (a > b ? a : b));
  const alignEnd = probe[0]!.equity.at(-1)!.date;

  const lines: string[] = [];
  lines.push("# フェーズ1: バックテスト比較レポート（v2: 税・コストシナリオ対応）");
  lines.push("");
  lines.push(`- ${alignEnd}時点のデータで機械生成（\`pnpm run report\`）。手編集しない`);
  lines.push("- 合格ライン: [01-strategy-spec.md](01-strategy-spec.md) §5.2 / 診断: [08-p1-gate-analysis.md](08-p1-gate-analysis.md)");
  lines.push("");
  lines.push("## 前提条件");
  lines.push("");
  lines.push("- データ: Tiingo adjusted close、USD建て。判定・執行は同日終値、端株なし");
  lines.push(`- 共通評価ウィンドウ: ${alignStart} .. ${alignEnd}`);
  lines.push(`- 税: 特定口座候補は譲渡益税${pct(TAX_RATE)}を源泉徴収方式で反映（移動平均法・年内損益通算あり・損失繰越なし=保守側）。S1はNISA想定で非課税`);
  lines.push("- **S1（NISA・非課税）とその他（特定口座・課税後）の比較は、実際の口座配置での意思決定に合わせた設定**（グロス同士の比較ではない）");
  lines.push("- パラメータは文献標準値で最適化なし。為替コスト・円建て評価は未反映");
  lines.push("");

  for (const scenario of SCENARIOS) {
    lines.push(`## シナリオ: ${scenario.name}（${scenario.costNote}）`);
    lines.push("");
    lines.push("| 戦略（口座・課税後） | CAGR | シャープ | 最大DD(≤20%) | カルマー | 最長水面下 | 回転率/年 | 税累計 |");
    lines.push("|---|---|---|---|---|---|---|---|");
    const rows = mainCandidates().map((c) => {
      const r = runOne(c, scenario.costs, alignStart);
      return { label: r.label, result: r.result, aligned: computeMetrics(r.equity) };
    });
    for (const r of rows) lines.push(metricsLine(r.label, r.aligned, r.result));
    lines.push("");
    const s1Sharpe = rows[0]!.aligned.sharpe;
    const passers = rows.slice(1).filter((r) => r.aligned.maxDrawdown <= 0.2 && r.aligned.sharpe >= s1Sharpe);
    lines.push(`- 判定（DD≤20% かつ シャープ≥S1=${num(s1Sharpe)}）: ${passers.length > 0 ? "**合格: " + passers.map((r) => r.label).join(" / ") + "**" : "合格なし"}`);
    lines.push("");
  }

  lines.push("## 感応度分析（moomooコスト・課税後・共通ウィンドウ）");
  lines.push("");
  lines.push("| バリアント | CAGR | シャープ | 最大DD(≤20%) | カルマー | 最長水面下 | 回転率/年 | 税累計 |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const c of sensitivityCandidates()) {
    const r = runOne(c, MOOMOO_COSTS, alignStart);
    lines.push(metricsLine(r.label, computeMetrics(r.equity), r.result));
  }
  lines.push("");
  lines.push("## 注意事項");
  lines.push("");
  lines.push("- 過去成績は将来を保証しない。採用判断はペーパートレード（P2）合格が前提");
  lines.push("- コスト実勢値の根拠と要再確認事項: [09-cost-research-2026-07.md](09-cost-research-2026-07.md)");
  lines.push("- 単一データソース（Tiingo）依存。採用決定前にクロスチェックを行うこと");

  writeFileSync(REPORT_PATH, lines.join("\n") + "\n");
  console.log(`report written: ${REPORT_PATH}`);

  // コンソールにはmoomooシナリオの要約を出す
  console.log(`\n共通ウィンドウ: ${alignStart} .. ${alignEnd}（moomooコスト・課税後）`);
  for (const c of mainCandidates()) {
    const r = runOne(c, MOOMOO_COSTS, alignStart);
    const m = computeMetrics(r.equity);
    console.log(
      `${c.label.padEnd(30)} CAGR ${pct(m.cagr).padStart(6)}  Sharpe ${num(m.sharpe)}  MaxDD ${pct(m.maxDrawdown).padStart(6)} ${m.maxDrawdown <= 0.2 ? "✓" : "✗"}  税 ${Math.round(r.result.totalTax / 1000)}千円`,
    );
  }
}

main();
