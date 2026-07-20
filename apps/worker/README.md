# @okina/worker（P2で実装）

Cloudflare Workers (Hono) 上の運用基盤。P1（バックテスト検証）合格後に着手する。

- 日次Cron: Tiingo取込 → `@okina/strategy` でシグナル計算 → D1保存 → アラート
- 状況更新API（snapshot等6エンドポイント）: [docs/05-status-update-design.md](../../docs/05-status-update-design.md)
- ダッシュボード（Hono SSR + Cloudflare Access）

`packages/strategy` をそのまま import することで、バックテストと本番のロジック同一性を保証する。
