import type { DailyBar } from "@okina/strategy";

interface TiingoRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose: number;
}

/**
 * Tiingo 公式API（主データソース）。Workers/Node 両対応（fetch のみ使用）。
 * 無料枠: 1,000req/日・50req/時・500ユニークシンボル/月（2026-07時点、docs/02-research §2）
 */
export async function fetchTiingoDaily(
  symbol: string,
  token: string,
  startDate = "1990-01-01",
): Promise<DailyBar[]> {
  const url =
    `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices` +
    `?startDate=${startDate}&format=json&token=${token}`;
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    throw new Error(`tiingo fetch failed for ${symbol}: HTTP ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as TiingoRow[];
  return rows.map((r) => ({
    date: r.date.slice(0, 10),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    adjClose: r.adjClose,
    volume: r.volume,
  }));
}
