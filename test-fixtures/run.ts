import { readFile } from "node:fs/promises";
import { scrapeShell } from "../src/scrapers/shell";
import { scrapePakWheels } from "../src/scrapers/pakwheels";
import { scrapePso } from "../src/scrapers/pso";

const fixtures: Record<string, string> = {
  "https://www.shell.com.pk/motorists/shell-fuels/shell-station-price-board.html": "shell.html",
  "https://www.pakwheels.com/petroleum-prices-in-pakistan": "pakwheels.html",
  "https://psopk.com/": "pso.html",
};

const realFetch = globalThis.fetch;
// @ts-expect-error - overriding for test purposes
globalThis.fetch = async (url: string) => {
  const fixture = fixtures[url];
  if (!fixture) throw new Error(`no fixture for ${url}`);
  const html = await readFile(new URL(`./${fixture}`, import.meta.url), "utf-8");
  return new Response(html, { status: 200 });
};

async function main() {
  console.log("=== Shell ===");
  console.log(JSON.stringify(await scrapeShell(), null, 2));

  console.log("\n=== PakWheels ===");
  console.log(JSON.stringify(await scrapePakWheels(), null, 2));

  console.log("\n=== PSO ===");
  console.log(JSON.stringify(await scrapePso(), null, 2));

  globalThis.fetch = realFetch;
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
