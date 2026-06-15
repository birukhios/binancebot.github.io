import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { memoryAdapter } from "@better-auth/memory-adapter";
import { betterAuth } from "better-auth";
import { dash } from "@better-auth/infra";
import { tanstackStartCookies } from "better-auth/tanstack-start";

function resolveAuthBaseURL() {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  return {
    allowedHosts: ["localhost", "127.0.0.1", "*.vercel.app"],
    fallback: process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://127.0.0.1:${process.env.PORT ?? "8080"}`,
  };
}

const dbPath = resolve(
  process.env.BETTER_AUTH_DB_PATH ?? (process.env.VERCEL ? "/tmp/auth.sqlite" : "./data/auth.sqlite"),
);
mkdirSync(dirname(dbPath), { recursive: true });
const memoryDb = (globalThis as typeof globalThis & { __authMemoryDb?: Record<string, any[]> }).__authMemoryDb ??= {};

const database = process.env.VERCEL
  ? memoryAdapter(memoryDb)
  : (await import("better-sqlite3")).default;

export const auth = betterAuth({
  baseURL: resolveAuthBaseURL(),
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "local-development-better-auth-secret-change-before-production",
  database: process.env.VERCEL ? database : new database(dbPath),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    dash({
      apiKey: process.env.BETTER_AUTH_API_KEY,
    }),
    tanstackStartCookies(),
  ],
});
