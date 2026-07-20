import { fetchTiingoDaily, fetchUsdJpyRange } from "@okina/market-data";
import { monthKey } from "@okina/strategy";
import { raiseAlert } from "../alerts.js";
import { RISK, allSymbols, coreStrategy, satelliteStrategy } from "../config.js";
import {
  getMeta,
  latestAdjCloses,
  latestFxRate,
  loadSeries,
  openPositions,
  setMeta,
  upsertBars,
} from "../db.js";
import type { Env } from "../env.js";

/**
 * 日次ジョブ（JST朝）: 取込 → 資産評価・DD → シグナル → 乖離チェック。
 * 各段が失敗しても後続を続け、失敗はアラートにする（黙って止まらない。docs/05 §1）。
 */
export async function runDaily(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  // --- 1. 価格取込（直近90日分を冪等upsert） ---
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  let ingestFailed = 0;
  for (const sym of allSymbols()) {
    try {
      const bars = await fetchTiingoDaily(sym, env.TIINGO_TOKEN, since);
      await upsertBars(env.DB, sym, bars);
    } catch (e) {
      ingestFailed++;
      await raiseAlert(env, {
        level: "warning",
        kind: "data_gap",
        message: `${sym} の取込に失敗: ${String(e).slice(0, 200)}`,
        dedupeKey: `data_gap:${sym}:${today}`,
      });
    }
  }

  // --- 2. 為替取込 ---
  try {
    const rates = await fetchUsdJpyRange(since, today);
    for (const r of rates) {
      await env.DB.prepare(
        `INSERT INTO fx_rates (pair, date, rate) VALUES ('USDJPY', ?, ?)
         ON CONFLICT (pair, date) DO UPDATE SET rate = excluded.rate`,
      )
        .bind(r.date, r.rate)
        .run();
    }
  } catch (e) {
    await raiseAlert(env, {
      level: "warning",
      kind: "data_gap",
      message: `USDJPY為替の取込に失敗: ${String(e).slice(0, 200)}`,
      dedupeKey: `data_gap:fx:${today}`,
    });
  }

  // --- 3. 資産評価とDD監視 ---
  try {
    await evaluatePortfolio(env, today);
  } catch (e) {
    await raiseAlert(env, {
      level: "critical",
      kind: "job_error",
      message: `資産評価に失敗: ${String(e).slice(0, 200)}`,
      dedupeKey: `job_error:portfolio:${today}`,
    });
  }

  // --- 4. 月次シグナル（月替わり後の最初の営業日に前月末分を計算） ---
  try {
    await computeMonthlySignals(env, today);
  } catch (e) {
    await raiseAlert(env, {
      level: "critical",
      kind: "job_error",
      message: `シグナル計算に失敗: ${String(e).slice(0, 200)}`,
      dedupeKey: `job_error:signals:${today}`,
    });
  }

  if (ingestFailed === 0) {
    console.log(`daily job done: ${today}`);
  }
}

