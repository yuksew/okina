/**
 * pnpm status:publish <file.md> — レポートをWorkerへupsert。
 * frontmatter必須: date / summary / requires_action
 */
import { readFileSync } from "node:fs";
import { api } from "./api.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: pnpm status:publish <report.md>");
  process.exit(2);
}
const raw = readFileSync(file, "utf-8");

// frontmatter（--- で囲まれた先頭ブロック）を素朴にパース
const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
if (!m) {
  console.error("ERROR: frontmatter（---）がありません。date/summary/requires_action を含めてください");
  process.exit(2);
}
const fm: Record<string, string> = {};
for (const line of m[1]!.split("\n")) {
  const kv = line.match(/^(\w+):\s*(.*)$/);
  if (kv) fm[kv[1]!] = kv[2]!.trim();
}
const date = fm["date"];
const summary = fm["summary"];
if (!date || !summary) {
  console.error("ERROR: frontmatter に date と summary が必要です");
  process.exit(2);
}

const { status, body } = await api("/api/v1/reports", {
  method: "POST",
  body: JSON.stringify({
    date,
    summary,
    requires_action: fm["requires_action"] === "true",
    body_md: m[2] ?? "",
  }),
});
if (status !== 200) {
  console.error(`ERROR: publish失敗 HTTP ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  process.exit(1);
}
console.log(`OK: published report for ${date}`);
