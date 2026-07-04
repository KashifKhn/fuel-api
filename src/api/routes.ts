import { Hono } from "hono";
import { cors } from "hono/cors";
import { getLatestPrices, getLastScrapeRun, getHistory } from "../db/schema";
import { runAllScrapers } from "../scrapers";
import { saveScrapeResults, recordScrapeRun } from "../db/schema";
import type { Source } from "../scrapers/types";

export const api = new Hono();

// Public read API — allow any origin, since this is meant to be used from
// other people's frontends/apps.
api.use("/*", cors());

const VALID_SOURCES: Source[] = ["pso", "shell", "pakwheels"];

function rowsToPrices(rows: any[]) {
  return rows.map((r) => ({
    source: r.source,
    product: r.product,
    price_pkr: r.price_pkr,
    unit: r.unit,
    city: r.city || null,
    effective_date: r.effective_date,
    scraped_at: r.scraped_at,
  }));
}

api.get("/health", async (c) => {
  const lastRun = await getLastScrapeRun();
  return c.json({
    status: "ok",
    last_scrape: lastRun
      ? {
          ran_at: lastRun.ran_at,
          ok_sources: JSON.parse(lastRun.ok_sources as string),
          failed_sources: JSON.parse(lastRun.failed_sources as string),
        }
      : null,
  });
});

api.get("/prices", async (c) => {
  const rows = await getLatestPrices();
  return c.json({ count: rows.length, prices: rowsToPrices(rows) });
});

api.get("/prices/:source", async (c) => {
  const source = c.req.param("source") as Source;
  if (!VALID_SOURCES.includes(source)) {
    return c.json({ error: "invalid_source", valid_sources: VALID_SOURCES }, 400);
  }
  const rows = await getLatestPrices({ source });
  return c.json({ count: rows.length, prices: rowsToPrices(rows) });
});

api.get("/history", async (c) => {
  const product = c.req.query("product");
  const source = c.req.query("source") as Source | undefined;
  const days = Math.min(Number.parseInt(c.req.query("days") ?? "30", 10) || 30, 365);

  if (source && !VALID_SOURCES.includes(source)) {
    return c.json({ error: "invalid_source", valid_sources: VALID_SOURCES }, 400);
  }

  const rows = await getHistory({ product, source, days });
  return c.json({ count: rows.length, days, prices: rowsToPrices(rows) });
});

// Manual refresh, protected by a shared secret. Not rate-limited the same way
// (it's not the public surface) but does need auth so randoms can't force
// extra load onto PSO/Shell/PakWheels on demand.
api.post("/admin/refresh", async (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const summary = await runAllScrapers();
  await saveScrapeResults(summary.prices);
  await recordScrapeRun(summary.ok, summary.failed.map((f) => f.source));

  return c.json({
    ran_at: summary.ranAt,
    ok: summary.ok,
    failed: summary.failed,
    prices_saved: summary.prices.length,
  });
});
