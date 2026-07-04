import { fetchHtml, htmlToText, parseNumber, ScrapeError } from "./http";
import type { NormalizedPrice, ScraperResult } from "./types";

const URL = "https://psopk.com/";

// PSO's homepage "Fuel Prices" widget lists Octane+ per city (a JS tab/carousel
// that's actually server-rendered — all cities are present in the initial HTML).
// This whitelist both drives extraction AND acts as a canary: if PSO adds/renames
// a city, we simply won't emit it rather than mis-mapping data.
const CITIES = [
  "Karachi",
  "Lahore",
  "Rawalpindi",
  "Faisalabad",
  "Jhelum",
  "Peshawar",
  "Bahawalpur",
  "Sukkur",
  "Multan",
  "Gujranwala",
  "Hyderabad",
  "Sahiwal",
  "D.I Khan",
  "Gilgit",
  "Gawadar",
  "Abbottabad",
  "Quetta",
];

/**
 * PSO's page structure (after stripping to plain text) reads roughly:
 *   ... CITY <selected city> <city1> <city2> ... RS./LITRE <price1> <price2> ...
 *   [Premier image] <premier price> [Hi-Cetane image] <diesel price>
 *   LPG (Liquid Petroleum Gas) <lpg price>
 *
 * Octane+ is per-city; Premier, Hi-Cetane Diesel, and LPG are single national
 * values. We anchor on the literal "CITY" / "RS./LITRE" / "LPG" markers rather
 * than trying to fully parse the DOM, since PSO's markup is a JS
 * carousel/tabs component that's easy to restyle but unlikely to drop these labels.
 */
export async function scrapePso(): Promise<ScraperResult> {
  const html = await fetchHtml(URL, "pso");
  const text = htmlToText(html);

  const cityBlockStart = text.indexOf("CITY");
  const priceBlockStart = text.indexOf("RS./LITRE");
  if (cityBlockStart === -1 || priceBlockStart === -1 || priceBlockStart < cityBlockStart) {
    throw new ScrapeError("pso", "Could not locate CITY / RS./LITRE markers — page structure may have changed");
  }

  const cityBlock = text.slice(cityBlockStart, priceBlockStart);
  // Stop the price block at the LPG marker, which comes after the per-city Octane+ list.
  const lpgMarkerIdx = text.indexOf("LPG", priceBlockStart);
  const priceBlock = text.slice(priceBlockStart, lpgMarkerIdx === -1 ? undefined : lpgMarkerIdx);

  // Order-preserving: keep only cities from our whitelist that actually appear, in the
  // order they appear, so index i lines up with the i-th "Rs.X/Ltr" match.
  const citiesFound = CITIES.filter((c) => cityBlock.includes(c)).sort(
    (a, b) => cityBlock.indexOf(a) - cityBlock.indexOf(b),
  );

  const octanePrices = [...priceBlock.matchAll(/Rs\.?([\d.]+)\/Ltr/gi)].map((m) => parseNumber(m[1]));

  const scraped_at = new Date().toISOString();
  const prices: NormalizedPrice[] = [];

  if (citiesFound.length > 0 && octanePrices.length >= citiesFound.length) {
    citiesFound.forEach((city, i) => {
      const price = octanePrices[i];
      if (price !== null) {
        prices.push({
          source: "pso",
          product: "octane_plus",
          price_pkr: price,
          unit: "litre",
          city,
          effective_date: null,
          scraped_at,
        });
      }
    });
  }

  // National single-value products, searched across the whole page text.
  const premierMatch = text.match(/Euro5\s*Premier[\s\S]{0,60}?Rs\.?([\d.]+)\/Ltr/i);
  const dieselMatch = text.match(/Hi-Cetane[\s\S]{0,120}?Rs\.?([\d.]+)\/Ltr/i);
  const lpgMatch = text.match(/LPG[^.]{0,60}?Rs\.?([\d.]+)\/KG/i);

  const premierPrice = parseNumber(premierMatch?.[1]);
  const dieselPrice = parseNumber(dieselMatch?.[1]);
  const lpgPrice = parseNumber(lpgMatch?.[1]);

  if (premierPrice !== null) {
    prices.push({
      source: "pso",
      product: "petrol",
      price_pkr: premierPrice,
      unit: "litre",
      city: null,
      effective_date: null,
      scraped_at,
    });
  }
  if (dieselPrice !== null) {
    prices.push({
      source: "pso",
      product: "hsd",
      price_pkr: dieselPrice,
      unit: "litre",
      city: null,
      effective_date: null,
      scraped_at,
    });
  }
  if (lpgPrice !== null) {
    prices.push({
      source: "pso",
      product: "lpg",
      price_pkr: lpgPrice,
      unit: "kg",
      city: null,
      effective_date: null,
      scraped_at,
    });
  }

  if (prices.length === 0) {
    throw new ScrapeError("pso", "No prices extracted — page structure may have changed");
  }

  const lastUpdatedMatch = text.match(/Last Updated on:\s*([\d]{1,2}\s+\w+\s+\d{4})/i);

  return {
    source: "pso",
    source_last_updated: lastUpdatedMatch?.[1] ?? null,
    prices,
  };
}
