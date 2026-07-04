export type Source = "pso" | "shell" | "pakwheels";

export type Product =
  | "petrol" // Super/Premier grade petrol
  | "octane_plus" // PSO's premium Euro5 Octane+
  | "hsd" // High Speed Diesel
  | "lsd" // Light Speed Diesel
  | "lpg"
  | "kerosene";

export interface NormalizedPrice {
  source: Source;
  product: Product;
  price_pkr: number;
  unit: "litre" | "kg";
  city: string | null; // null = national / single price
  effective_date: string | null; // as stated by the source, if available
  scraped_at: string; // ISO timestamp, set by orchestrator
}

export interface ScraperResult {
  source: Source;
  prices: NormalizedPrice[];
  source_last_updated: string | null; // free-text timestamp the source itself displays, if any
}
