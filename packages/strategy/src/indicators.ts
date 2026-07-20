/** 単純移動平均。データ不足なら null */
export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i]!;
  }
  return sum / period;
}

/** lookback 本前からのリターン。データ不足なら null */
export function totalReturn(values: number[], lookback: number): number | null {
  if (lookback <= 0 || values.length < lookback + 1) return null;
  const last = values[values.length - 1]!;
  const base = values[values.length - 1 - lookback]!;
  if (base === 0) return null;
  return last / base - 1;
}
