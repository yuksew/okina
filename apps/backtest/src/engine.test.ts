import { describe, expect, it } from "vitest";
import { makeS1, type DailyBar, type SeriesMap } from "@okina/strategy";
import { runBacktest } from "./engine.js";
import { computeMetrics } from "./metrics.js";

/** 営業日っぽい平日日次バーを生成（等比成長） */
function makeSeries(start: string, days: number, dailyGrowth: number, init = 100): DailyBar[] {
  const bars: DailyBar[] = [];
  const d = new Date(start + "T00:00:00Z");
  let price = init;
  while (bars.length < days) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const date = d.toISOString().slice(0, 10);
      bars.push({ date, open: price, high: price, low: price, close: price, adjClose: price, volume: 0 });
      price *= 1 + dailyGrowth;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return bars;
}

describe("runBacktest", () => {
  it("コストゼロ・単一資産100%なら資産成長は原資産と一致する", () => {
    const series: SeriesMap = { SPY: makeSeries("2020-01-01", 300, 0.001) };
    const s = makeS1({ SPY: 1 }, "monthly");
    const r = runBacktest({
      series,
      strategy: s,
      initialCapital: 1000,
      costs: { commissionRate: 0, slippageRate: 0 },
    });
    const firstPrice = series["SPY"]![0]!.adjClose;
    const lastPrice = series["SPY"]![series["SPY"]!.length - 1]!.adjClose;
    const expected = (1000 * lastPrice) / firstPrice;
    expect(r.equity[r.equity.length - 1]!.value).toBeCloseTo(expected, 6);
  });

  it("コストありはコストゼロより最終資産が小さく、コストが記録される", () => {
    const series: SeriesMap = {
      A: makeSeries("2020-01-01", 300, 0.001),
      B: makeSeries("2020-01-01", 300, -0.0005),
    };
    const s = makeS1({ A: 0.6, B: 0.4 }, "monthly");
    const noCost = runBacktest({ series, strategy: s, costs: { commissionRate: 0, slippageRate: 0 } });
    const withCost = runBacktest({ series, strategy: s, costs: { commissionRate: 0.005, slippageRate: 0.001 } });
    expect(withCost.equity.at(-1)!.value).toBeLessThan(noCost.equity.at(-1)!.value);
    expect(withCost.totalCosts).toBeGreaterThan(0);
    expect(withCost.trades.length).toBeGreaterThan(0);
  });

  it("共通日付のみ使用する（片方が遅く上場したケース）", () => {
    const series: SeriesMap = {
      A: makeSeries("2020-01-01", 300, 0.001),
      B: makeSeries("2020-03-01", 260, 0.001),
    };
    const s = makeS1({ A: 0.5, B: 0.5 }, "monthly");
    const r = runBacktest({ series, strategy: s, costs: { commissionRate: 0, slippageRate: 0 } });
    expect(r.from >= "2020-03-01").toBe(true);
  });
});

describe("税モデル（特定口座・源泉徴収あり）", () => {
  // 6月末に全売却する人工戦略（それ以外は全額A保有）
  const sellInJune = {
    id: "test-sell",
    description: "test",
    symbols: ["A"],
    rebalance: "monthly" as const,
    warmupDays: 0,
    targetWeights(date: string) {
      return { A: date >= "2020-06-15" && date <= "2020-07-15" ? 0 : 1 };
    },
  };

  it("値上がり益の売却で20.315%が源泉徴収される", () => {
    const series: SeriesMap = { A: makeSeries("2020-01-01", 260, 0.002) };
    const noTax = runBacktest({
      series, strategy: sellInJune,
      costs: { commissionRate: 0, slippageRate: 0 },
    });
    const withTax = runBacktest({
      series, strategy: sellInJune,
      costs: { commissionRate: 0, slippageRate: 0 },
      taxRate: 0.20315,
    });
    expect(withTax.totalTax).toBeGreaterThan(0);
    const gain = noTax.trades
      .filter((t) => t.notional < 0)
      .reduce((s, t) => s - t.notional, 0) - 1_000_000; // 売却額 - 取得費
    expect(withTax.totalTax).toBeCloseTo(gain * 0.20315, 0);
    expect(withTax.equity.at(-1)!.value).toBeCloseTo(
      noTax.equity.at(-1)!.value - withTax.totalTax * (noTax.equity.at(-1)!.value / noTax.equity.find((p) => p.date >= "2020-07-15")!.value),
      -2, // 再投資分の複利があるため緩い一致で確認
    );
  });

  it("損失売却なら税額ゼロ（マイナス課税しない）", () => {
    const series: SeriesMap = { A: makeSeries("2020-01-01", 260, -0.002) };
    const withTax = runBacktest({
      series, strategy: sellInJune,
      costs: { commissionRate: 0, slippageRate: 0 },
      taxRate: 0.20315,
    });
    expect(withTax.totalTax).toBe(0);
  });
});

describe("computeMetrics", () => {
  it("単調増加ならDDゼロ、下落を含むならDDが出る", () => {
    const up = [
      { date: "2020-01-01", value: 100 },
      { date: "2020-07-01", value: 110 },
      { date: "2021-01-01", value: 121 },
    ];
    const m1 = computeMetrics(up);
    expect(m1.maxDrawdown).toBe(0);
    expect(m1.cagr).toBeCloseTo(0.21, 1);

    const withDip = [
      { date: "2020-01-01", value: 100 },
      { date: "2020-06-01", value: 80 },
      { date: "2021-01-01", value: 120 },
    ];
    const m2 = computeMetrics(withDip);
    expect(m2.maxDrawdown).toBeCloseTo(0.2);
    expect(m2.maxUnderwaterDays).toBeGreaterThan(100);
  });
});
