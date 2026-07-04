import { db } from "./client";
import type { NormalizedPrice, Source } from "../scrapers/types";

export async function initSchema(): Promise<void> {
  // "prices" holds every scrape as a row — this IS our history table.
  // "latest" is a small derived table we overwrite each run, so reads for the
  // common case (GET /api/prices) never have to scan or aggregate history.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      product TEXT NOT NULL,
      price_pkr REAL NOT NULL,
      unit TEXT NOT NULL,
      city TEXT,
      effective_date TEXT,
      scraped_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_prices_lookup
    ON prices (source, product, city, scraped_at)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS latest (
      source TEXT NOT NULL,
      product TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      price_pkr REAL NOT NULL,
      unit TEXT NOT NULL,
      effective_date TEXT,
      scraped_at TEXT NOT NULL,
      PRIMARY KEY (source, product, city)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS scrape_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ran_at TEXT NOT NULL,
      ok_sources TEXT NOT NULL,
      failed_sources TEXT NOT NULL
    )
  `);
}

export async function saveScrapeResults(prices: NormalizedPrice[]): Promise<void> {
  for (const p of prices) {
    const city = p.city ?? "";

    // History: always insert, never overwrite.
    await db.execute({
      sql: `INSERT INTO prices (source, product, price_pkr, unit, city, effective_date, scraped_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [p.source, p.product, p.price_pkr, p.unit, city, p.effective_date, p.scraped_at],
    });

    // Latest: upsert, since API reads should always hit a tiny known table.
    await db.execute({
      sql: `INSERT INTO latest (source, product, city, price_pkr, unit, effective_date, scraped_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (source, product, city) DO UPDATE SET
              price_pkr = excluded.price_pkr,
              unit = excluded.unit,
              effective_date = excluded.effective_date,
              scraped_at = excluded.scraped_at`,
      args: [p.source, p.product, city, p.price_pkr, p.unit, p.effective_date, p.scraped_at],
    });
  }
}

export async function recordScrapeRun(okSources: Source[], failedSources: Source[]): Promise<void> {
  await db.execute({
    sql: `INSERT INTO scrape_runs (ran_at, ok_sources, failed_sources) VALUES (?, ?, ?)`,
    args: [new Date().toISOString(), JSON.stringify(okSources), JSON.stringify(failedSources)],
  });
}

export async function getLatestPrices(filters?: { source?: Source }) {
  const sql = filters?.source
    ? `SELECT * FROM latest WHERE source = ? ORDER BY product, city`
    : `SELECT * FROM latest ORDER BY source, product, city`;
  const args = filters?.source ? [filters.source] : [];
  const result = await db.execute({ sql, args });
  return result.rows;
}

export async function getLastScrapeRun() {
  const result = await db.execute(`SELECT * FROM scrape_runs ORDER BY id DESC LIMIT 1`);
  return result.rows[0] ?? null;
}

export async function getHistory(params: { product?: string; source?: Source; days: number }) {
  const since = new Date(Date.now() - params.days * 24 * 60 * 60 * 1000).toISOString();
  const conditions = ["scraped_at >= ?"];
  const args: (string | number)[] = [since];

  if (params.product) {
    conditions.push("product = ?");
    args.push(params.product);
  }
  if (params.source) {
    conditions.push("source = ?");
    args.push(params.source);
  }

  const result = await db.execute({
    sql: `SELECT * FROM prices WHERE ${conditions.join(" AND ")} ORDER BY scraped_at ASC`,
    args,
  });
  return result.rows;
}
