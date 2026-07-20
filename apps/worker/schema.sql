-- okina D1 schema（冪等: IF NOT EXISTS のみ使用。破壊的変更は別マイグレーションで）

CREATE TABLE IF NOT EXISTS prices (
  symbol     TEXT NOT NULL,
  date       TEXT NOT NULL, -- YYYY-MM-DD
  open       REAL NOT NULL,
  high       REAL NOT NULL,
  low        REAL NOT NULL,
  close      REAL NOT NULL,
  adj_close  REAL NOT NULL,
  volume     INTEGER NOT NULL,
  PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS fx_rates (
  pair TEXT NOT NULL, -- 'USDJPY'
  date TEXT NOT NULL,
  rate REAL NOT NULL,
  PRIMARY KEY (pair, date)
);

-- 保有ポジション。半自動運用のため人間がAPI経由で登録する（docs/03 §2.2）
CREATE TABLE IF NOT EXISTS positions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account      TEXT NOT NULL CHECK (account IN ('nisa', 'tokutei', 'paper')),
  symbol       TEXT NOT NULL,
  qty          REAL NOT NULL,
  avg_cost_usd REAL NOT NULL,
  opened_at    TEXT NOT NULL,
  closed_at    TEXT
);

-- 口座ごとの現金残高（手動更新）
CREATE TABLE IF NOT EXISTS account_cash (
  account  TEXT NOT NULL CHECK (account IN ('nisa', 'tokutei', 'paper')),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'JPY')),
  amount   REAL NOT NULL,
  PRIMARY KEY (account, currency)
);

-- 日次の資産評価スナップショット（DD計算の基礎系列）
CREATE TABLE IF NOT EXISTS portfolio_daily (
  date            TEXT PRIMARY KEY,
  total_value_jpy REAL NOT NULL,
  peak_value_jpy  REAL NOT NULL,
  drawdown        REAL NOT NULL -- 0.05 = -5%
);

CREATE TABLE IF NOT EXISTS signals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT NOT NULL, -- シグナル判定に使った基準日（価格データの最終日）
  strategy        TEXT NOT NULL,
  symbol          TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'rebalance', 'hold')),
  detail          TEXT NOT NULL, -- JSON: {targetWeight, currentWeight, notionalUsd, ...}
  acknowledged_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_signals_date ON signals (date);

CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('info', 'warning', 'critical')),
  kind        TEXT NOT NULL, -- dd_warning | dd_limit | divergence | data_gap | signal | watchdog | entry_missing
  message     TEXT NOT NULL,
  dedupe_key  TEXT, -- 同一キーは1日1回しか通知しない
  notified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts (ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedupe ON alerts (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 状況更新レポート（Claudeルーチンの唯一の書き込み先。docs/05 §1）
CREATE TABLE IF NOT EXISTS reports (
  date            TEXT PRIMARY KEY,
  summary         TEXT NOT NULL,
  requires_action INTEGER NOT NULL DEFAULT 0,
  body_md         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- 汎用キーバリュー（前回シグナル月などの実行状態）
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
