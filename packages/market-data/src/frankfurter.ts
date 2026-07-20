/**
 * Frankfurter API（ECB参照レート、キー不要・無料）。docs/02-research §2
 * 平日15時CET以降に当日分更新。週末・祝日は直前営業日の値が最新。
 */
export interface FxRate {
  date: string;
  rate: number;
}

export async function fetchUsdJpyLatest(): Promise<FxRate> {
  const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY");
  if (!res.ok) throw new Error(`frankfurter fetch failed: HTTP ${res.status}`);
  const data = (await res.json()) as { date: string; rates: { JPY: number } };
  return { date: data.date, rate: data.rates.JPY };
}

export async function fetchUsdJpyRange(from: string, to: string): Promise<FxRate[]> {
  const res = await fetch(
    `https://api.frankfurter.dev/v1/${from}..${to}?base=USD&symbols=JPY`,
  );
  if (!res.ok) throw new Error(`frankfurter fetch failed: HTTP ${res.status}`);
  const data = (await res.json()) as { rates: Record<string, { JPY: number }> };
  return Object.entries(data.rates)
    .map(([date, r]) => ({ date, rate: r.JPY }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
