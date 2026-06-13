// Binance USDⓈ-M Futures REST client. Server-only.
import { createHmac } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { localBinanceCredsForUser } from "@/lib/binance/local-creds.server";

const MAINNET = "https://fapi.binance.com";
const TESTNET = "https://testnet.binancefuture.com";
const BINANCE_TIMEOUT_MS = 7_000;

// Original owner can still fall back to the env-stored keys.
const OWNER_USER_ID = "766ced41-29ab-4304-9497-800a95bb7530";

export interface BinanceCreds {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
}

export function isBinanceAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  // Only treat true credential/permission failures as auth errors that pause the bot.
  // Transient network/CloudFront 403s ("Binance network blocked", generic 403/401)
  // are NOT credential errors — testnet does not restrict by IP, so we let the
  // bot retry on the next loop instead of stopping it.
  return (
    message.includes("\"code\":-2015") ||
    message.includes("\"code\":-1022") ||
    message.includes("\"code\":-2014") ||
    message.includes("Invalid API-key, IP, or permissions") ||
    message.includes("Signature for this request is not valid") ||
    message.includes("signature is not valid") ||
    message.includes("Binance rejected the saved")
  );
}

export function formatBinanceError(error: unknown, testnet: boolean) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Binance network blocked")) {
    return message.length > 320 ? `${message.slice(0, 317)}…` : message;
  }
  if (isBinanceAuthError(error)) {
    return `Binance rejected the saved ${testnet ? "testnet" : "mainnet"} key. Update this account's ${testnet ? "testnet" : "mainnet"} API key and secret in Settings, and make sure it is a Futures key with trading permission${testnet ? " from Binance Futures Testnet" : ""}.`;
  }
  return message.length > 260 ? `${message.slice(0, 257)}…` : message;
}

function transientBinanceError(creds: BinanceCreds, method: string, path: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  const network = creds.testnet ? "testnet" : "mainnet";
  return new Error(
    `Binance Futures ${network} is temporarily unreachable from this server (${method} ${path}: ${message}). The bot will keep retrying.`,
  );
}

function cleanBinanceError(creds: BinanceCreds, method: string, path: string, status: number, body: string) {
  const network = creds.testnet ? "testnet" : "mainnet";
  const isHtml = /<!doctype html|<html|cloudfront|request blocked/i.test(body);
  if (isHtml) {
    if (creds.testnet) {
      return `Binance Futures testnet temporarily rejected this demo request (${method} ${path} ${status}). The bot will retry; this is not treated as an API-key or IP restriction failure.`;
    }
    return `Binance network blocked this server request (${method} ${path} ${status}). Your saved Futures ${network} key may be valid, but Binance/CloudFront is rejecting requests from this cloud server IP. Use the local/VPS bot runner from an IP allowed by Binance, or remove any Binance key IP restriction only if Binance still allows this server IP.`;
  }
  if (status === 403) {
    if (creds.testnet) {
      return `Binance Futures testnet temporarily rejected this demo request (${method} ${path} ${status}). The bot will retry; this is not treated as an API-key or IP restriction failure.`;
    }
    return `Binance network blocked or rejected this server request (${method} ${path} ${status}). If Test API recently succeeded, your Futures ${network} key is likely valid but Binance is rejecting this cloud server/IP. Run the local/VPS bot runner from an IP allowed by Binance, or create a Binance key with no IP restriction if Binance accepts this server IP.`;
  }

  try {
    const parsed = JSON.parse(body) as { code?: number; msg?: string };
    if (parsed.code === -2015) {
      return `Binance rejected the saved ${network} key: ${parsed.msg ?? "invalid API key, IP, or permissions"}. Update this account's ${network} API key and secret in Settings.`;
    }
    if (parsed.code === -1022 || /signature/i.test(parsed.msg ?? "")) {
      return `Binance rejected the saved ${network} key/secret pair because the request signature is invalid. Re-enter both this account's ${network} API key and ${network} API secret together in Settings.`;
    }
    if (parsed.msg) return `Binance ${method} ${path} ${status}: ${parsed.msg}`;
  } catch {
    // Fall through to a short plain-text error.
  }

  return `Binance ${method} ${path} ${status}: ${body.slice(0, 260)}`;
}

