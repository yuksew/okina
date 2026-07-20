import { Hono } from "hono";
import { notifyText } from "./alerts.js";
import { buildSnapshot } from "./snapshot.js";
import { runDaily } from "./jobs/daily.js";
import { runWatchdog } from "./jobs/watchdog.js";
import type { Env } from "./env.js";

const app = new Hono<{ Bindings: Env }>();

// --- 認証: /api/* は Bearer トークン必須（docs/05 §3.1） ---
app.use("/api/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  const expected = `Bearer ${c.env.STATUS_API_TOKEN}`;
  if (!c.env.STATUS_API_TOKEN || auth !== expected) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.get("/healthz", (c) => c.json({ ok: true }));

// --- 1. snapshot: 状況更新の全部入り ---
app.get("/api/v1/snapshot", async (c) => {
  return c.json(await buildSnapshot(c.env));
});

// --- 2. signals ---
app.get("/api/v1/signals", async (c) => {
  const since = c.req.query("since") ?? "0000-00-00";
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM signals WHERE date >= ? ORDER BY date DESC, id ASC LIMIT 200`,
  )
    .bind(since)
    .all();
  return c.json({ signals: results });
});

// シグナル確認（発注実施の記録）
app.post("/api/v1/signals/:id/ack", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await c.env.DB.prepare(
    `UPDATE signals SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL`,
  )
    .bind(new Date().toISOString(), id)
    .run();
  return c.json({ updated: r.meta.changes });
});

// --- 3. portfolio history ---
app.get("/api/v1/portfolio/history", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 365), 3650);
  const { results } = await c.env.DB.prepare(
    `SELECT date, total_value_jpy, drawdown FROM portfolio_daily
     ORDER BY date DESC LIMIT ?`,
  )
    .bind(days)
    .all();
  return c.json({ history: results.reverse() });
});

// --- 4. prices（深掘り用） ---
app.get("/api/v1/prices", async (c) => {
  const symbols = (c.req.query("symbols") ?? "").split(",").filter(Boolean).slice(0, 20);
  const days = Math.min(Number(c.req.query("days") ?? 30), 400);
  const out: Record<string, unknown[]> = {};
  for (const sym of symbols) {
    const { results } = await c.env.DB.prepare(
      `SELECT date, open, high, low, close, adj_close, volume FROM prices
       WHERE symbol = ? ORDER BY date DESC LIMIT ?`,
    )
      .bind(sym, days)
      .all();
    out[sym] = results.reverse();
  }
  return c.json({ prices: out });
});

// --- 5. reports 読み取り ---
app.get("/api/v1/reports", async (c) => {
  const date = c.req.query("date");
  if (date) {
    const report = await c.env.DB.prepare(`SELECT * FROM reports WHERE date = ?`)
      .bind(date)
      .first();
    return c.json({ report: report ?? null });
  }
  const { results } = await c.env.DB.prepare(
    `SELECT date, summary, requires_action, created_at FROM reports ORDER BY date DESC LIMIT 30`,
  ).all();
  return c.json({ reports: results });
});

// --- 6. reports 書き込み（Claudeルーチンの唯一の書き込み。upsertで冪等） ---
app.post("/api/v1/reports", async (c) => {
  const body = await c.req.json<{
    date?: string;
    summary?: string;
    requires_action?: boolean;
    body_md?: string;
  }>();
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return c.json({ error: "date (YYYY-MM-DD) is required" }, 400);
  }
  if (!body.summary || !body.body_md) {
    return c.json({ error: "summary and body_md are required" }, 400);
  }
  if (body.summary.length > 200 || body.body_md.length > 100_000) {
    return c.json({ error: "summary or body_md too long" }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO reports (date, summary, requires_action, body_md, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (date) DO UPDATE SET
       summary = excluded.summary,
       requires_action = excluded.requires_action,
       body_md = excluded.body_md,
       created_at = excluded.created_at`,
  )
    .bind(
      body.date,
      body.summary,
      body.requires_action ? 1 : 0,
      body.body_md,
      new Date().toISOString(),
    )
    .run();
  return c.json({ ok: true, date: body.date });
});

// --- 7. 通知（保存済みレポートの要約をDiscordへ。Webhook URLはWorker側secretに隔離） ---
app.post("/api/v1/notify", async (c) => {
  const body = await c.req.json<{ date?: string }>();
  const date = body.date ?? new Date().toISOString().slice(0, 10);
  const report = await c.env.DB.prepare(
    `SELECT date, summary, requires_action FROM reports WHERE date = ?`,
  )
    .bind(date)
    .first<{ date: string; summary: string; requires_action: number }>();
  if (!report) return c.json({ error: `report not found for ${date}` }, 404);

  const mark = report.requires_action ? "🔴 要アクション" : "🟢";
  await notifyText(c.env, `${mark} **状況更新 ${report.date}**\n${report.summary}`);
  return c.json({ ok: true });
});

// --- ポジション・現金の手動管理（半自動運用の約定入力。docs/03 §2.2） ---
app.post("/api/v1/positions", async (c) => {
  const b = await c.req.json<{
    account?: string;
    symbol?: string;
    qty?: number;
    avg_cost_usd?: number;
  }>();
  if (
    !b.account ||
    !["nisa", "tokutei", "paper"].includes(b.account) ||
    !b.symbol ||
    typeof b.qty !== "number" ||
    typeof b.avg_cost_usd !== "number" ||
    b.qty <= 0 ||
    b.avg_cost_usd <= 0
  ) {
    return c.json({ error: "account/symbol/qty/avg_cost_usd are required" }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO positions (account, symbol, qty, avg_cost_usd, opened_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(b.account, b.symbol.toUpperCase(), b.qty, b.avg_cost_usd, new Date().toISOString())
    .run();
  return c.json({ ok: true });
});

app.post("/api/v1/positions/:id/close", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await c.env.DB.prepare(
    `UPDATE positions SET closed_at = ? WHERE id = ? AND closed_at IS NULL`,
  )
    .bind(new Date().toISOString(), id)
    .run();
  return c.json({ updated: r.meta.changes });
});

app.put("/api/v1/cash", async (c) => {
  const b = await c.req.json<{ account?: string; currency?: string; amount?: number }>();
  if (
    !b.account ||
    !["nisa", "tokutei", "paper"].includes(b.account) ||
    !b.currency ||
    !["USD", "JPY"].includes(b.currency) ||
    typeof b.amount !== "number" ||
    b.amount < 0
  ) {
    return c.json({ error: "account/currency/amount are required" }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO account_cash (account, currency, amount) VALUES (?, ?, ?)
     ON CONFLICT (account, currency) DO UPDATE SET amount = excluded.amount`,
  )
    .bind(b.account, b.currency, b.amount)
    .run();
  return c.json({ ok: true });
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // cron式で分岐（wrangler.jsonc の triggers と対応）
    if (controller.cron === "30 23 * * 1-5") {
      ctx.waitUntil(runDaily(env));
    } else if (controller.cron === "0 3 * * 2-6") {
      ctx.waitUntil(runWatchdog(env));
    }
  },
};
