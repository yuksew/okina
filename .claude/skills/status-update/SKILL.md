---
name: status-update
description: 日次の投資状況更新レポートを生成・保存・通知する。平日朝のルーチンから起動される。手動で /status-update と打っても同じ動作。
---

# 日次状況更新

あなたは個人投資システムの状況更新を担当する。**数値の創作・推測は厳禁**。
使ってよい数値は `pnpm status:snapshot` が返すJSONの値のみ。計算が必要な場合も
JSON内の値の四則演算に限る（外部から新たな市場データ・ニュースを取得しない。
WebSearch/WebFetchはこのタスクでは使用禁止）。

## 手順

0. リポジトリのルートで `pnpm install --frozen-lockfile` を実行する（クラウド実行環境の
   セットアップスクリプトはリポジトリ外で走るため、依存はここで入れる。導入済みなら数秒で終わる）。
1. `pnpm status:selfcheck` を実行する。
   - 終了コード 2（疎通・認証NG）: レポート不能。手順5（障害記録）へ
   - 終了コード 1（鮮度NG）: 手順3の「データ欠損報告モード」でレポートする
   - 終了コード 0: 通常モード
2. `pnpm status:snapshot` でスナップショットJSONを取得する。
3. レポートを `docs/reports/YYYY-MM-DD.md` に書く（dateはsnapshotの `as_of` の日付部分）。
   - 通常モード: 下記テンプレートに従う
   - データ欠損報告モード: 何日分のデータが欠けているか（`freshness` の値）と
     監視への影響のみを書く。相場コメント・ポジション評価はしない
4. 保存・通知:
   - `pnpm status:publish docs/reports/YYYY-MM-DD.md`
   - `pnpm status:notify`
   - 各コマンドの失敗は1回だけリトライ。それでも失敗したら手順5へ
5. 障害記録: 失敗したステップとエラーメッセージを `docs/reports/YYYY-MM-DD-error.md`
   に書いて終了する。無限リトライ・別手段での回避（直接curl等）は禁止。

## レポートテンプレート

frontmatter（publish が要求する）:

```
---
date: YYYY-MM-DD
summary: <80字以内。要アクション項目があればそれを最優先で>
requires_action: true|false
---
```

本文セクション（順序固定）:

1. **要アクション** — `pending_signals`（未確認シグナル）、`portfolio.drawdown_pct` が
   警告ライン以上、`core_allocation.items[].exceeds_limit` が true、のいずれかがあれば
   箇条書き。なければ「なし」
2. **ポジション** — `positions` の各行（銘柄・口座・数量・評価額USD/JPY・含み損益%）と、
   `portfolio` の全体評価額・現在DD・限界(-20%)までの距離
3. **シグナル** — `pending_signals` の中身。detail の targetWeight を「目標配分◯%」と
   平易に書き、対応する発注アクション（何をどれだけ買う/売る）を明記
4. **相場環境** — `market` の各指標（SPY/QQQ/AGG/GLD）の前日比を2〜3文で事実のみ。
   予想・解釈・推奨はしない
5. **システム健全性** — `freshness` の内容、`recent_alerts` の直近の警告

## 禁止事項

- 売買の推奨・示唆（「買い時です」「上昇しそう」等）。シグナルの説明はルールの引用のみ
- snapshot にない銘柄・数値・ニュース・イベントへの言及
- ポジション・現金・シグナルACKなど、レポート保存以外のあらゆる書き込みAPI呼び出し
- リポジトリの docs/reports/ 以外のファイル変更
- **gitのコミット・push**（レポートの正はD1。ブランチを増やさない。エラー記録ファイルも同様）
