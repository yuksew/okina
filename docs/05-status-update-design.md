# 状況更新レイヤー詳細設計（Claude Code Web Routines）

- 作成日: 2026-07-10
- ステータス: 提案（ユーザーレビュー待ち）
- 位置づけ: 本システムのキモである「状況更新」を担う、Claude Code Web ルーチン＋スキル＋ツール群の詳細設計。[03-architecture.md](03-architecture.md) §1.1 の「AIレイヤー」を第一級コンポーネントに格上げする。

## 1. 責務の線引き（安全原則、再確認）

| レイヤー | 責務 | やってはいけないこと |
|---|---|---|
| Workers（決定論的コア） | データ取込、シグナル計算、DD/乖離検知、**数値という事実の生成** | — |
| Claude ルーチン（状況更新） | 事実の**読解・文脈化・レポート化・通知**。異常の言語化。ルール逸脱の指摘 | シグナルの生成・改変。APIにない数値の創作。売買推奨。ポジション・設定の変更 |

Claude は「読んで書く」だけ。書き込みは「レポートの保存」のみに限定する。**ルーチンが乗っ取られた/暴走した場合の最悪ケースが「嘘のレポートが届く」で止まる**ことを設計不変条件とする（発注認証情報はシステム全体に存在しない）。

## 2. 全体フロー（平日朝）

```
08:30 JST  Workers Cron: Tiingo取込 → シグナル計算 → D1保存 → 即時系アラート通知
08:45 JST  Claude ルーチン起動（Routines スケジュール）
           1. リポジトリ clone、.claude/skills/status-update が読み込まれる
           2. pnpm status:snapshot  … Worker API から本日のスナップショットJSON取得
           3. データ鮮度検証（古ければ「欠損報告モード」に切替）
           4. レポート生成（テンプレート準拠、数値はJSONの値のみ使用）
           5. pnpm status:publish   … Worker API へレポートPOST（D1保存→ダッシュボード表示）
           6. pnpm status:notify    … Discord へ要約＋ダッシュボードリンクを通知
12:00 JST  Workers Cron（番犬）: 本日のレポートが未POSTなら「状況更新が動いていない」アラート
```

- 番犬（dead man's switch）が重要: Routines は Research Preview であり実行保証が弱い。**「更新が来ない」ことを検知する仕組みを決定論側に置く**。
- 冪等性: レポートは `date` をキーに upsert。同日再実行は上書きし、Discord 通知は Worker 側で `(date, kind)` 重複排除。

## 3. ツール群

### 3.1 Worker API（ルーチンから見た読み取りツール）

すべて読み取り専用＋Bearer トークン認証（`STATUS_API_TOKEN`）。例外は 3.1.6 のみ。

| # | エンドポイント | 返すもの |
|---|---|---|
| 1 | `GET /api/v1/snapshot` | **状況更新に必要な全部入り**: as_of、データ鮮度、ポジション一覧（数量・平均取得・現値・損益・円換算）、ポートフォリオ評価額・DD現在値、未確認シグナル、直近アラート、主要指標（SPY/AGG/VIX代替/USDJPY の直近値と変化率） |
| 2 | `GET /api/v1/signals?since=` | シグナル履歴（strategy, action, detail） |
| 3 | `GET /api/v1/portfolio/history?days=` | 資産推移（equity curve、DD系列） |
| 4 | `GET /api/v1/prices?symbols=&days=` | 個別の日次OHLCV（深掘り用） |
| 5 | `GET /api/v1/reports?date=` | 過去レポート（前日比の文脈参照用） |
| 6 | `POST /api/v1/reports` | **唯一の書き込み**。本日レポート（Markdown＋構造化サマリー）のupsert |

設計方針:
- ルーチンの標準経路は **snapshot 1発で完結**させる（API呼び出し回数と実行時間を最小化）。2〜5は異常時の深掘り用。
- snapshot に `freshness: {prices_as_of, expected_as_of, is_stale}` を必ず含め、鮮度判定をClaudeの裁量にしない（Worker が判定済みフラグを返す）。
- レスポンスはすべて「単位・通貨・時点」を自己記述するJSON（Claudeの単位取り違えを構造で防ぐ）。

### 3.2 リポジトリ内 CLI（スキルが叩く実体）

`scripts/status/` に薄いTS製CLIを置き、スキルからは pnpm 経由でのみ呼ぶ（curl の手組みをさせない）:

```
pnpm status:snapshot            # → snapshot JSON を stdout に出力
pnpm status:publish <file.md>   # → レポートを POST（frontmatter で date/summary を渡す）
pnpm status:notify              # → 保存済み本日レポートの要約を Discord へ（Worker経由）
pnpm status:selfcheck           # → API疎通・トークン・鮮度だけ確認して終了コードで返す
```

- 環境変数（Routines のクラウド環境に設定）: `OKINA_API_URL` / `OKINA_STATUS_TOKEN`。Discord Webhook URL は**ルーチン環境に置かず Worker 側 secret に置く**（notify は Worker 経由。トークン漏洩面を1つに絞る）。
- CLI は入力バリデーションと人間可読なエラー（「トークン無効」「鮮度NG」）を返し、スキル側のリカバリ分岐を単純にする。

## 4. スキル設計

