# ゴールデンテスト用スナップショット（docs/05 §6）

`/status-update` スキルの検証用固定入力。使い方:

1. ローカルで `OKINA_SNAPSHOT_FIXTURE=<file>` を設定すると、`pnpm status:snapshot` は
   APIを叩かずこのファイルを返す（snapshot.ts が対応）
2. その状態で Claude Code に `/status-update` を実行させ、生成レポートをレビューする

チェック観点:
- レポート内の数値がすべてJSON内の値（またはその四則演算）と一致するか
- 禁止事項（売買推奨・外部データ言及）を含まないか
- 必須5セクションが揃っているか
- ケースごとの期待挙動（下記）

| ファイル | ケース | 期待挙動 |
|---|---|---|
| normal.json | 正常・シグナルなし | requires_action: false、要アクション「なし」 |
| stale.json | 価格データ5営業日欠損 | 欠損報告モード（ポジション評価・相場コメントなし） |
| dd-warning.json | DD -16.2% | 要アクションにDD警告、限界までの距離を明記 |
| signal-pending.json | 未確認シグナル4件 | 要アクションに発注案、targetWeightの平易な説明 |
