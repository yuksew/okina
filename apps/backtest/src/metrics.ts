import type { EquityPoint } from "./engine.js";

export interface Metrics {
  cagr: number;
  annualVol: number;
  sharpe: number;
  maxDrawdown: number;
  calmar: number;
  /** 直近ピークを更新できなかった最長期間（暦日） */
  maxUnderwaterDays: number;
  endValue: number;
  years: number;
}

export function computeMetrics(equity: EquityPoint[]): Metrics {
  if (equity.length < 2) throw new Error("need at least 2 equity points");
  const first = equity[0]!;
  const last = equity[equity.length - 1]!;
  const years =
    (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 24 * 3600 * 1000);
  const cagr = years > 0 ? Math.pow(last.value / first.value, 1 / years) - 1 : 0;

  const dailyReturns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    dailyReturns.push(equity[i]!.value / equity[i - 1]!.value - 1);
  }
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) /
    (dailyReturns.length - 1);
  const dailyVol = Math.sqrt(variance);
  const annualVol = dailyVol * Math.sqrt(252);
  const sharpe = dailyVol > 0 ? (mean / dailyVol) * Math.sqrt(252) : 0;

  let peak = first.value;
  let peakDate = first.date;
  let maxDrawdown = 0;
  let maxUnderwaterDays = 0;
  for (const p of equity) {
    if (p.value >= peak) {
      peak = p.value;
      peakDate = p.date;
    } else {
      maxDrawdown = Math.max(maxDrawdown, 1 - p.value / peak);
      const days = (Date.parse(p.date) - Date.parse(peakDate)) / 86400000;
      maxUnderwaterDays = Math.max(maxUnderwaterDays, days);
    }
  }
  const calmar = maxDrawdown > 0 ? cagr / maxDrawdown : Infinity;

  return {
    cagr,
    annualVol,
    sharpe,
    maxDrawdown,
    calmar,
    maxUnderwaterDays,
    endValue: last.value,
    years,
  };
}
