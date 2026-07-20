/** 日次バー。adjClose は配当・分割調整済み（リターン計算は必ず adjClose を使う） */
export interface DailyBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

/** symbol -> 日付昇順のバー列 */
export type SeriesMap = Record<string, DailyBar[]>;

/**
 * 目標ウェイト。合計は 1 以下で、残りは現金。
 * 例: { SPY: 0.7, AGG: 0.3 } / トレンドフィルタで退避中なら { SPY: 0 } など
 */
export type TargetWeights = Record<string, number>;

export type RebalanceFrequency = "monthly" | "weekly" | "yearly";

/**
 * 戦略は「その時点までの履歴 → 目標ウェイト」の純粋関数。
 * I/O・現在時刻・乱数への依存を持たないこと（バックテストと本番の同一性の根拠）。
 */
export interface Strategy {
  id: string;
  description: string;
  symbols: string[];
  rebalance: RebalanceFrequency;
  /** シグナル計算に必要な最低履歴日数（営業日）。エンジンはこの分をスキップする */
  warmupDays: number;
  /** history は各 symbol について「当日を含む過去のみ」が渡される（未来は見えない） */
  targetWeights(date: string, history: SeriesMap): TargetWeights;
}