async function evaluatePortfolio(env: Env, today: string): Promise<void> {
  const positions = await openPositions(env.DB);
  const fx = await latestFxRate(env.DB);
  if (!fx) return; // 為替が一度も入っていない初期状態

  const priceMap = await latestAdjCloses(env.DB, [...new Set(positions.map((p) => p.symbol))]);

  let totalUsd = 0;
  for (const p of positions) {
    const price = priceMap[p.symbol];
    if (!price) continue;
    totalUsd += p.qty * price.adjClose;
  }
  const { results: cashRows } = await env.DB.prepare(`SELECT * FROM account_cash`).all<{
    account: string;
    currency: string;
    amount: number;
  }>();
  let cashJpy = 0;
  for (const c of cashRows) {
    cashJpy += c.currency === "JPY" ? c.amount : c.amount * fx.rate;
  }
  const totalJpy = totalUsd * fx.rate + cashJpy;
  if (totalJpy <= 0) return; // ポジション未登録の初期状態では系列を作らない

  const prev = await env.DB.prepare(
    `SELECT peak_value_jpy FROM portfolio_daily ORDER BY date DESC LIMIT 1`,
  ).first<{ peak_value_jpy: number }>();
  const peak = Math.max(prev?.peak_value_jpy ?? 0, totalJpy);
  const dd = peak > 0 ? 1 - totalJpy / peak : 0;

  await env.DB.prepare(
    `INSERT INTO portfolio_daily (date, total_value_jpy, peak_value_jpy, drawdown)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (date) DO UPDATE SET
       total_value_jpy = excluded.total_value_jpy,
       peak_value_jpy = excluded.peak_value_jpy,
       drawdown = excluded.drawdown`,
  )
    .bind(today, totalJpy, peak, dd)
    .run();

  if (dd >= RISK.ddLimit) {
    await raiseAlert(env, {
      level: "critical",
      kind: "dd_limit",
      message: `ドローダウンが限界(-${RISK.ddLimit * 100}%)に到達: 現在 -${(dd * 100).toFixed(1)}%。戦略停止判断が必要です（01-strategy-spec §4）`,
      dedupeKey: `dd_limit:${monthKey(today)}`, // 月1回に抑制
    });
  } else if (dd >= RISK.ddWarning) {
    await raiseAlert(env, {
      level: "warning",
      kind: "dd_warning",
      message: `ドローダウン警告: 現在 -${(dd * 100).toFixed(1)}%（警告ライン -${RISK.ddWarning * 100}%）`,
      dedupeKey: `dd_warning:${monthKey(today)}`,
    });
  }
}

async function computeMonthlySignals(env: Env, today: string): Promise<void> {
  const thisMonth = monthKey(today);
  const lastRun = await getMeta(env.DB, "signals:lastMonth");
  if (lastRun === thisMonth) return; // 今月分は計算済み

  // ウォームアップ400営業日 ≒ 暦600日を確保
  const from = new Date(Date.now() - 600 * 86400000).toISOString().slice(0, 10);
  const satellite = satelliteStrategy();
  const series = await loadSeries(env.DB, satellite.symbols, from);

  // 全シンボルのデータが揃っていることを確認（欠損時はシグナルを出さない）
  for (const sym of satellite.symbols) {
    if (!series[sym] || series[sym].length < satellite.warmupDays) {
      await raiseAlert(env, {
        level: "warning",
        kind: "data_gap",
        message: `シグナル計算スキップ: ${sym} の履歴不足（${series[sym]?.length ?? 0}日 < ${satellite.warmupDays}日）`,
        dedupeKey: `signal_skip:${thisMonth}`,
      });
      return;
    }
  }

  const lastDate = series[satellite.symbols[0]!]!.at(-1)!.date;
  // 前月末シグナル: 当月に入ってから計算する（月中に走っても前月末値では確定しないため）
  if (monthKey(lastDate) === thisMonth) {
    // データが当月分まで来ている＝前月末データは確定済み。前月末までの履歴で計算する
    const trimmed: typeof series = {};
    for (const sym of satellite.symbols) {
      trimmed[sym] = series[sym]!.filter((b) => monthKey(b.date) !== thisMonth);
    }
    const asOf = trimmed[satellite.symbols[0]!]!.at(-1)!.date;
    const weights = satellite.targetWeights(asOf, trimmed);

    const inserted: string[] = [];
    for (const sym of satellite.symbols) {
      const w = weights[sym] ?? 0;
      await env.DB.prepare(
        `INSERT INTO signals (date, strategy, symbol, action, detail) VALUES (?, ?, ?, 'rebalance', ?)`,
      )
        .bind(asOf, satellite.id, sym, JSON.stringify({ targetWeight: w }))
        .run();
      if (w > 0) inserted.push(`${sym} ${(w * 100).toFixed(0)}%`);
    }
    await setMeta(env.DB, "signals:lastMonth", thisMonth);
    await raiseAlert(env, {
      level: "info",
      kind: "signal",
      message: `月次シグナル確定（基準日 ${asOf}）: ${inserted.length > 0 ? inserted.join(", ") : "全額現金退避"}。ダッシュボードで確認し発注してください`,
      dedupeKey: `signal:${thisMonth}`,
    });
  }
}
