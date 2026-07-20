import {
  isMonthEndFactory,
  isWeekEndFactory,
  isYearEndFactory,
  type DailyBar,
  type SeriesMap,
  type Strategy,
} from "@okina/strategy";

export interface CostModel {
  /** 売買手数料率（往復でなく片道・約定金額比） */
  commissionRate: number;
  /** スリッページ＋スプレッド想定（片道・約定金額比） */
  slippageRate: number;
}

/** 国内証券で米国ETFを買う想定のデフォルト（保守的に厚め）。感応度は別途検証 */
export const DEFAULT_COSTS: CostModel = {
  commissionRate: 0.00495, // 約定代金の0.495%（国内ネット証券の米株標準。上限考慮なしの保守値）
  slippageRate: 0.001, // 0.1%
};

/** 実勢コスト（2026-07 web裏取り済み。docs/09-cost-research-2026-07.md §3） */
export const NISA_COSTS: CostModel = { commissionRate: 0, slippageRate: 0.0005 };
export const MAJOR3_COSTS: CostModel = { commissionRate: 0.00495, slippageRate: 0.0002 };
export const MOOMOO_COSTS: CostModel = { commissionRate: 0.00132, slippageRate: 0.0002 };
/** ウィブル現行0.22%（2026年7月下旬に無料化の報道あり→その場合はNISA_COSTS相当まで低下） */
export const WEBULL_COSTS: CostModel = { commissionRate: 0.0022, slippageRate: 0.0002 };

export interface Trade {
  date: string;
  symbol: string;
  /** 売買金額（+買い / -売り、コスト除く） */
  notional: number;
  cost: number;
}

export interface EquityPoint {
  date: string;
  value: number;
}

export interface BacktestResult {
  strategyId: string;
  from: string;
  to: string;
  initialCapital: number;
  equity: EquityPoint[];
  trades: Trade[];
  totalCosts: number;
  /** 源泉徴収された譲渡益税の累計（taxRate=0なら0） */
  totalTax: number;
  /** 年間売買回転率 = 年間売買金額合計 / 平均資産 */
  annualTurnover: number;
  /** リバランス実施日数（発注アクション頻度の評価用） */
  rebalanceCount: number;
}

export interface BacktestOptions {
  series: SeriesMap;
  strategy: Strategy;
  initialCapital?: number;
  costs?: CostModel;
  /**
   * 譲渡益税率（特定口座・源泉徴収あり想定。日本の現行 20.315%）。
   * 移動平均法で取得単価を管理し、売却の都度「年初来実現損益×税率」との差分を源泉徴収/還付する
   * （年内の損益通算を再現）。損失の翌年繰越（3年）は未実装＝保守側の近似。
   * 0（デフォルト）で非課税（NISA想定/グロス比較用）。
   */
  taxRate?: number;
  from?: string;
  to?: string;
}

/**
 * 日次バックテストエンジン。
 * 前提（v1の割り切り、docs/07で明記すること）:
 * - シグナル判定と執行は同一日の終値（月次系の文献標準に合わせる）
 * - 端株なし（金額ベースの比例配分）
 * - 通貨はUSD建て。円換算・為替コスト・税は未実装（TODO: P1中に追加）
 * - 全シンボルに揃って存在する日付のみ使用（上場前・欠損日は自然に除外）
 */
