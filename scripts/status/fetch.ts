/**
 * pnpm exec tsx scripts/status/fetch.ts <path> — 任意のGET APIを叩いてJSONをstdoutへ。
 * weekly-review スキルの深掘り用（読み取り専用。POST/PUTはこのCLIからは不可）。
 */
import { api } from "./api.js";

const path = process.argv[2];
if (!path || !path.startsWith("/api/v1/")) {
  console.error('usage: tsx scripts/status/fetch.ts "/api/v1/..."');
  process.exit(2);
}
const { status, body } = await api(path);
if (status !== 200) {
  console.error(`ERROR: HTTP ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));
