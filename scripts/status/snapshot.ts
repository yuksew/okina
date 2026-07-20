/**
 * pnpm status:snapshot — スナップショットJSONをstdoutへ。
 * OKINA_SNAPSHOT_FIXTURE が設定されていればAPIを叩かずそのファイルを返す
 * （スキルのゴールデンテスト用。fixtures/README.md）
 */
import { readFileSync } from "node:fs";
import { api } from "./api.js";

const fixture = process.env["OKINA_SNAPSHOT_FIXTURE"];
if (fixture) {
  console.error(`(fixture mode: ${fixture})`);
  console.log(readFileSync(fixture, "utf-8"));
  process.exit(0);
}

const { status, body } = await api("/api/v1/snapshot");
if (status !== 200) {
  console.error(`ERROR: snapshot取得失敗 HTTP ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));