### 4.1 `.claude/skills/status-update/SKILL.md`（日次状況更新）

ドラフト（実装時にこのまま初版として使用）:

```markdown
---
name: status-update
description: 日次の投資状況更新レポートを生成・保存・通知する。平日朝のルーチンから起動される。
---

# 日次状況更新

あなたは個人投資システムの状況更新を担当する。**数値の創作・推測は厳禁**。
使ってよい数値は `pnpm status:snapshot` が返すJSONの値のみ。計算が必要な場合も
JSON内の値の四則演算に限る（新たな市場データを外部から取得しない）。

## 手順
1. `pnpm status:selfcheck` を実行。失敗したら手順5（障害報告）へ。
2. `pnpm status:snapshot` でスナップショットを取得。
3. `freshness.is_stale` が true なら通常レポートを書かず「データ欠損報告」を生成
   （何日分欠けているか・考えられる影響のみ。相場コメントはしない）。
4. テンプレート（下記）に従いレポートを生成し、`docs/reports/YYYY-MM-DD.md` に保存後、
   `pnpm status:publish docs/reports/YYYY-MM-DD.md` → `pnpm status:notify` を実行。
5. いずれかのステップが失敗した場合: 失敗内容を `docs/reports/YYYY-MM-DD-error.md` に
   記録して終了する（リトライは1回まで。無限リトライ禁止）。

## レポートテンプレート
frontmatter: date / summary（80字以内） / requires_action (true|false)
1. **要アクション** — 未確認シグナル・DD警告・乖離があれば冒頭に箇条書き。なければ「なし」
2. **ポジション** — 保有ごとの損益（USD/円換算）、ポートフォリオDD現在値と許容(-20%)までの距離
3. **シグナル** — 発生シグナルの内容と、戦略ルール上の根拠（snapshotのdetailを平易に説明）
4. **相場環境** — snapshotの主要指標の変化を2〜3文で。予想・推奨はしない
5. **システム健全性** — データ鮮度、前回レポートからの欠落有無

## 禁止事項
- 売買の推奨・示唆（「買い時です」等）。シグナルの説明はルールの引用のみで行う
- snapshot にない銘柄・数値・ニュースへの言及
- ポジションや設定を変更するあらゆる操作
```

### 4.2 `.claude/skills/weekly-review/SKILL.md`（週次レビュー、土曜）

- 入力: `portfolio/history` ＋ 当週のレポート群 ＋ シグナル/約定入力の突合。
- 出力: ①週間パフォーマンス（バックテスト想定レンジとの比較）②ルール遵守状況（乖離・入力忘れの集計）③翌週のリバランス予定プレビュー ④システム改善提案（あれば）。
- 同じ禁止事項を継承。`docs/reviews/YYYY-Www.md` に保存。

### 4.3 ルーチン定義（Routines 側の設定）

| 項目 | 値 |
|---|---|
| daily-status | 平日 08:45 JST、プロンプトは「/status-update を実行して」のみ（ロジックは全てスキル側に置き、ルーチンプロンプトは薄く保つ） |
| weekly-review | 土曜 09:00 JST、「/weekly-review を実行して」 |
| Network Access | Custom: 自分の Worker ドメインのみ許可（それ以外の外部アクセス不要にする設計） |
| 環境変数 | `OKINA_API_URL` / `OKINA_STATUS_TOKEN` |
| ブランチ | `claude/` プレフィックスのみ（デフォルトのまま。レポートコミットは claude/reports ブランチ→必要なら自動マージは Worker 側 or 手動） |
| 実行回数 | Pro枠 5回/日 に対し、平日1回＋土曜1回で余裕（手動の臨時実行も可能） |

- ロジックをスキルに置きプロンプトを薄くする理由: バージョン管理される・ローカルでも `/status-update` で同一動作を再現できる・ルーチンのUI設定変更に依存しない。

## 5. 前提条件・リスク

1. **GitHubプライベートリポジトリが必要**（Routines はクラウドでリポジトリを clone する）。現状ローカルのみなので push が前提作業。
2. Routines は Research Preview — 仕様変更・廃止リスクあり。**緩和策**: (a) スキルはローカルCLIでも動く（`claude` をローカルcronで叩く代替経路）、(b) 番犬アラートで停止を即検知、(c) 最悪レポート層が死んでもシグナル・アラート通知（決定論側）は無傷。
3. レポートのコミット先ブランチ運用（`claude/` 制約）は実装時に確認。リポジトリコミットが煩雑なら「D1保存のみ・コミットなし」に単純化してよい（D1が正、gitはあくまで写し）。
4. スナップショットAPIの応答は自己記述的JSONにする（§3.1）。ここの品質が状況更新の品質上限を決める。

## 6. 検証計画（このレイヤー自体のテスト）

- **ゴールデンテスト**: 固定のsnapshot JSON（正常・欠損・DD警告・シグナルありの4ケース）に対しスキルを実行し、生成レポートが「禁止事項を含まない・必須セクションが揃う・数値がJSONと一致する」ことをレビュー。実装後、4ケースをリポジトリに同梱して再実行可能にする。
- ペーパートレード期間（P2）はこのレイヤーの試運転期間を兼ねる。レポートの数値誤りを見つけたらケースとして追加。
