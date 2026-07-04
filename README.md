# fuel-api

An unofficial, open-source public API for fuel prices in Pakistan. There is no
official government/OGRA API for this, so this project scrapes public price
pages from **PSO**, **Shell Pakistan**, and **PakWheels**, normalizes them,
and re-serves them as a small, rate-limited JSON API — plus one page showing
current prices and the docs.

Live: `https://fuel.trackmate.page` · API base: `https://fuel.trackmate.page/api`

## Stack

- **Runtime:** [Bun](https://bun.sh) + TypeScript
- **HTTP framework:** [Hono](https://hono.dev)
- **Database:** [Turso](https://turso.tech) (hosted libSQL / SQLite-compatible)
- **Scraping:** plain `fetch` + regex/text-pattern matching (no headless browser needed — all three sources are server-rendered)

### Why Turso instead of a local SQLite file?

Heroku's filesystem is **ephemeral** — every dyno restart/cycle (at least
every 24h) wipes local files, including a `bun:sqlite` database. Turso keeps
the same SQLite model but persists over the network, so data survives dyno
restarts. For local development, just omit `TURSO_DATABASE_URL` and it falls
back to a local `local.db` file.

## Project structure

```
src/
  scrapers/
    http.ts        # shared fetch + text-extraction helpers
    types.ts        # normalized price schema
    shell.ts        # Shell price board scraper
    pakwheels.ts     # PakWheels petroleum prices table scraper
    pso.ts          # PSO per-city Octane+ grid + national Premier/Diesel/LPG
    index.ts        # orchestrator — runs all 3, tolerates partial failure
  db/
    client.ts       # Turso/libSQL client
    schema.ts       # table creation + queries
  api/
    routes.ts       # /api/prices, /api/prices/:source, /api/history, /api/health, /api/admin/refresh
    rateLimiter.ts  # in-memory token bucket middleware
  web/
    index.html      # the one public page (prices + docs)
  server.ts         # app entrypoint
scripts/
  scrape-once.ts    # entrypoint for Heroku Scheduler (or any cron)
```

## How scraping works

Each source has its own scraper, but they share one philosophy: **match on
the labels/text that carry meaning** ("Petrol (Super)", "PKR", "Rs/Litre",
city names), not on CSS classes or DOM position. Marketing sites like these
restyle often; the actual product/price wording changes far less.

Each scraper throws a `ScrapeError` if it can't find what it expects, rather
than silently returning nothing or garbage. The orchestrator
(`src/scrapers/index.ts`) runs all three with `Promise.allSettled`, so one
source breaking (e.g. PSO redesigns their homepage) never blocks the other
two, and never overwrites their last-good data.

**Recommended monitoring once deployed:** watch `/api/health` — if a source
shows up in `failed_sources` for more than a day or two, its wording/markup
probably changed and the corresponding scraper needs a small update.

## Local development

```bash
bun install
cp .env.example .env   # fill in TURSO_* if you have a Turso db, or leave unset for local.db
bun run dev             # http://localhost:3000
```

Run a scrape manually:
```bash
bun run scrape
```

## Deploying to Heroku

Bun isn't one of Heroku's built-in buildpacks, so add a community Bun
buildpack alongside your app:

```bash
heroku buildpacks:add https://github.com/jakeg/heroku-buildpack-bun
```

Set config vars:
```bash
heroku config:set TURSO_DATABASE_URL=libsql://your-db.turso.io
heroku config:set TURSO_AUTH_TOKEN=your-token
heroku config:set ADMIN_SECRET=$(openssl rand -hex 24)
```

Add the free **Heroku Scheduler** add-on and configure a job to run every
6 hours (Scheduler's coarsest interval is hourly, so pick a multiple):
```
Command: bun run scripts/scrape-once.ts
```
This runs as a one-off dyno independent of the web dyno's sleep state — a
`setInterval` inside the web process would stop firing once an eco dyno goes
to sleep, so we don't rely on one.

Point `fuel.trackmate.page` at the Heroku app (custom domain + DNS CNAME).

## Rate limiting

`/api/*` is rate-limited via an in-memory token bucket per IP: 30-request
burst, refilling at 1 token/sec (~60 requests/minute sustained). This lives
in-process, so it resets on deploy and is per-dyno if you ever scale beyond
one web dyno. Good enough for a single-dyno deployment; if this ever needs to
scale, swap the bucket storage for something shared (e.g. Turso or Redis).

`POST /api/admin/refresh` is separately protected by the `ADMIN_SECRET`
header (`x-admin-secret`) — use it to force an immediate re-scrape right
after a price hike is announced, rather than waiting for the next scheduled run.

## Ethics / etiquette

- Identifies itself with a descriptive `User-Agent` on every request to the
  source sites (see `src/scrapers/http.ts`).
- Scrapes on a multi-hour schedule, not continuously — Pakistani fuel prices
  are set by OGRA on a fixed biweekly cycle, so there's no reason to hit the
  source sites more often than that (plus the manual-refresh escape hatch).
- If you fork this for a different country/source, please check that
  source's `robots.txt` and terms before pointing a scraper at it.

## License

MIT — this is meant to be a public utility. PRs adding more sources or fixing
a broken scraper are welcome.
