import { fetchHtml, htmlToText, parseNumber, ScrapeError } from "./http";
import type { ScraperResult } from "./types";

// The rendered .html page is a client-side-hydrated AEM shell (empty <body> —
// content is fetched by JS at runtime). The same content is available as
// structured JSON from AEM's model endpoint, which is what the page itself
// fetches — so we read that directly instead of trying to run its JS.
const URL = "https://www.shell.com.pk/motorists/shell-fuels/shell-station-price-board.model.json";

/** Recursively collects every string value found under a "text" key in the AEM JSON tree. */
function collectTextFields(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectTextFields(item, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "text" && typeof value === "string") {
        out.push(value);
      } else {
        collectTextFields(value, out);
      }
    }
  }
}

/**
 * Shell's price board is the simplest source: a two-row table (Super, Diesel)
 * plus a plain-text "updated as at <date>, <time> hrs" line. We match on those
 * literal labels rather than table position, since a reordering wouldn't
 * break us but a wording change would (and would be loud/obvious in tests).
 */
export async function scrapeShell(): Promise<ScraperResult> {
  const json = await fetchHtml(URL, "shell");
  const textFields: string[] = [];
  collectTextFields(JSON.parse(json), textFields);
  const text = htmlToText(textFields.join(" "));

  const updatedMatch = text.match(/updated as at\s+([^.]+?)\s*hrs/i);
  const superMatch = text.match(/Super\s+([\d.]+)/i);
  const dieselMatch = text.match(/Diesel\s+([\d.]+)/i);

  const superPrice = parseNumber(superMatch?.[1]);
  const dieselPrice = parseNumber(dieselMatch?.[1]);

  if (superPrice === null && dieselPrice === null) {
    // Both missing almost certainly means the page structure changed, not that
    // prices are genuinely absent. Fail loud so the orchestrator keeps last-good data.
    throw new ScrapeError("shell", "Could not find Super or Diesel price — page structure may have changed");
  }

  const scraped_at = new Date().toISOString();

  return {
    source: "shell",
    source_last_updated: updatedMatch?.[1]?.trim() ?? null,
    prices: [
      ...(superPrice !== null
        ? [
            {
              source: "shell" as const,
              product: "petrol" as const,
              price_pkr: superPrice,
              unit: "litre" as const,
              city: null,
              effective_date: null,
              scraped_at,
            },
          ]
        : []),
      ...(dieselPrice !== null
        ? [
            {
              source: "shell" as const,
              product: "hsd" as const,
              price_pkr: dieselPrice,
              unit: "litre" as const,
              city: null,
              effective_date: null,
              scraped_at,
            },
          ]
        : []),
    ],
  };
}
