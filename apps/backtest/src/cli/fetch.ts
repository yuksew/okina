/**
 * データ取込CLI
 *   pnpm fetch --universe all            # Stooq（無料・キー不要、スモーク用）
 *   TIINGO_TOKEN=xxx pnpm fetch --universe all --source tiingo   # 主ソース
 */
import { openDb, upsertBars } from "../db.js";
import { fetchStooqDaily } from "../fetch/stooq.js";
import { fetchTiingoDaily } from "../fetch/tiingo.js";
import { ETF_MASTER, stooqSymbol, UNIVERSES } from "../universe.js";

function parseArgs(): { symbols: string[]; source: "stooq" | "tiingo" } {
  const args = process.argv.slice(2);
  let symbols: string[] = [];
  let source: "stooq" | "tiingo" = "stooq";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--universe") {
      const name = args[++i];
      if (name === "all") symbols = ETF_MASTER.map((e) => e.symbol);
      else if (name && name in UNIVERSES)
        symbols = [...UNIVERSES[name as keyof typeof UNIVERSES]];
      else throw new Error(`unknown universe: ${name}`);
    } else if (args[i] === "--symbols") {
      symbols = (args[++i] ?? "").split(",").filter(Boolean);
    } else if (args[i] === "--source") {
      const s = args[++i];
      if (s !== "stooq" && s !== "tiingo") throw new Error(`unknown source: ${s}`);
      source = s;
    }
  }
  if (symbols.length === 0) {
    throw new Error("usage: pnpm fetch --universe <all|s1|gtaa5> [--source stooq|tiingo]");
  }
  return { symbols, source };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { symbols, source } = parseArgs();
  const token = process.env["TIINGO_TOKEN"];
  if (source === "tiingo" && !token) {
    throw new Error("TIINGO_TOKEN env var is required for --source tiingo");
  }
  const db = openDb();
  for (const sym of symbols) {
    const bars =
      source === "tiingo"
        ? await fetchTiingoDaily(sym, token!)
        : await fetchStooqDaily(stooqSymbol(sym));
    const n = upsertBars(db, sym, source, bars);
    const first = bars[0]?.date ?? "-";
    const last = bars[bars.length - 1]?.date ?? "-";
    console.log(`${sym}: ${n} bars (${first} .. ${last}) [${source}]`);
    await sleep(1500); // レート制限への礼儀
  }
  db.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
