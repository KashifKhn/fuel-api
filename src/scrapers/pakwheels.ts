import { fetchHtml, htmlToText, parseNumber, ScrapeError } from "./http";
import type { NormalizedPrice, Product, ScraperResult } from "./types";

const URL = "https://www.pakwheels.com/petroleum-prices-in-pakistan";

// Maps the source's row labels -> our normalized product enum.
// Kept as an explicit table (not guessed at runtime) so an unrecognized label
// shows up as a silent gap we can spot in review, rather than a wrong mapping.
const PRODUCT_MAP: Record<string, Product> = {
  "petrol (super)": "petrol",
  "high speed diesel": "hsd",
  "light speed diesel": "lsd",
  lpg: "lpg",
  "kerosene oil": "kerosene",
};

/**
 * PakWheels renders a plain "Fuel Type | Old Price | New Price | Difference"
 * table. We match row-by-row on label text ("Petrol (Super)", "PKR 123.45",
 * "PKR 123.45") rather than table index, and pick up the "Prices w.e.f DATE"
 * line for the effective date. CNG rows are intentionally skipped — CNG is
 * region-based and PakWheels currently reports PKR 0.0 for both regions.
 */
export async function scrapePakWheels(): Promise<ScraperResult> {
  const html = await fetchHtml(URL, "pakwheels");
  const text = htmlToText(html);

  const effectiveMatch = text.match(/Prices w\.e\.f\s+([\d]{1,2}-[A-Za-z]+-\d{4})/i);

  const rowPattern =
    /(Petrol \(Super\)|High Speed Diesel|Light Speed Diesel|LPG|Kerosene Oil)\s+PKR\s*([\d.]+)\s+PKR\s*([\d.]+)/gi;

  const prices: NormalizedPrice[] = [];
  const scraped_at = new Date().toISOString();
  let match: RegExpExecArray | null;

  while ((match = rowPattern.exec(text)) !== null) {
    const label = match[1].toLowerCase();
    const newPrice = parseNumber(match[3]); // 2nd captured price = "New Price" column
    const product = PRODUCT_MAP[label];

    if (product && newPrice !== null && newPrice > 0) {
      prices.push({
        source: "pakwheels",
        product,
        price_pkr: newPrice,
        unit: "litre",
        city: null,
        effective_date: effectiveMatch?.[1] ?? null,
        scraped_at,
      });
    }
  }

  if (prices.length === 0) {
    throw new ScrapeError("pakwheels", "No price rows matched — page structure or wording may have changed");
  }

  return {
    source: "pakwheels",
    source_last_updated: effectiveMatch?.[1] ?? null,
    prices,
  };
}
