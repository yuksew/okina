/**
 * pnpm status:selfcheck — API疎通・トークン・データ鮮度を確認し終了コードで返す。
 * 0=正常 / 1=鮮度NG（欠損報告モードで続行せよ） / 2=疎通・認証NG（レポート不能）
 */
import { api } from "./api.js";

const { status, body } = await api("/api/v1/snapshot");
if (status !== 200) {
  console.error(`NG: API疎通失敗 HTTP ${status}`);
  process.exit(2);
}
const snapshot = body as { freshness?: { is_stale?: boolean; prices_as_of?: string } };
if (snapshot.freshness?.is_stale) {
  console.error(
    `STALE: 価格データが古い（最終 ${snapshot.freshness.prices_as_of}）。欠損報告モードでレポートすること`,
  );
  process.exit(1);
}
console.log(`OK: API疎通・鮮度とも正常（価格最終日 ${snapshot.freshness?.prices_as_of}）`);
