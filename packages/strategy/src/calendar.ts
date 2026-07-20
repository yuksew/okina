import type { DailyBar } from "./types.js";

/** YYYY-MM-DD から YYYY-MM を取り出す */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** 日付昇順のバー列から「各月の最終営業日の値」を取り出す（当月は最新日を月末とみなす） */
export function monthEndCloses(bars: DailyBar[]): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  for (let i = 0; i < bars.length; i++) {
    const cur = bars[i]!;
    const next = bars[i + 1];
    if (!next || monthKey(next.date) !== monthKey(cur.date)) {
      out.push({ date: cur.date, value: cur.adjClose });
    }
  }
  return out;
}

/** 日付昇順の日付列に対し「その日が月の最終営業日か」を返す判定器を作る */
export function isMonthEndFactory(dates: string[]): (index: number) => boolean {
  return (index: number) => {
    const cur = dates[index];
    const next = dates[index + 1];
    if (cur === undefined) return false;
    if (next === undefined) return true;
    return monthKey(next) !== monthKey(cur);
  };
}

/** 同様に「その日が年の最終営業日か」 */
export function isYearEndFactory(dates: string[]): (index: number) => boolean {
  return (index: number) => {
    const cur = dates[index];
    const next = dates[index + 1];
    if (cur === undefined) return false;
    if (next === undefined) return true;
    return next.slice(0, 4) !== cur.slice(0, 4);
  };
}

/** ISO週番号ベースで「その日が週の最終営業日か」 */
export function isWeekEndFactory(dates: string[]): (index: number) => boolean {
  const weekKey = (d: string): string => {
    const dt = new Date(d + "T00:00:00Z");
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((dt.getTime() - yearStart) / 86400000 + 1) / 7);
    return `${dt.getUTCFullYear()}-W${week}`;
  };
  return (index: number) => {
    const cur = dates[index];
    const next = dates[index + 1];
    if (cur === undefined) return false;
    if (next === undefined) return true;
    return weekKey(next) !== weekKey(cur);
  };
}
