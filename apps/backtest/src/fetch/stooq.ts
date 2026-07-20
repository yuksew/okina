import type { DailyBar } from "@okina/strategy";

/**
 * Stooq の無料CSV（https://stooq.com/q/d/l/?s=spy.us&i=d）から日次バーを取得。
 *
 * 注意（docs/02-research §2）:
 * - Stooq の Close は分割・配当調整済みとされるが調整手法は非公開。
 *   → 本番の主ソースは Tiingo とし、Stooq はスモーク・クロスチェック用。
 * - 日次アクセス上限が低いため、少数シンボルの一括取得のみに使う。
 */
export async function fetchStooqDaily(stooqSymbol: string): Promise<DailyBar[]> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`stooq fetch failed for ${stooqSymbol}: HTTP ${res.status}`);
  }
  const text = (await res.text()).trim();
  if (text.startsWith("Exceeded")) {
    throw new Error(`stooq daily limit exceeded (symbol: ${stooqSymbol})`);
  }
  const lines = text.split("\n");
  const header = lines[0];
  if (!header || !header.startsWith("Date,Open,High,Low,Close")) {
    throw new Error(
      `unexpected stooq response for ${stooqSymbol}: ${text.slice(0, 120)}`,
    );
  }
  const hasVolume = header.includes("Volume");
  const bars: DailyBar[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const [date, open, high, low, close] = cols;
    if (!date || !open || !high || !low || !close) continue;
    const c = Number(close);
    bars.push({
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: c,
      adjClose: c, // Stooq は調整済みCloseのみ提供（未調整は取れない）
      volume: hasVolume && cols[5] ? Number(cols[5]) : 0,
    });
  }
  return bars;
}
