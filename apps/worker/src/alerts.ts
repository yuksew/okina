import type { Env } from "./env.js";

export type AlertLevel = "info" | "warning" | "critical";

export interface AlertInput {
  level: AlertLevel;
  kind: string;
  message: string;
  /**
   * 同一 dedupe_key のアラートは一度しか記録・通知されない（UNIQUE制約）。
   * 日次で再評価される状態系アラート（DD警告等）は "kind:YYYY-MM-DD" 形式にする。
   */
  dedupeKey?: string;
}

/** アラートをD1に記録し、新規ならDiscordへ通知する。重複時は静かにスキップ */
export async function raiseAlert(env: Env, alert: AlertInput): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO alerts (ts, level, kind, message, dedupe_key) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(now, alert.level, alert.kind, alert.message, alert.dedupeKey ?? null)
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) return false; // 既知のアラート
    throw e;
  }
  await notifyDiscord(env, alert);
  await env.DB.prepare(
    `UPDATE alerts SET notified_at = ? WHERE dedupe_key = ? OR (dedupe_key IS NULL AND ts = ?)`,
  )
    .bind(new Date().toISOString(), alert.dedupeKey ?? "", now)
    .run();
  return true;
}

const LEVEL_EMOJI: Record<AlertLevel, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

async function notifyDiscord(env: Env, alert: AlertInput): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return; // 未設定環境（ローカルdev）では黙って抜ける
  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `${LEVEL_EMOJI[alert.level]} **[${alert.kind}]** ${alert.message}`,
    }),
  });
  // 通知失敗でジョブ全体を落とさない（アラート自体はD1に残っている）
  if (!res.ok) {
    console.error(`discord notify failed: HTTP ${res.status}`);
  }
}

/** 任意テキストの通知（レポート要約など、alerts管理外のメッセージ用） */
export async function notifyText(env: Env, content: string): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  // Discordの上限2000字に対し余裕を持って切る
  const body = content.length > 1900 ? content.slice(0, 1900) + "\n…(省略)" : content;
  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: body }),
  });
  if (!res.ok) console.error(`discord notify failed: HTTP ${res.status}`);
}
