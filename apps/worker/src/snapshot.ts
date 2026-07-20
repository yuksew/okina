import { RISK, coreStrategy } from "./config.js";
import {
  latestAdjCloses,
  latestFxRate,
  latestPriceDate,
  openPositions,
} from "./db.js";
import type { Env } from "./env.js";

/**
 * 状況更新スナップショット（docs/05 §3.1）。
 * Claudeルーチンはこの1レスポンスだけでレポートを書ける必要がある。
 * すべての数値に単位・時点を自己記述させる（単位取り違えを構造で防ぐ）。
 */
export async function buildSnapshot(env: Env): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const [priceDate, fx, positions] = await Promise.all([
    latestPriceDate(env.DB),
    latestFxRate(env.DB),
    openPositions(env.DB),
  ]);

  // 鮮度判定はWorker側で確定させ、Claudeの裁量にしない（docs/05 §3.1）
  const staleThreshold = businessDaysAgo(today, RISK.staleAfterBusinessDays);
  const isStale = !priceDate || priceDate < staleThreshold;

  const symbols = [...new Set(positions.map((p) => p.symbol))];
  const prices = await latestAdjCloses(env.DB, symbols);

  const positionViews = positions.map((p) => {
    const price = prices[p.symbol];
    const valueUsd = price ? p.qty * price.adjClose : null;
    const plUsd = price ? (price.adjClose - p.avg_cost_usd) * p.qty : null;
    return {
      account: p.account,
      symbol: p.symbol,
      qty: p.qty,
      avg_cost_usd: p.avg_cost_usd,
      last_price_usd: price?.adjClose ?? null,
      last_price_date: price?.date ?? null,
      value_usd: valueUsd,
      value_jpy: valueUsd !== null && fx ? valueUsd * fx.rate : null,
      unrealized_pl_usd: plUsd,
      unrealized_pl_pct:
        plUsd !== null && p.avg_cost_usd > 0 ? plUsd / (p.avg_cost_usd * p.qty) : null,
    };
  });

  const ddRow = await env.DB.prepare(
    `SELECT date, total_value_jpy, drawdown FROM portfolio_daily ORDER BY date DESC LIMIT 1`,
  ).first<{ date: string; total_value_jpy: number; drawdown: number }>();

  const { results: pendingSignals } = await env.DB.prepare(
    `SELECT id, date, strategy, symbol, action, detail FROM signals
     WHERE acknowledged_at IS NULL ORDER BY date DESC, id ASC LIMIT 50`,
  ).all();

  const { results: recentAlerts } = await env.DB.prepare(
    `SELECT ts, level, kind, message FROM alerts ORDER BY ts DESC LIMIT 20`,
  ).all();

  // 市場概況: 主要指標ETFの直近値と前日比
  const marketSymbols = ["SPY", "QQQ", "AGG", "GLD"];
  const marketPrices = await latestAdjCloses(env.DB, marketSymbols);
  const market = Object.fromEntries(
    Object.entries(marketPrices).map(([sym, p]) => [
      sym,
      {
        date: p.date,
        adj_close_usd: p.adjClose,
        day_change_pct: p.prevAdjClose ? p.adjClose / p.prevAdjClose - 1 : null,
      },
    ]),
  );

  // コア配分乖離（NISA口座のS5目標との差）
  const core = coreStrategy();
  const coreTargets = core.targetWeights(today, {});
  const corePositions = positionViews.filter((p) => p.account === "nisa");
  const coreTotalUsd = corePositions.reduce((s, p) => s + (p.value_usd ?? 0), 0);
  const coreDrift = Object.entries(coreTargets).map(([sym, target]) => {
    const actual =
      coreTotalUsd > 0
        ? (corePositions.find((p) => p.symbol === sym)?.value_usd ?? 0) / coreTotalUsd
        : 0;
    return {
      symbol: sym,
      target_weight: target,
      actual_weight: actual,
      drift: actual - target,
      exceeds_limit: Math.abs(actual - target) > RISK.coreDriftLimit,
    };
  });

  return {
    as_of: now,
    freshness: {
      prices_as_of: priceDate,
      fx_as_of: fx?.date ?? null,
      expected_min_date: staleThreshold,
      is_stale: isStale,
    },
    fx: fx ? { pair: "USDJPY", rate: fx.rate, date: fx.date } : null,
    portfolio: ddRow
      ? {
          date: ddRow.date,
          total_value_jpy: ddRow.total_value_jpy,
          drawdown_pct: ddRow.drawdown,
          dd_warning_at: RISK.ddWarning,
          dd_limit_at: RISK.ddLimit,
        }
      : null,
    positions: positionViews,
    core_allocation: {
      strategy_id: core.id,
      drift_limit: RISK.coreDriftLimit,
      items: coreDrift,
    },
    pending_signals: pendingSignals,
    recent_alerts: recentAlerts,
    market,
  };
}

/** date から n 営業日前（土日のみ考慮、祝日は無視=保守側） */
function businessDaysAgo(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  let remaining = n;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}
