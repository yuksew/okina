import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DailyBar, SeriesMap } from "@okina/strategy";

const DEFAULT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "market.db",
);

export function openDb(path: string = DEFAULT_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS prices (
      symbol     TEXT NOT NULL,
      date       TEXT NOT NULL,
      open       REAL NOT NULL,
      high       REAL NOT NULL,
      low        REAL NOT NULL,
      close      REAL NOT NULL,
      adj_close  REAL NOT NULL,
      volume     INTEGER NOT NULL,
      source     TEXT NOT NULL,
      PRIMARY KEY (symbol, date)
    );
  `);
  return db;
}

export function upsertBars(
  db: Database.Database,
  symbol: string,
  source: string,
  bars: DailyBar[],
): number {
  const stmt = db.prepare(`
    INSERT INTO prices (symbol, date, open, high, low, close, adj_close, volume, source)
    VALUES (@symbol, @date, @open, @high, @low, @close, @adjClose, @volume, @source)
    ON CONFLICT (symbol, date) DO UPDATE SET
      open=excluded.open, high=excluded.high, low=excluded.low,
      close=excluded.close, adj_close=excluded.adj_close,
      volume=excluded.volume, source=excluded.source
  `);
  const insertAll = db.transaction((rows: DailyBar[]) => {
    for (const b of rows) stmt.run({ ...b, symbol, source });
  });
  insertAll(bars);
  return bars.length;
}

export function loadSeries(
  db: Database.Database,
  symbols: string[],
  from?: string,
  to?: string,
): SeriesMap {
  const stmt = db.prepare(`
    SELECT date, open, high, low, close, adj_close AS adjClose, volume
    FROM prices
    WHERE symbol = ? AND date >= ? AND date <= ?
    ORDER BY date ASC
  `);
  const series: SeriesMap = {};
  for (const sym of symbols) {
    series[sym] = stmt.all(sym, from ?? "0000-00-00", to ?? "9999-99-99") as DailyBar[];
  }
  return series;
}
