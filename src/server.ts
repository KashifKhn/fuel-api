import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { api } from "./api/routes";
import { rateLimiter } from "./api/rateLimiter";
import { initSchema, getLastScrapeRun, getLatestPrices, logApiRequest } from "./db/schema";

const app = new Hono();

// Rate limit: 30 requests burst, refilling at 1/sec (≈60/min sustained).
// Generous enough for normal use/dev poking, tight enough to blunt scraping-of-the-scraper.
app.use("/api/*", rateLimiter({ capacity: 30, refillPerSecond: 1 }));
app.route("/api", api);

// Log page views the same way /api/* logs requests, so admin stats cover both.
app.use("/", async (c, next) => {
  await next();
  logApiRequest(c.req.method, c.req.path, c.res.status).catch(() => {});
});

// Single page: current prices + last-updated + API docs, per the brief.
app.get("/", async (c) => {
  const [rows, lastRun] = await Promise.all([getLatestPrices(), getLastScrapeRun()]);
  let template = await readFile(new URL("./web/index.html", import.meta.url), "utf-8");

  const html = template
    .replace("__PRICES_JSON__", JSON.stringify(rows))
    .replace(
      "__LAST_UPDATED__",
      lastRun
        ? new Date(lastRun.ran_at as string).toLocaleString("en-PK", {
            timeZone: "Asia/Karachi",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          }).replace(/(\d{2}:\d{2})\s*(am|pm)/i, (_, t, ap) => `${t} ${ap.toUpperCase()}`) + " PKT"
        : "not yet run",
    );
  return c.html(html);
});

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

initSchema()
  .then(() => {
    console.log(`fuel-api listening on :${port}`);
  })
  .catch((err) => {
    console.error("failed to init schema:", err);
    process.exit(1);
  });

export default {
  port,
  fetch: app.fetch,
};
