import { describe, expect, it } from "vitest";
import { sma, totalReturn } from "./indicators.js";
import { monthEndCloses, isMonthEndFactory } from "./calendar.js";
import { makeS1 } from "./strategies/s1-fixed-allocation.js";
import { makeS2 } from "./strategies/s2-trend-filter.js";
import type { DailyBar } from "./types.js";

function bar(date: string, adjClose: number): DailyBar {
  return { date, open: adjClose, high: adjClose, low: adjClose, close: adjClose, adjClose, volume: 0 };
}

describe("sma", () => {
  it("計算とデータ不足時のnull", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1, 2], 3)).toBeNull();
  });
});

describe("totalReturn", () => {
  it("lookback本前からのリターン", () => {
    expect(totalReturn([100, 110, 121], 2)).toBeCloseTo(0.21);
    expect(totalReturn([100], 1)).toBeNull();
  });
});

describe("monthEndCloses", () => {
  it("各月の最終営業日を抽出する", () => {
    const bars = [
      bar("2024-01-30", 10),
      bar("2024-01-31", 11),
      bar("2024-02-01", 12),
      bar("2024-02-29", 13),
      bar("2024-03-01", 14),
    ];
    expect(monthEndCloses(bars)).toEqual([
      { date: "2024-01-31", value: 11 },
      { date: "2024-02-29", value: 13 },
      { date: "2024-03-01", value: 14 }, // 進行中の月は最新日
    ]);
  });
});

describe("isMonthEndFactory", () => {
  it("月替わりの前日をtrueにする", () => {
    const dates = ["2024-01-30", "2024-01-31", "2024-02-01"];
    const isMonthEnd = isMonthEndFactory(dates);
    expect(isMonthEnd(0)).toBe(false);
    expect(isMonthEnd(1)).toBe(true);
    expect(isMonthEnd(2)).toBe(true); // 末尾は月末扱い
  });
});

describe("S1", () => {
  it("常に固定ウェイトを返す", () => {
    const s1 = makeS1({ SPY: 0.7, AGG: 0.3 });
    expect(s1.targetWeights("2024-01-31", {})).toEqual({ SPY: 0.7, AGG: 0.3 });
  });
  it("合計>1で例外", () => {
    expect(() => makeS1({ SPY: 0.8, AGG: 0.3 })).toThrow();
  });
});

describe("S2", () => {
  it("SMA超の資産のみ等ウェイト、下回りは0（現金退避）", () => {
    // 12ヶ月分の月末バー: UP は上昇継続、DOWN は下落継続
    const up: DailyBar[] = [];
    const down: DailyBar[] = [];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      up.push(bar(`2024-${mm}-28`, 100 + m * 5));
      down.push(bar(`2024-${mm}-28`, 200 - m * 10));
    }
    const s2 = makeS2(["UP", "DOWN"], 10);
    const w = s2.targetWeights("2024-12-28", { UP: up, DOWN: down });
    expect(w["UP"]).toBeCloseTo(0.5);
    expect(w["DOWN"]).toBe(0);
  });
});
