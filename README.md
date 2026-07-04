# fuel-api

**A free, unofficial public API for fuel prices in Pakistan.**

There's no official government/OGRA API for this, so this project scrapes public
price pages from **PSO**, **Shell Pakistan**, and **PakWheels**, normalizes the
results, and re-serves them as a small, rate-limited JSON API — plus one page
showing current prices and live docs.

[![License: MIT](https://img.shields.io/github/license/KashifKhn/fuel-api)](LICENSE)
[![Issues](https://img.shields.io/github/issues/KashifKhn/fuel-api)](https://github.com/KashifKhn/fuel-api/issues)
[![Last commit](https://img.shields.io/github/last-commit/KashifKhn/fuel-api)](https://github.com/KashifKhn/fuel-api/commits/main)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

**Live:** [fuel.trackmate.page](https://fuel.trackmate.page) · **API base:** `https://fuel.trackmate.page/api`

---

## Contents

- [Why this exists](#why-this-exists)
- [Quickstart](#quickstart)
- [API reference](#api-reference)
- [Rate limiting](#rate-limiting)
- [Project structure](#project-structure)
- [How scraping works](#how-scraping-works)
- [Local development](#local-development)
- [Deploying to Heroku](#deploying-to-heroku)
- [Ethics / etiquette](#ethics--etiquette)
- [Contributing](#contributing)
- [License](#license)

## Why this exists

Fuel prices in Pakistan are set by OGRA on a biweekly cycle and published as
plain web pages by PSO, Shell, and PakWheels — but there's no structured,
public API for them. This project fills that gap: three small scrapers feed
one normalized schema, so any app, script, or bot can pull current or
historical prices with a single `curl`.

## Quickstart

No install, no key — just call it:

```bash
curl https://fuel.trackmate.page/api/prices
```

```json
{
  "count": 2,
  "prices": [
    { "source": "pso", "product": "petrol", "price_pkr": 299.5, "unit": "litre", "city": null, "effective_date": null, "scraped_at": "2026-07-04T16:21:28.663Z" },
    { "source": "shell", "product": "hsd", "price_pkr": 309.5, "unit": "litre", "city": null, "effective_date": null, "scraped_at": "2026-07-04T16:21:28.663Z" }
  ]
}
```

## API reference

Base URL: `https://fuel.trackmate.page/api`. Public, no API key needed.
The live docs page (`/`) has the same reference with copy-pasteable examples
and a **"Copy docs for AI"** button if you want to hand this whole reference
to an LLM/agent.

### `GET /api/prices`

Latest known price for every source/product/city combination.

```bash
curl https://fuel.trackmate.page/api/prices
```

| Status | Meaning |
| --- | --- |
| `200` | OK |
| `429` | `rate_limited` — see [Rate limiting](#rate-limiting) |

### `GET /api/prices/:source`

Latest prices from one source only. `:source` is one of `pso`, `shell`, `pakwheels`.

```bash
curl https://fuel.trackmate.page/api/prices/pso
```

```json
{
  "count": 2,
  "prices": [
    { "source": "pso", "product": "petrol", "price_pkr": 299.5, "unit": "litre", "city": null, "effective_date": null, "scraped_at": "2026-07-04T16:21:28.663Z" },
    { "source": "pso", "product": "octane_plus", "price_pkr": 340, "unit": "litre", "city": "Karachi", "effective_date": null, "scraped_at": "2026-07-04T16:21:28.663Z" }
  ]
}
```

| Status | Meaning |
| --- | --- |
| `200` | OK |
| `400` | `invalid_source` — `:source` isn't one of `pso`, `shell`, `pakwheels` |
| `429` | `rate_limited` |

### `GET /api/history?product=petrol&days=30`

Historical snapshots. `product` and `source` are optional filters; `days`
defaults to 30, max 365.

```bash
curl "https://fuel.trackmate.page/api/history?product=hsd&days=90"
```

```json
{
  "count": 2,
  "days": 1,
  "prices": [
    { "source": "pso", "product": "petrol", "price_pkr": 299.5, "unit": "litre", "city": null, "effective_date": null, "scraped_at": "2026-07-04T16:18:48.887Z" },
    { "source": "pakwheels", "product": "petrol", "price_pkr": 297.53, "unit": "litre", "city": null, "effective_date": "04-July-2026", "scraped_at": "2026-07-04T16:18:49.736Z" }
  ]
}
```

| Status | Meaning |
| --- | --- |
| `200` | OK |
| `400` | `invalid_source` |
| `429` | `rate_limited` |

### `GET /api/health`

Scraper status — when it last ran and which sources succeeded/failed. Useful
for monitoring: if a source sits in `failed_sources` for more than a day or
two, its page probably changed shape and the scraper needs a fix.

```bash
curl https://fuel.trackmate.page/api/health
```

```json
{
  "status": "ok",
  "last_scrape": {
    "ran_at": "2026-07-04T16:21:37.862Z",
    "ok_sources": ["shell", "pakwheels", "pso"],
    "failed_sources": []
  }
}
```

| Status | Meaning |
| --- | --- |
| `200` | OK |
| `429` | `rate_limited` |

## Rate limiting

`/api/*` is rate-limited via an in-memory token bucket per IP: 30-request
burst, refilling at 1 token/sec (~60 requests/minute sustained). A `429`
response includes a `Retry-After` header (seconds) plus `X-RateLimit-Limit`
and `X-RateLimit-Remaining`. Please cache responses client-side — prices only
change a few times a month.

This lives in-process, so it resets on deploy and is per-dyno if this ever
scales beyond one web dyno; fine for a single-dyno deployment.

`POST /api/admin/refresh` is a separate, non-public endpoint protected by an
`x-admin-secret` header — used to force an immediate re-scrape right after a
price hike is announced, instead of waiting for the next scheduled run.

## Project structure

```
src/
  scrapers/
    http.ts         # shared fetch + text-extraction helpers
    types.ts        # normalized price schema
    shell.ts        # Shell price board scraper (reads their AEM model.json)
    pakwheels.ts    # PakWheels petroleum prices table scraper
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

**Stack:** [Bun](https://bun.sh) + TypeScript, [Hono](https://hono.dev),
[Turso](https://turso.tech) (hosted libSQL/SQLite). Scraping is plain
`fetch` + regex/text-pattern matching — no headless browser, since all
sources are either server-rendered or expose a JSON data endpoint.

## How scraping works

Each source has its own scraper, but they share one philosophy: **match on
the labels/text that carry meaning** ("Petrol (Super)", "PKR", "Rs/Litre",
city names), not on CSS classes or DOM position. Marketing sites like these
restyle often; the actual product/price wording changes far less.

Each scraper throws a `ScrapeError` if it can't find what it expects, rather
than silently returning nothing or garbage. The orchestrator
(`src/scrapers/index.ts`) runs all three with `Promise.allSettled`, so one
source breaking (e.g. a redesign) never blocks the other two, and never
overwrites their last-good data.

Shell in particular renders its price board client-side (an AEM SPA) — the
scraper reads the same `.model.json` data endpoint the page itself fetches,
rather than trying to run its JS.

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

### Why Turso instead of a local SQLite file?

Heroku's filesystem is **ephemeral** — every dyno restart/cycle (at least
every 24h) wipes local files, including a `bun:sqlite` database. Turso keeps
the same SQLite model but persists over the network, so data survives dyno
restarts. For local development, just omit `TURSO_DATABASE_URL` and it falls
back to a local `local.db` file.

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

Point your domain at the Heroku app (custom domain + DNS CNAME).

## Ethics / etiquette

- Identifies itself with a descriptive `User-Agent` on every request to the
  source sites (see `src/scrapers/http.ts`).
- Scrapes on a multi-hour schedule, not continuously — Pakistani fuel prices
  are set by OGRA on a fixed biweekly cycle, so there's no reason to hit the
  source sites more often than that (plus the manual-refresh escape hatch).
- If you fork this for a different country/source, please check that
  source's `robots.txt` and terms before pointing a scraper at it.

## Contributing

Issues and PRs are welcome — especially:

- A source scraper breaking (check `/api/health` first — it'll usually show
  which one and since when).
- Adding a new source (another retailer, another country).
- Bug fixes, docs improvements, tests.

Before opening a PR: run `bun run scrape` locally against the target source
and make sure it still parses; these are text-pattern scrapers, so a page
wording change is the most common way they break.

## License

MIT — this is meant to be a public utility. PRs adding more sources or
fixing a broken scraper are welcome.
