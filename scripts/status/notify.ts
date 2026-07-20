/**
 * pnpm status:notify [YYYY-MM-DD] — 保存済みレポートの要約をDiscordへ（Worker経由）。
 * Webhook URLはWorker側secretにあり、この環境には存在しない（docs/05 §3.2）。
 */
import { api } from "./api.js";

const date = process.argv[2]; // 省略時はWorker側で当日扱い
const { status, body } = await api("/api/v1/notify", {
  method: "POST",
  body: JSON.stringify(date ? { date } : {}),
});
if (status !== 200) {
  console.error(`ERROR: notify失敗 HTTP ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  process.exit(1);
}
console.log("OK: notified");
