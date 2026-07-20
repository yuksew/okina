# フェーズ1: アーキテクチャ案

- 作成日: 2026-07-10
- ステータス: 提案（ユーザーレビュー待ち）
- 前提: [00-phase0-strategy-requirements.md](00-phase0-strategy-requirements.md) / [01-strategy-spec.md](01-strategy-spec.md) / [02-research-findings-2026-07.md](02-research-findings-2026-07.md)

## 1. 設計の基本思想

### 1.1 二層構造: 決定論的コア + AI レイヤー
- **決定論的コア（Workers + Hono）**: データ取込・シグナル計算・乖離検知・即時アラート通知。同じ入力なら必ず同じ出力。お金に直結する判断はすべてここ。LLMは使わない。
- **AIレイヤー（Claude Code Routines）**: 日次の**状況更新レポート**と週次レビューの生成・通知。本システムの主要なユーザー接点であり第一級コンポーネント（詳細設計: [05-status-update-design.md](05-status-update-design.md)）。ただし責務は「決定論的コアが生成した事実の読解・文脈化」に限定し、シグナル生成・数値の創作・資金が動く操作は構造的に不可能にする。Routines が止まってもコアのアラート通知は無傷、かつ「更新が来ない」こと自体をコア側の番犬Cronが検知する。

### 1.2 シグナルロジックの単一実装（最重要の設計判断）
バックテストと本番運用で**同一のTypeScriptモジュール**を使う。

```
packages/strategy/   ← 純粋関数のみ（I/Oなし）。指標計算・シグナル判定
apps/backtest/       ← ローカルNode実行。ヒストリカルデータで packages/strategy を回す
apps/worker/         ← Cloudflare Workers (Hono)。日次データで packages/strategy を回す
```

- 戦略仕様 §5.3 の合格条件「シグナル計算がバックテストロジックと完全一致」を、**構造的に**満たす（二重実装の乖離バグを設計で排除）。
- バックテストをWorkersで動かさない理由: メモリ128MB・CPU制限・開発体験。ローカルNodeなら制約ゼロ。

### 1.3 Cloudflare採用の判断
裏取りの結果、**日次〜週次シグナル計算・通知という要件ならCloudflare Workersの制約にほぼ当たらない**（02-research §3）。Hono/TS志向とも合うため採用。ただし:
- Workers **Paid（$5/月）前提**（無料のCPU 10msでは不成立）
- 将来の自動発注はegress IP固定不可・常駐不可のため**Workersでは実装しない**方針を先に確定（必要になったらVPS/Fly.ioに発注ゲートウェイだけ切り出すハイブリッド）

代案比較: VPS一台（月数百円〜）にcron+SQLiteでも本要件は満たせる。Cloudflareを選ぶ理由は「運用ゼロ（パッチ・監視不要）」「Hono/TSと一体」「無料枠込みで$5/月」。VPS案はフェーズ4（自動発注）で発注ゲートウェイとして再登場する。

## 2. システム構成

```
[Tiingo API]──┐                              ┌─→ [Discord/Pushover 通知]
[Frankfurter]─┼─(1) Cron 平日朝(JST) ingest  │
              ▼                              │
        ┌─ Workers (Hono) ─────────────┐     │
        │ ingest → D1 保存             │     │
        │ (2) シグナル計算 (packages/  │─────┘
        │     strategy を import)      │
        │ (3) 乖離検知・DD監視         │
        │ (4) ダッシュボード (SSR)     │←── ブラウザ (Cloudflare Access で保護)
        └───────────┬──────────────────┘
                    ▼
              [D1] prices / fx_rates / positions / signals / alerts
                    ▲
        [Claude Code Routines] 週次: D1のAPI経由で読み → レビューレポ生成 (任意)
```

### 2.1 スケジューリング
| ジョブ | タイミング | 実装 |
|---|---|---|
| 米国市場データ取込＋シグナル計算＋即時アラート | 平日 08:30 JST（Tiingoの当日分確定 17:30 EST≒07:30 JSTの後） | Cron Trigger。取込→計算→保存を直列実行（ETF約10本なら数秒で完了） |
| ポジション乖離・DD監視 | 同上のジョブ内で実施（別Cron不要） | 同上 |
| **日次状況更新レポート** | 平日 08:45 JST | Claude Code Routines → `/status-update` スキル → Worker API（[05-status-update-design](05-status-update-design.md)） |
| 状況更新の番犬（dead man's switch） | 平日 12:00 JST | Cron Trigger。本日レポート未POSTなら「状況更新が動いていない」アラート |
| 週次レビュー（AI要約） | 土曜 09:00 JST | Claude Code Routines → `/weekly-review` スキル |

