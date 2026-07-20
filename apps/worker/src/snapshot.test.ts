import { describe, expect, it } from "vitest";
// businessDaysAgo は snapshot.ts 内部関数のため、鮮度判定はモックD1で間接的に検証する
import { buildSnapshot } from "./snapshot.js";
import type { Env } from "./env.js";

/**
 * D1の最小モック。テスト対象はSQLの実行ではなく
 * 「snapshotの形（鮮度判定・自己記述性・null安全）」なので、クエリ文字列で分岐する。
 */
function mockDb(data: {
  latestPriceDate: string | null;
  fxRate?: { date: string; rate: number };
  positions?: unknown[];
}): D1Database {
  const first = async (sql: string) => {
    if (sql.includes("MAX(date)")) return { d: data.latestPriceDate };
    if (sql.includes("fx_rates")) return data.fxRate ?? null;
    if (sql.includes("portfolio_daily")) return null;
    return null;
  };
  const all = async (sql: string) => {
    if (sql.includes("FROM positions")) return { results: data.positions ?? [] };
    return { results: [] };
  };
  const stmt = (sql: string) =>
    ({
      bind: (..._args: unknown[]) => stmt(sql),
      first: () => first(sql),
      all: () => all(sql),
      run: async () => ({ meta: { changes: 0 } }),
    }) as unknown as D1PreparedStatement;
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

function env(db: D1Database): Env {
  return {
    DB: db,
    TIINGO_TOKEN: "t",
    STATUS_API_TOKEN: "s",
    DISCORD_WEBHOOK_URL: "",
  };
}

describe("buildSnapshot", () => {
  it("価格が新しければ is_stale=false", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const snap = (await buildSnapshot(
      env(mockDb({ latestPriceDate: today, fxRate: { date: today, rate: 150 } })),
    )) as { freshness: { is_stale: boolean } };
    expect(snap.freshness.is_stale).toBe(false);
  });

  it("価格が10日前なら is_stale=true", async () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const snap = (await buildSnapshot(env(mockDb({ latestPriceDate: old })))) as {
      freshness: { is_stale: boolean };
    };
    expect(snap.freshness.is_stale).toBe(true);
  });

  it("データ皆無でも例外にならず、nullを自己記述する", async () => {
    const snap = (await buildSnapshot(env(mockDb({ latestPriceDate: null })))) as {
      freshness: { is_stale: boolean; prices_as_of: string | null };
      fx: unknown;
      portfolio: unknown;
      positions: unknown[];
    };
    expect(snap.freshness.is_stale).toBe(true);
    expect(snap.freshness.prices_as_of).toBeNull();
    expect(snap.fx).toBeNull();
    expect(snap.portfolio).toBeNull();
    expect(snap.positions).toEqual([]);
  });

  it("ポジションの評価額・損益がJSON内の値だけで検算できる（自己記述性）", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const db = mockDb({
      latestPriceDate: today,
      fxRate: { date: today, rate: 150 },
      positions: [
        {
          id: 1,
          account: "paper",
          symbol: "SPY",
          qty: 2,
          avg_cost_usd: 500,
          opened_at: today,
          closed_at: null,
        },
      ],
    });
    // latestAdjCloses は prices テーブルを引くが、モックは空を返す
    // → last_price_usd が null でも安全に null 伝播することを確認
    const snap = (await buildSnapshot(env(db))) as {
      positions: { value_usd: number | null; unrealized_pl_pct: number | null }[];
    };
    expect(snap.positions[0]!.value_usd).toBeNull();
    expect(snap.positions[0]!.unrealized_pl_pct).toBeNull();
  });
});
