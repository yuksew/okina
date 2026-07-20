import { describe, expect, it } from "vitest";
import { makeS3 } from "./s3-dual-momentum.js";
import { makeS4 } from "./s4-momentum-rotation.js";
import type { DailyBar, SeriesMap } from "../types.js";

/** 月末バーだけの合成シリーズ（月次リターン固定） */
function monthlySeries(months: number, monthlyReturn: number, init = 100): DailyBar[] {
  const bars: DailyBar[] = [];
  let price = init;
  for (let m = 0; m < months; m++) {
    const year = 2020 + Math.floor(m / 12);
    const mm = String((m % 12) + 1).padStart(2, "0");
    bars.push({
      date: `${year}-${mm}-28`,
      open: price, high: price, low: price, close: price, adjClose: price, volume: 0,
    });
    price *= 1 + monthlyReturn;
  }
  return bars;
}

describe("S3 dual momentum", () => {
  const history: SeriesMap = {
    SPY: monthlySeries(14, 0.02), // 強い
    EFA: monthlySeries(14, 0.01), // 中間
    SHY: monthlySeries(14, 0.001), // Tビル代替
    AGG: monthlySeries(14, 0.002),
  };
  const s3 = makeS3({ risky: ["SPY", "EFA"], safe: "AGG", cashProxy: "SHY" });

  it("最強のリスク資産に100%集中する", () => {
    const w = s3.targetWeights("2021-02-28", history);
    expect(w["SPY"]).toBe(1);
    expect(w["EFA"]).toBe(0);
    expect(w["AGG"]).toBe(0);
  });

  it("リスク資産がTビル代替に負けたら退避先へ", () => {
    const bear: SeriesMap = {
      ...history,
      SPY: monthlySeries(14, -0.02),
      EFA: monthlySeries(14, -0.03),
    };
    const w = s3.targetWeights("2021-02-28", bear);
    expect(w["AGG"]).toBe(1);
    expect(w["SPY"]).toBe(0);
  });
});

describe("S4 momentum rotation", () => {
  it("スコア上位N本を等ウェイト、スコア<=0の枠は現金", () => {
    const history: SeriesMap = {
      A: monthlySeries(14, 0.03),
      B: monthlySeries(14, 0.02),
      C: monthlySeries(14, 0.01),
      D: monthlySeries(14, -0.02),
    };
    const s4 = makeS4({ universe: ["A", "B", "C", "D"], topN: 2 });
    const w = s4.targetWeights("2021-02-28", history);
    expect(w["A"]).toBeCloseTo(0.5);
    expect(w["B"]).toBeCloseTo(0.5);
    expect(w["C"]).toBe(0);
    expect(w["D"]).toBe(0);

    // 全滅相場では全枠現金
    const bear: SeriesMap = {
      A: monthlySeries(14, -0.01),
      B: monthlySeries(14, -0.02),
      C: monthlySeries(14, -0.03),
      D: monthlySeries(14, -0.04),
    };
    const wBear = s4.targetWeights("2021-02-28", bear);
    expect(Object.values(wBear).every((x) => x === 0)).toBe(true);
  });

  it("データ不足の銘柄はランキング対象外", () => {
    const history: SeriesMap = {
      A: monthlySeries(14, 0.01),
      NEW: monthlySeries(3, 0.10), // 上場3ヶ月
    };
    const s4 = makeS4({ universe: ["A", "NEW"], topN: 1 });
    const w = s4.targetWeights("2021-02-28", history);
    expect(w["A"]).toBe(1);
    expect(w["NEW"]).toBe(0);
  });
});