- Cronの発火精度にSLAがないが、日次バッチなので数分の遅延は無害。時刻クリティカルな処理は存在しない設計にする。
- リトライ: ingest失敗時はジョブ内で指数バックオフ再試行→なお失敗なら「データ欠損」アラートを通知（黙って古いシグナルを出さない）。

### 2.2 データモデル（D1）
```sql
prices(symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL,
       adj_close REAL, volume INTEGER, PRIMARY KEY (symbol, date));
fx_rates(pair TEXT, date TEXT, rate REAL, PRIMARY KEY (pair, date));
positions(id, symbol, qty, avg_cost_usd, account TEXT /* nisa | tokutei */, opened_at, closed_at);
signals(id, date, strategy TEXT, symbol, action TEXT /* buy|sell|hold|rebalance */,
        detail JSON, acknowledged_at);
alerts(id, ts, level TEXT, kind TEXT /* dd_warning | divergence | data_gap | signal */,
       message, notified_at);
```
- (symbol, date) 複合PKでrows read課金の爆発を防ぐ（02-research §3）。
- **positionsは手入力**（半自動なので約定は人間が行い、ダッシュボードから登録）。ここが崩れると乖離検知が無意味になるため、入力忘れ検知（シグナルacknowledge後にポジション未更新なら翌日アラート）を入れる。

### 2.3 通知
- 候補: Discord Webhook（無料・実装1行）/ Pushover（買い切り$5・ネイティブプッシュ）。**MVPはDiscord Webhookを推奨**（※この2つの現行仕様は未裏取り。実装時に確認）。
- 通知種別: シグナル発生 / DD警告(-15%) / DD限界(-20%) / データ欠損 / ルール乖離 / 入力忘れ。
- 冪等性: alerts テーブルの notified_at で二重通知を防止。

### 2.4 認証・シークレット
- 単一ユーザー。ダッシュボードは **Cloudflare Access**（メールOTP）で保護、アプリ側の認証実装ゼロ。※Zero Trust無料枠の現行条件は実装時に要確認
- APIキー（Tiingo等）は `wrangler secret`。リポジトリ・D1には置かない。
- 発注認証情報はこのシステムには**存在しない**（半自動＝発注は証券会社公式アプリで人間が行う）。攻撃されても最悪「嘘のシグナルが届く」まで。これは半自動方針のセキュリティ上の利点として明記しておく。

### 2.5 コスト（月額）
| 項目 | 費用 |
|---|---|
| Workers Paid | $5 |
| D1 / Queues / Access | 無料枠内 |
| Tiingo / Frankfurter / Discord | 無料 |
| Claude Code Routines | 既存プラン内（Pro: 5回/日で十分） |
| **合計** | **約$5（約750円）/月** |

## 3. あえて採用しないもの（理由つき）
- **Queues / Durable Objects**: ETF約10本・日次1ジョブの規模では過剰。同時接続6本制限にも当たらない。規模が増えたら導入（設計上の拡張点として温存）。
- **リアルタイムデータ・板情報**: 戦略が月次〜週次判断なので不要。WorkersのアウトバウンドWS制約にも抵触するため、要件ごと排除。
- **LLMによるシグナル判断**: 再現性がなくバックテスト不能。AIは読み物レイヤーに隔離。
- **Workersでのバックテスト実行**: §1.2の通りローカルで。

## 4. 将来の自動発注への拡張パス（フェーズ4、任意）
- サテライト（特定口座）のみ自動化対象。**moomoo/Webullの公認APIが移行先候補**（02-research §1）。
- moomoo APIはOpenD常駐ゲートウェイ前提の見込み → **固定IPの小型VPSに発注ゲートウェイを置き、Workersからは署名付きリクエストで指示**するハイブリッド構成。
- 必須安全装置: キルスイッチ（KVフラグ1つで全発注停止）/ 発注上限（1回・1日の金額上限をゲートウェイ側でハード制限）/ 冪等キー / 異常検知（想定外の残高変動で自動停止）。
- ただし着手条件はロードマップ（04）に定義。**今は設計だけ残し、実装しない。**
