/**
 * Shared helpers for all scrapers.
 *
 * Design notes:
 * - We identify ourselves with a descriptive User-Agent (good OSS citizenship —
 *   the source sites can see who's hitting them and why).
 * - We DON'T rely on brittle CSS class names, since marketing sites like these
 *   restyle often. Instead we strip tags down to plain text and pattern-match
 *   on the labels/text that actually carry meaning ("Petrol (Super)", "PKR",
 *   "Rs/Litre", etc). This is more resilient to a CSS/markup refresh, though
 *   it can still break if the *wording* changes — see README for the "scraper
 *   health check" approach to catch that early.
 */

const USER_AGENT =
  "fuel-api-bot/1.0 (+https://fuel.trackmate.page; contact via GitHub issues - polite scraper, low frequency, see README)";

export class ScrapeError extends Error {
  constructor(
    public source: string,
    message: string,
  ) {
    super(`[${source}] ${message}`);
    this.name = "ScrapeError";
  }
}

export async function fetchHtml(url: string, source: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    // Don't hang forever if a source is slow/down — fail fast, keep last good data.
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new ScrapeError(source, `HTTP ${res.status} fetching ${url}`);
  }

  return res.text();
}

/** Strips scripts/styles/tags and collapses whitespace into a plain-text blob we can regex against. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // PSO in particular labels its product rows via <img alt="Euro5 Premier">
    // rather than visible text — pull alt/title text inline BEFORE stripping
    // tags, or that label vanishes along with the rest of the markup.
    .replace(/<img[^>]*\balt=["']([^"']*)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]+\btitle=["']([^"']*)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rs;|&#8377;/g, "Rs")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
