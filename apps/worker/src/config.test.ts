import { describe, expect, it } from "vitest";
import { coreStrategy, satelliteStrategy, allSymbols } from "./config.js";

/**
 * 本番設定がバックテスト採用構成（docs/10-p1-gate-decision.md）と一致していることの検証。
 * ここが崩れると「検証していない戦略が本番で動く」ため、IDレベルで固定する。
 */
describe("採用構成の固定", () => {
  it("コアは S5 SPY30/AGG70 年次", () => {
    const core = coreStrategy();
    expect(core.id).toBe("s1-fixed-SPY30-AGG70-yearly");
    expect(core.targetWeights("2026-01-01", {})).toEqual({ SPY: 0.3, AGG: 0.7 });
  });

  it("サテライトは blend-s2-s4t4-5050（S2 GTAA5 10m + S4 Top4 3/6/12m）", () => {
    const sat = satelliteStrategy();
    expect(sat.id).toBe("blend-s2-s4t4-5050");
    expect(sat.rebalance).toBe("monthly");
    // ブレンドの中身が変わったら symbols 構成で検知する
    expect([...sat.symbols].sort()).toEqual(
      ["AGG", "EEM", "EFA", "GLD", "IEF", "QQQ", "SPY", "TLT", "VNQ"].sort(),
    );
  });

  it("取込対象はユニバース10本のうちSHYを除く9本+コア分", () => {
    const syms = allSymbols();
    expect(syms).toContain("SPY");
    expect(syms).toContain("AGG");
    expect(syms.length).toBe(9);
  });
});
