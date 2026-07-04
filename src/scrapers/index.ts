import { scrapeShell } from "./shell";
import { scrapePakWheels } from "./pakwheels";
import { scrapePso } from "./pso";
import type { NormalizedPrice, Source } from "./types";

export interface ScrapeRunSummary {
  ranAt: string;
  ok: Source[];
  failed: { source: Source; error: string }[];
  prices: NormalizedPrice[];
}

const SCRAPERS: { source: Source; run: () => Promise<{ prices: NormalizedPrice[] }> }[] = [
  { source: "shell", run: scrapeShell },
  { source: "pakwheels", run: scrapePakWheels },
  { source: "pso", run: scrapePso },
];

/**
 * Runs all scrapers independently — one source failing (e.g. a redesign breaks
 * our PSO parser) never blocks the other two, and never wipes out the last
 * good data for the source that failed. The caller decides what to persist.
 */
export async function runAllScrapers(): Promise<ScrapeRunSummary> {
  const results = await Promise.allSettled(SCRAPERS.map((s) => s.run()));

  const summary: ScrapeRunSummary = {
    ranAt: new Date().toISOString(),
    ok: [],
    failed: [],
    prices: [],
  };

  results.forEach((result, i) => {
    const { source } = SCRAPERS[i];
    if (result.status === "fulfilled") {
      summary.ok.push(source);
      summary.prices.push(...result.value.prices);
    } else {
      summary.failed.push({
        source,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return summary;
}
