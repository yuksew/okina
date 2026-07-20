import type { DailyBar, SeriesMap } from "@okina/strategy";

export interface PositionRow {
  id: number;
  account: "nisa" | "tokutei" | "paper";
  symbol: string;
  qty: number;
  avg_cost_usd: number;
  opened_at: string;
  closed_at: string | null;
}

export interface SignalRow {
  id: number;
  date: string;
  strategy: string;
  symbol: string;
  action: string;
  detail: string;
  acknowledged_at: string | null;
}

export async function upsertBars(db: D1Database, symbol: string, bars: DailyBar[]): Promise<void> {
  const stmt = db.prepare(`
    INSERT INTO prices (symbol, date, open, high, low, close, adj_close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (symbol, date) DO UPDATE SET
      open=excluded.open, high=excluded.high, low=excluded.low,
      close=excluded.close, adj_close=excluded.adj_close, volume=excluded.volume
  `);
  // D1 batch は1回1000文まで。日次更新は数十行、初期投入時のみ分割が効く
  for (let i = 0; i < bars.length; i += 500) {
    const chunk = bars.slice(i, i + 500);
    await db.batch(
      chunk.map((b) =>
        stmt.bind(symbol, b.date, b.open, b.high, b.low, b.close, b.adjClose, b.volume),
      ),
    );
  }
}

export async function loadSeries(
  db: D1Database,
  symbols: string[],
  fromDate: string,
): Promise<SeriesMap> {
  const series: SeriesMap = {};
  for (const sym of symbols) {
    const { results } = await db
      .prepare(
        `SELECT date, open, high, low, close, adj_close AS adjClose, volume
         FROM prices WHERE symbol = ? AND date >= ? ORDER BY date ASC`,
      )
      .bind(sym, fromDate)
      .all<DailyBar>();
    series[sym] = results;
  }
  return series;
}

export async function latestPriceDate(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(`SELECT MAX(date) AS d FROM prices`)
    .first<{ d: string | null }>();
  return row?.d ?? null;
}

export async function latestAdjCloses(
  db: D1Database,
  symbols: string[],
): Promise<Record<string, { date: string; adjClose: number; prevAdjClose: number | null }>> {
  const out: Record<string, { date: string; adjClose: number; prevAdjClose: number | null }> = {};
  for (const sym of symbols) {
    const { results } = await db
      .prepare(
        `SELECT date, adj_close AS adjClose FROM prices
         WHERE symbol = ? ORDER BY date DESC LIMIT 2`,
      )
      .bind(sym)
      .all<{ date: string; adjClose: number }>();
    const [last, prev] = results;
    if (last) {
      out[sym] = { date: last.date, adjClose: last.adjClose, prevAdjClose: prev?.adjClose ?? null };
    }
  }
  return out;
}

export async function latestFxRate(db: D1Database): Promise<{ date: string; rate: number } | null> {
  return db
    .prepare(`SELECT date, rate FROM fx_rates WHERE pair = 'USDJPY' ORDER BY date DESC LIMIT 1`)
    .first<{ date: string; rate: number }>();
}

export async function openPositions(db: D1Database): Promise<PositionRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM positions WHERE closed_at IS NULL ORDER BY account, symbol`)
    .all<PositionRow>();
  return results;
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM meta WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    .bind(key, value)
    .run();
}
