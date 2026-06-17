import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { betterAuth } from "better-auth";
import { dash } from "@better-auth/infra";
import { tanstackStartCookies } from "better-auth/tanstack-start";

function isServerlessRuntime() {
  return Boolean(
    process.env.VERCEL ||
      process.env.VERCEL_URL ||
      process.env.NOW_REGION ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.LAMBDA_TASK_ROOT,
  );
}

function resolveAuthBaseURL() {
  const fallback =
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://127.0.0.1:${process.env.PORT ?? "8080"}`);

  return {
    allowedHosts: [
      "localhost",
      "localhost:*",
      "127.0.0.1",
      "127.0.0.1:*",
      "binancebot-github-io.vercel.app",
      "*.vercel.app",
      "*.trycloudflare.com",
      "*.loca.lt",
    ],
    fallback,
    protocol: "auto" as const,
  };
}

function resolveTrustedOrigins() {
  const origins = [
    "http://localhost",
    "http://localhost:*",
    "http://127.0.0.1",
    "http://127.0.0.1:*",
    "https://binancebot-github-io.vercel.app",
    "https://*.vercel.app",
    "https://*.trycloudflare.com",
    "https://*.loca.lt",
  ];

  if (process.env.BETTER_AUTH_URL) {
    try {
      origins.push(new URL(process.env.BETTER_AUTH_URL).origin);
    } catch {}
  }

  if (process.env.VERCEL_URL) {
    origins.push(`https://${process.env.VERCEL_URL}`);
  }

  return Array.from(new Set(origins));
}

const requestedDbPath =
  process.env.BETTER_AUTH_DB_PATH ?? (isServerlessRuntime() ? "/tmp/auth.sqlite" : "./data/auth.sqlite");
const dbPath = requestedDbPath.startsWith("/") ? requestedDbPath : resolve(requestedDbPath);
if (!dbPath.startsWith("/tmp/")) {
  mkdirSync(dirname(dbPath), { recursive: true });
}
const sqliteModule = await import("better-sqlite3");
const database = new sqliteModule.default(dbPath);

database.exec(`
  CREATE TABLE IF NOT EXISTS "user" (
    "id" text not null primary key,
    "name" text not null,
    "email" text not null unique,
    "emailVerified" integer not null,
    "image" text,
    "createdAt" date not null,
    "updatedAt" date not null
  );

  CREATE TABLE IF NOT EXISTS "session" (
    "id" text not null primary key,
    "expiresAt" date not null,
    "token" text not null unique,
    "createdAt" date not null,
    "updatedAt" date not null,
    "ipAddress" text,
    "userAgent" text,
    "userId" text not null references "user" ("id") on delete cascade
  );

  CREATE TABLE IF NOT EXISTS "account" (
    "id" text not null primary key,
    "accountId" text not null,
    "providerId" text not null,
    "userId" text not null references "user" ("id") on delete cascade,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" date,
    "refreshTokenExpiresAt" date,
    "scope" text,
    "password" text,
    "createdAt" date not null,
    "updatedAt" date not null
  );

  CREATE TABLE IF NOT EXISTS "verification" (
    "id" text not null primary key,
    "identifier" text not null,
    "value" text not null,
    "expiresAt" date not null,
    "createdAt" date not null,
    "updatedAt" date not null
  );
`);

export const auth = betterAuth({
  baseURL: resolveAuthBaseURL(),
  trustedOrigins: resolveTrustedOrigins,
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "local-development-better-auth-secret-change-before-production",
  database,
  session: {
    storeSessionInDatabase: false,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 7,
      strategy: "jwe",
    },
  },
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
