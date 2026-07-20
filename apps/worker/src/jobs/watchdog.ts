import { raiseAlert } from "../alerts.js";
import type { Env } from "../env.js";

/**
 * 番犬（dead man's switch）: JST正午に本日の状況更新レポートが未着なら通知。
 * Claude Code Routines は実行保証が弱いため、「来ないこと」を決定論側で検知する（docs/05 §2）。
 */
export async function runWatchdog(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const report = await env.DB.prepare(`SELECT date FROM reports WHERE date = ?`)
    .bind(today)
    .first();
  if (!report) {
    await raiseAlert(env, {
      level: "warning",
      kind: "watchdog",
      message: `本日(${today})の状況更新レポートが届いていません。Claude Code Routines の実行状況を確認してください`,
      dedupeKey: `watchdog:${today}`,
    });
  }
}
