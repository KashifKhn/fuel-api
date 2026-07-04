import { createClient } from "@libsql/client";

/**
 * We use Turso (hosted libSQL, SQLite-compatible) instead of a local
 * bun:sqlite file because Heroku's filesystem is EPHEMERAL — any local file
 * is wiped on every dyno restart/cycle (at least once every 24h). Turso keeps
 * the same SQLite mental model but the data actually survives.
 *
 * For local dev, point TURSO_DATABASE_URL at "file:local.db" and leave
 * TURSO_AUTH_TOKEN unset — libSQL supports plain local files too.
 */
const url = process.env.TURSO_DATABASE_URL ?? "file:local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

export const db = createClient({
  url,
  authToken,
});