export function runBacktest(opts: BacktestOptions): BacktestResult {
  const { series, strategy } = opts;
  const initialCapital = opts.initialCapital ?? 1_000_000;
  const costs = opts.costs ?? DEFAULT_COSTS;
  const costRate = costs.commissionRate + costs.slippageRate;
  const taxRate = opts.taxRate ?? 0;

  for (const sym of strategy.symbols) {
    if (!series[sym] || series[sym].length === 0) {
      throw new Error(`series missing for symbol: ${sym}`);
    }
  }

  // 全シンボル共通の営業日（積集合）を作る
  const barMaps = new Map<string, Map<string, DailyBar>>();
  for (const sym of strategy.symbols) {
    barMaps.set(sym, new Map(series[sym]!.map((b) => [b.date, b])));
  }
  const firstSym = strategy.symbols[0]!;
  let dates = series[firstSym]!.map((b) => b.date).filter((d) =>
    strategy.symbols.every((s) => barMaps.get(s)!.has(d)),
  );
  if (opts.from) dates = dates.filter((d) => d >= opts.from!);
  if (opts.to) dates = dates.filter((d) => d <= opts.to!);
  if (dates.length <= strategy.warmupDays) {
    throw new Error(
      `not enough data: ${dates.length} common days <= warmup ${strategy.warmupDays}`,
    );
  }

  const isRebalanceDay =
    strategy.rebalance === "monthly"
      ? isMonthEndFactory(dates)
      : strategy.rebalance === "weekly"
        ? isWeekEndFactory(dates)
        : isYearEndFactory(dates);

  // 戦略に渡す履歴（共通日付ベースで当日まで。未来は物理的に見えない）
  const history: SeriesMap = {};
  for (const sym of strategy.symbols) history[sym] = [];

  const positions = new Map<string, number>(); // symbol -> shares
  const costBasis = new Map<string, number>(); // symbol -> 取得費合計（移動平均法）
  let cash = initialCapital;
  let started = false;
  const equity: EquityPoint[] = [];
  const trades: Trade[] = [];
  let totalCosts = 0;
  let totalTax = 0;
  let tradedNotional = 0;
  let rebalanceCount = 0;
  let taxYear = "";
  let ytdRealized = 0;
  let ytdTaxPaid = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]!;
    const priceOf = (sym: string): number => barMaps.get(sym)!.get(date)!.adjClose;
    for (const sym of strategy.symbols) {
      history[sym]!.push(barMaps.get(sym)!.get(date)!);
    }
    if (i < strategy.warmupDays) continue;
    started = true;

    let value = cash;
    for (const [sym, shares] of positions) value += shares * priceOf(sym);

    // 運用開始日は初回リバランス（投資開始）を必ず行う
    const shouldRebalance = i === strategy.warmupDays || isRebalanceDay(i);
    if (shouldRebalance) {
      const weights = strategy.targetWeights(date, history);
      let acted = false;
      let dayRealized = 0;
      for (const sym of strategy.symbols) {
        const price = priceOf(sym);
        const sharesBefore = positions.get(sym) ?? 0;
        const target = value * (weights[sym] ?? 0);
        const current = sharesBefore * price;
        const delta = target - current;
        if (Math.abs(delta) < value * 1e-6) continue; // 実質ゼロの注文は出さない
        const cost = Math.abs(delta) * costRate;
        positions.set(sym, sharesBefore + delta / price);
        cash -= delta + cost;
        totalCosts += cost;
        tradedNotional += Math.abs(delta);
        if (delta > 0) {
          // 買い: 取得費に加算（手数料込み）
          costBasis.set(sym, (costBasis.get(sym) ?? 0) + delta + cost);
        } else if (sharesBefore > 0) {
          // 売り: 移動平均法で取得費を按分し実現損益を計上
          const soldFraction = Math.min(1, -delta / price / sharesBefore);
          const basisBefore = costBasis.get(sym) ?? 0;
          const basisSold = basisBefore * soldFraction;
          costBasis.set(sym, basisBefore - basisSold);
          dayRealized += -delta - cost - basisSold;
        }
        trades.push({ date, symbol: sym, notional: delta, cost });
        acted = true;
      }
      if (acted) rebalanceCount++;
      if (taxRate > 0 && dayRealized !== 0) {
        const year = date.slice(0, 4);
        if (year !== taxYear) {
          taxYear = year;
          ytdRealized = 0;
          ytdTaxPaid = 0;
        }
        // 源泉徴収あり口座の再現: 売却の都度「年初来の実現益×税率」に合わせて徴収/還付
        ytdRealized += dayRealized;
        const shouldHavePaid = taxRate * Math.max(0, ytdRealized);
        const adjustment = shouldHavePaid - ytdTaxPaid;
        cash -= adjustment;
        ytdTaxPaid = shouldHavePaid;
        totalTax += adjustment;
      }
      value = cash;
      for (const [sym, shares] of positions) value += shares * priceOf(sym);
    }
    equity.push({ date, value });
  }

  if (!started || equity.length === 0) {
    throw new Error("backtest produced no equity points");
  }
  const from = equity[0]!.date;
  const to = equity[equity.length - 1]!.date;
  const years =
    (Date.parse(to) - Date.parse(from)) / (365.25 * 24 * 3600 * 1000);
  const avgEquity =
    equity.reduce((s, p) => s + p.value, 0) / equity.length;
  const annualTurnover =
    years > 0 && avgEquity > 0 ? tradedNotional / avgEquity / years : 0;

  return {
    strategyId: strategy.id,
    from,
    to,
    initialCapital,
    equity,
    trades,
    totalCosts,
    totalTax,
    annualTurnover,
    rebalanceCount,
  };
}
