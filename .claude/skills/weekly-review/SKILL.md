---
name: weekly-review
description: 週次レビューレポートを生成・保存・通知する。土曜朝のルーチンから起動される。手動で /weekly-review と打っても同じ動作。
---

# 週次レビュー

status-update スキルと同じ制約に従う: **数値はAPIレスポンスの値のみ、外部データ取得禁止、
書き込みはレポート保存のみ**。

## 手順

0. リポジトリのルートで `pnpm install --frozen-lockfile` を実行する（status-update と同じ理由）。
1. `pnpm status:selfcheck`（終了コード2なら障害記録して終了。1でも続行可 — 週次は
   評価がメインで鮮度要求が緩いため。ただしレポートに鮮度警告を明記）
2. データ収集:
   - `pnpm status:snapshot` … 現在の状態
   - `pnpm exec tsx scripts/status/fetch.ts "/api/v1/portfolio/history?days=90"` … 資産推移
   - `pnpm exec tsx scripts/status/fetch.ts "/api/v1/signals?since=<30日前>"` … 当月シグナル
   - `pnpm exec tsx scripts/status/fetch.ts "/api/v1/reports"` … 当週の日次レポート一覧
3. `docs/reviews/YYYY-Www.md`（ISO週番号）にレポートを書く:
   - frontmatter: date（実行日）/ summary / requires_action
   - **週間パフォーマンス**: 資産推移・週次リターン・現在DD。数値は history の値のみ
   - **ルール遵守状況**: signals のうち acknowledged_at が null のまま残っているもの
     （=発注忘れの疑い）、core_allocation の乖離状況
   - **来月のシグナルプレビュー**: 次回シグナル確定日（翌月初の営業日）を明記。
     シグナルの中身の予想はしない
   - **システム健全性**: 当週の日次レポートが平日分揃っているか（欠けた日を列挙）、
     recent_alerts の週間サマリー
4. `pnpm status:publish docs/reviews/YYYY-Www.md` → `pnpm status:notify`
   （publishのdateには実行日を使う。日次レポートとは date が重ならない土曜日付）
5. 失敗時は status-update と同じ障害記録ルール。

## 禁止事項

status-update スキルの禁止事項をすべて継承する。加えて:
- 戦略パラメータの変更提案はレポートの「気づき」欄に書くに留め、自動で何も変更しない