function envCreds(testnet: boolean): BinanceCreds | null {
  const apiKey = testnet
    ? process.env.BINANCE_TESTNET_API_KEY ?? process.env.BINANCE_API_KEY
    : process.env.BINANCE_API_KEY;
  const apiSecret = testnet
    ? process.env.BINANCE_TESTNET_API_SECRET ?? process.env.BINANCE_API_SECRET
    : process.env.BINANCE_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret, testnet };
}

/**
 * Legacy helper for the original owner. Reads creds from env secrets.
 * Per-user creds are loaded via getCredsForUser().
 */
export function getCreds(testnet: boolean): BinanceCreds {
  const c = envCreds(testnet);
  if (!c) {
    throw new Error(
      testnet
        ? "Testnet Binance keys not configured. Add them in Settings → API keys."
        : "Mainnet Binance keys not configured. Add them in Settings → API keys.",
    );
  }
  return c;
}

/** Load Binance creds for a specific user. Falls back to env for the original owner. */
export async function getCredsForUser(userId: string, testnet: boolean): Promise<BinanceCreds> {
  const localCreds = localBinanceCredsForUser(userId);
  const localApiKey = testnet ? localCreds?.testnet_api_key : localCreds?.api_key;
  const localApiSecret = testnet ? localCreds?.testnet_api_secret : localCreds?.api_secret;
  if (localApiKey && localApiSecret) return { apiKey: localApiKey, apiSecret: localApiSecret, testnet };

  const { data } = await supabaseAdmin
    .from("user_binance_creds")
    .select("api_key,api_secret,testnet_api_key,testnet_api_secret")
    .eq("user_id", userId)
    .maybeSingle();
  const apiKey = testnet ? data?.testnet_api_key : data?.api_key;
  const apiSecret = testnet ? data?.testnet_api_secret : data?.api_secret;
  if (apiKey && apiSecret) return { apiKey, apiSecret, testnet };

  if (userId === OWNER_USER_ID) {
    const env = envCreds(testnet);
    if (env) return env;
  }
  throw new Error(
    testnet
      ? "Testnet Binance keys not configured for your account. Add them in Settings → API keys."
      : "Mainnet Binance keys not configured for your account. Add them in Settings → API keys.",
  );
}

function base(creds: BinanceCreds) {
  return creds.testnet ? TESTNET : MAINNET;
}

const serverTimeOffsetCache = new Map<string, { offsetMs: number; expiresAt: number }>();

async function serverTimestamp(creds: BinanceCreds, forceRefresh = false) {
  const host = base(creds);
  const cached = serverTimeOffsetCache.get(host);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return Date.now() + cached.offsetMs;
  }
  try {
    const res = await fetch(`${host}/fapi/v1/time`, {
      headers: { "user-agent": "crypto-caddie-demo/1.0" },
      signal: AbortSignal.timeout(BINANCE_TIMEOUT_MS),
    });
    const json = (await res.json()) as { serverTime?: number };
    if (res.ok && Number.isFinite(json.serverTime)) {
      const offsetMs = Number(json.serverTime) - Date.now();
      serverTimeOffsetCache.set(host, { offsetMs, expiresAt: Date.now() + 60_000 });
      return Date.now() + offsetMs;
    }
  } catch {
    // Fall back to local time; the signed request will return a clearer error if this is wrong.
  }
  return Date.now();
}

function sign(secret: string, query: string) {
  return createHmac("sha256", secret).update(query).digest("hex");
}

function qs(params: Record<string, string | number | boolean | undefined>) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
}

function networkBlocked(status: number, body: string) {
  return status === 403 || /<!doctype html|<html|cloudfront|request blocked/i.test(body);
}

function stepDecimals(step: string | number | undefined) {
  const s = String(step ?? "1");
  if (!s.includes(".")) return 0;
  return s.replace(/0+$/, "").split(".")[1]?.length ?? 0;
}

