# デプロイ・セットアップ手順（P2運用基盤）

- 作成日: 2026-07-20
- 対象: apps/worker（Cloudflare）と Claude Code Web Routines の初回セットアップ
- ローカル検証は完了済み（API全系統・CLI・認証・冪等性）。以下は本番反映時にユーザーと一緒に行う手順

## 1. Cloudflare（初回のみ）

```bash
cd apps/worker
pnpm exec wrangler login                 # ブラウザ認証
pnpm exec wrangler d1 create okina       # 出力の database_id を wrangler.jsonc に転記
pnpm run db:migrate:remote               # スキーマ適用
pnpm exec wrangler secret put TIINGO_TOKEN
pnpm exec wrangler secret put STATUS_API_TOKEN    # openssl rand -hex 32 で生成
pnpm exec wrangler secret put DISCORD_WEBHOOK_URL # Discordサーバー設定→連携→Webhook
pnpm run deploy
```

- Workers Paid（$5/月）への加入が前提（無料はCPU 10msで不成立。docs/02 §3）。
- デプロイ後の疎通: `curl https://okina.<subdomain>.workers.dev/healthz`
- ヒストリカル投入: 当面は日次Cronの90日upsertで蓄積される。バックテスト用の長期履歴が
  D1に必要になったら投入スクリプトを別途作る（シグナル計算のウォームアップは約600日
  必要なので、**運用開始時に一度 apps/backtest の market.db から流し込むのが実用的**。TODO）。

## 2. ローカル開発

```bash
cd apps/worker
cp .dev.vars.example .dev.vars   # なければ TIINGO_TOKEN/STATUS_API_TOKEN/DISCORD_WEBHOOK_URL を記述
pnpm run db:migrate:local
pnpm run dev                     # http://localhost:8787
```

- status CLI をローカルWorkerに向ける: `OKINA_API_URL=http://localhost:8787 OKINA_STATUS_TOKEN=<...>`

## 3. Claude Code Web Routines（docs/05 §4.3）

| ルーチン | スケジュール | プロンプト |
|---|---|---|
| okina-daily-status | 平日 08:45 JST | `/status-update を実行して` |
| okina-weekly-review | 土曜 09:00 JST | `/weekly-review を実行して` |

- リポジトリ: github.com/yuksew/okina（push済みであること）
- 環境変数: `OKINA_API_URL`（WorkerのURL）/ `OKINA_STATUS_TOKEN`
- Network Access: Custom で Worker ドメインのみ許可
- セットアップスクリプト: `corepack enable && pnpm install --frozen-lockfile`
- 注意: Discord Webhook URL はルーチン環境に**置かない**（Worker経由で通知。docs/05 §3.2）

## 4. スキルのゴールデンテスト（Routines登録前に1度実施）

```bash
OKINA_SNAPSHOT_FIXTURE=scripts/status/fixtures/normal.json claude
# セッション内で /status-update を実行し、生成レポートを fixtures/README.md の観点でレビュー
# stale.json / dd-warning.json / signal-pending.json も同様に
```

## 5. 運用開始チェックリスト（ペーパートレード）

- [ ] Worker デプロイ・Cron 2本が有効（Cloudflareダッシュボードで確認）
- [ ] Discord に日次アラートが届く
- [ ] `POST /api/v1/positions` でペーパー口座（account=paper）の初期ポジション登録
- [ ] `PUT /api/v1/cash` で仮想現金残高を設定（例: paper/JPY 1,000,000）
- [ ] Routines 2本が動き、翌朝レポートが Discord に届く
- [ ] わざと1日 Routines を止め、番犬アラート（JST正午）が届くことを確認
- [ ] 月初にシグナル通知→仮想発注→ポジション更新→ACK の一連を通す

## 6. 未実装（P2残り）

- ダッシュボード（Hono SSR + Cloudflare Access）— 現状はAPI直叩きで代替可能
- ヒストリカル一括投入スクリプト（§1のTODO）
- ペーパートレードの月次検証レポート（シグナルとバックテストの一致確認の自動化）
