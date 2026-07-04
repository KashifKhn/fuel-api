/**
 * Entry point for the Heroku Scheduler job (or any cron).
 * Run this every 3-6 hours: `bun run scripts/scrape-once.ts`
 *
 * We use Scheduler instead of an in-process cron/interval because eco/basic
 * Heroku dynos sleep after 30 min without web traffic — a setInterval inside
 * the web dyno would just stop firing while asleep. Scheduler spins up a
 * one-off dyno, runs this script, and exits, regardless of web dyno state.
 */
import { initSchema, saveScrapeResults, recordScrapeRun } from "../src/db/schema";
import { runAllScrapers } from "../src/scrapers";

async function main() {
  await initSchema();

  console.log(`[scrape] starting run at ${new Date().toISOString()}`);
  const summary = await runAllScrapers();

  console.log(`[scrape] ok: ${summary.ok.join(", ") || "none"}`);
  if (summary.failed.length > 0) {
    for (const f of summary.failed) {
      console.error(`[scrape] FAILED ${f.source}: ${f.error}`);
    }
  }

  await saveScrapeResults(summary.prices);
  await recordScrapeRun(summary.ok, summary.failed.map((f) => f.source));

  console.log(`[scrape] saved ${summary.prices.length} price rows`);

  // Non-zero exit if EVERY source failed, so Heroku Scheduler logs show
  // a clear failure signal (rather than a silently "successful" no-op run).
  if (summary.ok.length === 0) {
    console.error("[scrape] all sources failed this run");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[scrape] fatal error:", err);
  process.exit(1);
});