function bybitInterval(interval: string | number | undefined) {
  const value = String(interval ?? "1h");
  const map: Record<string, string> = { "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "1d": "D" };
  return map[value] ?? value.replace(/m$/, "").replace("h", "60").replace("d", "D");
}

async function bybitJson<T>(path: string, params: Record<string, string | number | undefined> = {}) {
  const query = qs(params);
  const res = await fetch(`https://api.bybit.com${path}${query ? `?${query}` : ""}`, {
    headers: { "user-agent": "crypto-caddie-demo/1.0" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bybit ${path} ${res.status}: ${text.slice(0, 160)}`);
  const json = JSON.parse(text) as any;
  if (json.retCode !== 0) throw new Error(`Bybit ${path}: ${json.retMsg ?? "request failed"}`);
  return json as T;
}

async function demoMarketFallback<T>(path: string, params: Record<string, string | number>, originalError: Error): Promise<T> {
  // In demo/testnet mode, keep using real market prices even when Binance's
  // unauthenticated testnet market-data edge blocks this cloud runtime.
  try {
    const url = `${MAINNET}${path}${Object.keys(params).length ? "?" + qs(params) : ""}`;
    const res = await fetch(url, { headers: { "user-agent": "crypto-caddie-demo/1.0" } });
    const text = await res.text();
    if (res.ok) return JSON.parse(text) as T;
    if (!networkBlocked(res.status, text)) throw new Error(`Binance ${path} ${res.status}: ${text.slice(0, 160)}`);
  } catch {
    // Fall through to the non-Binance market-data mirror below.
  }

  if (path === "/fapi/v1/premiumIndex" && params.symbol) {
    const data = await bybitJson<{ result: { list: any[] } }>("/v5/market/tickers", {
      category: "linear",
      symbol: String(params.symbol),
    });
    const row = data.result.list?.[0];
    if (!row) throw originalError;
    return {
      symbol: String(params.symbol),
      markPrice: row.markPrice ?? row.lastPrice,
      indexPrice: row.indexPrice ?? row.markPrice ?? row.lastPrice,
      lastFundingRate: row.fundingRate ?? "0",
      nextFundingTime: Number(row.nextFundingTime ?? 0),
    } as T;
  }

  if (path === "/fapi/v1/premiumIndex") {
    const data = await bybitJson<{ result: { list: any[] } }>("/v5/market/tickers", { category: "linear" });
    return (data.result.list ?? []).map((row) => ({
      symbol: row.symbol,
      markPrice: row.markPrice ?? row.lastPrice,
      indexPrice: row.indexPrice ?? row.markPrice ?? row.lastPrice,
      lastFundingRate: row.fundingRate ?? "0",
      nextFundingTime: Number(row.nextFundingTime ?? 0),
    })) as T;
  }

  if (path === "/fapi/v1/klines" && params.symbol) {
    const data = await bybitJson<{ result: { list: any[][] } }>("/v5/market/kline", {
      category: "linear",
      symbol: String(params.symbol),
      interval: bybitInterval(params.interval),
      limit: Number(params.limit ?? 100),
    });
    return (data.result.list ?? [])
      .slice()
      .reverse()
      .map((k) => [Number(k[0]), k[1], k[2], k[3], k[4], k[5], Number(k[0]), k[6] ?? "0", 0, "0", "0", "0"]) as T;
  }

  if (path === "/fapi/v1/exchangeInfo") {
    const pages: any[] = [];
    let cursor: string | undefined;
    do {
      const data = await bybitJson<{ result: { list: any[]; nextPageCursor?: string } }>("/v5/market/instruments-info", {
        category: "linear",
        limit: 1000,
        cursor,
      });
      pages.push(...(data.result.list ?? []));
      cursor = data.result.nextPageCursor || undefined;
    } while (cursor);
    return {
      symbols: pages.map((row) => {
        const tickSize = row.priceFilter?.tickSize ?? "0.01";
        const stepSize = row.lotSizeFilter?.qtyStep ?? "0.001";
        return {
          symbol: row.symbol,
          pricePrecision: stepDecimals(tickSize),
          quantityPrecision: stepDecimals(stepSize),
          filters: [
            { filterType: "PRICE_FILTER", tickSize },
            { filterType: "LOT_SIZE", stepSize, minQty: row.lotSizeFilter?.minOrderQty ?? stepSize },
            { filterType: "MIN_NOTIONAL", notional: row.lotSizeFilter?.minNotionalValue ?? "5" },
          ],
        };
      }),
    } as T;
  }

  throw originalError;
}

async function publicReq<T>(creds: BinanceCreds, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = `${base(creds)}${path}${Object.keys(params).length ? "?" + qs(params) : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "crypto-caddie-demo/1.0" },
      signal: AbortSignal.timeout(BINANCE_TIMEOUT_MS),
    });
  } catch (e) {
    const error = transientBinanceError(creds, "GET", path, e);
    if (creds.testnet) return demoMarketFallback<T>(path, params, error);
    throw error;
  }
  if (!res.ok) {
    const text = await res.text();
    const error = new Error(
      networkBlocked(res.status, text)
        ? `Binance ${path} ${res.status}: demo market-data request was blocked by Binance's network/security layer.`
        : `Binance ${path} ${res.status}: ${text.slice(0, 260)}`,
    );
    if (creds.testnet && networkBlocked(res.status, text)) return demoMarketFallback<T>(path, params, error);
    throw error;
  }
  return res.json() as Promise<T>;
}

async function signedReq<T>(
  creds: BinanceCreds,
  method: "GET" | "POST" | "DELETE" | "PUT",
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const makeRequest = async (forceTimeRefresh = false) => {
    const full = { ...params, timestamp: await serverTimestamp(creds, forceTimeRefresh), recvWindow: 60_000 };
    const query = qs(full);
    const sig = sign(creds.apiSecret, query);
    const url = `${base(creds)}${path}?${query}&signature=${sig}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { "X-MBX-APIKEY": creds.apiKey, "user-agent": "crypto-caddie-demo/1.0" },
        signal: AbortSignal.timeout(BINANCE_TIMEOUT_MS),
      });
    } catch (e) {
      throw transientBinanceError(creds, method, path, e);
    }
    return { res, text: await res.text() };
  };

  let { res, text } = await makeRequest();
  if (!res.ok && /"code"\s*:\s*-1021|outside of the recvWindow|Timestamp/i.test(text)) {
    const responseDate = res.headers.get("date");
    const responseMs = responseDate ? Date.parse(responseDate) : NaN;
    if (Number.isFinite(responseMs)) {
      const host = base(creds);
      serverTimeOffsetCache.set(host, { offsetMs: responseMs - Date.now(), expiresAt: Date.now() + 60_000 });
      ({ res, text } = await makeRequest(false));
    } else {
      ({ res, text } = await makeRequest(true));
    }
  }
  if (!res.ok) throw new Error(cleanBinanceError(creds, method, path, res.status, text));
  return JSON.parse(text) as T;
}

// --- Endpoints ---

export interface AccountInfo {
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  availableBalance: string;
  canTrade?: boolean;
  canDeposit?: boolean;
  canWithdraw?: boolean;
  feeTier?: number;
  assets: Array<{ asset: string; walletBalance: string; unrealizedProfit: string }>;
  positions: Array<{
    symbol: string;
    positionAmt: string;
    entryPrice: string;
    unrealizedProfit: string;
    leverage: string;
    isolated: boolean;
    positionSide: string;
  }>;
}

export function isBinanceNetworkBlock(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Binance network blocked") ||
    message.includes("temporarily unreachable") ||
    message.includes("fetch failed") ||
    message.includes("Connection reset") ||
    message.includes("aborted") ||
    /\b403\b/.test(message) ||
    /cloudfront|request blocked/i.test(message)
  );
}

async function fallbackPositionRiskFromAccount(creds: BinanceCreds, symbol?: string) {
  const acct = await signedReq<AccountInfo>(creds, "GET", "/fapi/v2/account");
  const marks = await publicReq<Array<{ symbol: string; markPrice: string }>>(creds, "/fapi/v1/premiumIndex").catch(() => []);
  const markBySymbol = new Map(marks.map((m) => [m.symbol, m.markPrice]));
  return acct.positions
    .filter((p) => !symbol || p.symbol === symbol)
    .map((p) => ({
      ...p,
      markPrice: markBySymbol.get(p.symbol) ?? p.entryPrice ?? "0",
      unRealizedProfit: p.unrealizedProfit ?? "0",
      liquidationPrice: "0",
      marginType: p.isolated ? "isolated" : "cross",
      isolatedMargin: "0",
      isolatedWallet: "0",
      notional: String(Math.abs(Number(p.positionAmt ?? 0) * Number(markBySymbol.get(p.symbol) ?? p.entryPrice ?? 0))),
    }));
}

export const binance = {
  ping: (c: BinanceCreds) => publicReq<{}>(c, "/fapi/v1/ping"),
  serverTime: (c: BinanceCreds) => publicReq<{ serverTime: number }>(c, "/fapi/v1/time"),
  exchangeInfo: (c: BinanceCreds) => publicReq<{ symbols: any[] }>(c, "/fapi/v1/exchangeInfo"),
  markPrice: (c: BinanceCreds, symbol: string) =>
    publicReq<{ symbol: string; markPrice: string; indexPrice: string; lastFundingRate: string; nextFundingTime: number }>(c, "/fapi/v1/premiumIndex", { symbol }),
  premiumIndexAll: (c: BinanceCreds) =>
    publicReq<Array<{ symbol: string; markPrice: string; lastFundingRate: string; nextFundingTime: number }>>(c, "/fapi/v1/premiumIndex"),
  klines: (c: BinanceCreds, symbol: string, interval: string, limit = 100) =>
    publicReq<any[][]>(c, "/fapi/v1/klines", { symbol, interval, limit }),

  account: (c: BinanceCreds) => signedReq<AccountInfo>(c, "GET", "/fapi/v2/account"),
  positionRisk: async (c: BinanceCreds, symbol?: string) => {
    try {
      return await signedReq<any[]>(c, "GET", "/fapi/v2/positionRisk", symbol ? { symbol } : {});
    } catch (e) {
      if (c.testnet && isBinanceNetworkBlock(e)) {
        try {
          return await fallbackPositionRiskFromAccount(c, symbol);
        } catch (fallbackError) {
          if (isBinanceNetworkBlock(fallbackError)) return [];
          throw fallbackError;
        }
      }
      throw e;
    }
  },
  openOrders: (c: BinanceCreds, symbol?: string) =>
    signedReq<any[]>(c, "GET", "/fapi/v1/openOrders", symbol ? { symbol } : {}),
  userTrades: (c: BinanceCreds, symbol: string, fromId?: number, limit = 100) =>
    signedReq<any[]>(c, "GET", "/fapi/v1/userTrades", { symbol, fromId, limit }),
  income: (
    c: BinanceCreds,
    params: { symbol?: string; incomeType?: string; startTime?: number; endTime?: number; limit?: number } = {},
  ) => signedReq<Array<{ symbol: string; incomeType: string; income: string; time: number }>>(c, "GET", "/fapi/v1/income", params),

  setLeverage: (c: BinanceCreds, symbol: string, leverage: number) =>
    signedReq<{ leverage: number }>(c, "POST", "/fapi/v1/leverage", { symbol, leverage }),
  setMarginType: (c: BinanceCreds, symbol: string, marginType: "ISOLATED" | "CROSSED") =>
    signedReq<any>(c, "POST", "/fapi/v1/marginType", { symbol, marginType }).catch(() => null),

  placeOrder: (
    c: BinanceCreds,
    p: {
      symbol: string;
      side: "BUY" | "SELL";
      type: "LIMIT" | "MARKET";
      quantity: number;
      price?: number;
      timeInForce?: "GTC" | "IOC" | "FOK" | "GTX";
      reduceOnly?: boolean;
      newClientOrderId?: string;
    },
  ) =>
    signedReq<{ orderId: number; clientOrderId: string; status: string }>(c, "POST", "/fapi/v1/order", {
      ...p,
      timeInForce: p.type === "LIMIT" ? (p.timeInForce ?? "GTC") : undefined,
    }),

  cancelOrder: (c: BinanceCreds, symbol: string, orderId: number) =>
    signedReq<any>(c, "DELETE", "/fapi/v1/order", { symbol, orderId }),
  cancelAllOrders: (c: BinanceCreds, symbol: string) =>
    signedReq<any>(c, "DELETE", "/fapi/v1/allOpenOrders", { symbol }),
};

// Helper: round qty/price to symbol filters
export interface SymbolFilters {
  tickSize: number;
  stepSize: number;
  minQty: number;
  minNotional: number;
  pricePrecision: number;
  quantityPrecision: number;
}

const filtersCache = new Map<string, SymbolFilters>();

export async function getSymbolFilters(c: BinanceCreds, symbol: string): Promise<SymbolFilters> {
  const cached = filtersCache.get(`${c.testnet}:${symbol}`);
  if (cached) return cached;
  const info = await binance.exchangeInfo(c);
  const s = info.symbols.find((x: any) => x.symbol === symbol);
  if (!s) throw new Error(`Symbol ${symbol} not found on exchange`);
  const lot = s.filters.find((f: any) => f.filterType === "LOT_SIZE");
  const tick = s.filters.find((f: any) => f.filterType === "PRICE_FILTER");
  const notional = s.filters.find((f: any) => f.filterType === "MIN_NOTIONAL");
  const f: SymbolFilters = {
    stepSize: parseFloat(lot.stepSize),
    minQty: parseFloat(lot.minQty),
    tickSize: parseFloat(tick.tickSize),
    minNotional: notional ? parseFloat(notional.notional) : 5,
    pricePrecision: s.pricePrecision,
    quantityPrecision: s.quantityPrecision,
  };
  filtersCache.set(`${c.testnet}:${symbol}`, f);
  return f;
}

export function roundStep(value: number, step: number, precision: number): number {
  const rounded = Math.floor(value / step) * step;
  return parseFloat(rounded.toFixed(precision));
}

export type CredCheck = {
  ok: boolean;
  reason?: string;
  account?: AccountInfo;
};

/**
 * Pre-flight sanity check for saved Binance creds.
 * - Confirms the key reaches the correct Futures endpoint (testnet vs mainnet host).
 * - Detects the common mistake of pasting a Spot-testnet key (testnet.binance.vision)
 *   against the Futures-testnet host (testnet.binancefuture.com) — those return 401/-2014/-2015.
 * - Confirms the key has Futures trading permission (canTrade === true).
 */
export async function verifyFuturesCreds(creds: BinanceCreds): Promise<CredCheck> {
  const network = creds.testnet ? "testnet" : "mainnet";
  const correctHost = creds.testnet
    ? "https://testnet.binancefuture.com"
    : "https://fapi.binance.com";
  const wrongHost = creds.testnet
    ? "Binance Spot Testnet (testnet.binance.vision)"
    : "Binance Spot (api.binance.com)";

  // 1. Public ping is advisory only. Binance/CloudFront can block this unauthenticated
  // endpoint from some server IPs even when signed Futures account calls work.
  try {
    await binance.ping(creds);
  } catch {
    // Continue to the signed account check; that is the real credential sanity check.
  }

  // 2. Signed account call — proves the key/secret pair authenticates against the Futures API.
  let account: AccountInfo;
  try {
    account = await binance.account(creds);
  } catch (e) {
    const msg = (e as Error).message || String(e);
    // -2014: API-key format invalid. -2015: invalid API key, IP, or permissions.
    // These are the exact responses you get when a Spot key is sent to the Futures API.
    if (creds.testnet && isBinanceNetworkBlock(e)) {
      return {
        ok: false,
        reason:
          `Binance Futures ${network} temporarily rejected the account check from this runtime. ` +
          `This is not treated as a credential failure in demo mode; the bot can keep running and retry live reads on the next tick.`,
      };
    }
    if (msg.includes("Binance network blocked")) {
      return { ok: false, reason: msg };
    }
    if (/-201[45]/.test(msg) || /Invalid API-key/i.test(msg) || / 40[13]:/.test(msg)) {
      return {
        ok: false,
        reason:
          `Binance Futures ${network} rejected this key. Most common cause: the key is from ${wrongHost} instead of Binance Futures ${network} (${correctHost}). ` +
          `Spot and Futures testnet are separate accounts with separate keys — create a Futures key at ${correctHost} and re-save it in Settings. ` +
          `Other possibilities: the key lacks Futures permission, or an IP allow-list is blocking the request.`,
      };
    }
    return { ok: false, reason: `Binance ${network} authentication failed: ${msg}` };
  }

  // 3. Permission check — key authenticated, but does it allow trading?
  if (account.canTrade === false) {
    return {
      ok: false,
      reason:
        `Binance ${network} key authenticated, but it does NOT have Futures trading permission. ` +
        `Enable "Enable Futures" / trading permission on the key (at ${correctHost}) and re-save it in Settings.`,
      account,
    };
  }

  return { ok: true, account };
}
