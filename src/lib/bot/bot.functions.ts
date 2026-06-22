import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import {
  binance,
  formatBinanceError,
  getCredsForUser,
  isBinanceNetworkBlock,
  isBinanceAuthError,
  verifyFuturesCreds,
  type BinanceCreds,
} from "@/lib/binance/client.server";
import {
  closePositionAndCancel,
  syncFillsForSymbol,
  getTrendBias,
  getMarketSession,
} from "@/lib/binance/grid.server";
import { localBinanceCredsForUser, saveLocalBinanceCreds } from "@/lib/binance/local-creds.server";
import {
  addLocalLog,
  adjustTestnetRealizedToday,
  applyPaperHighRiskProfile as applyLocalPaperHighRiskProfile,
  PAPER_HIGH_RISK_PROFILE,
  getLocalBotState,
  updateLocalBotConfig,
  updateLocalSymbol,
} from "@/lib/bot/local-bot-store.server";
import {
  ensureLocalBotRunner,
  runLocalBotTick,
  stopLocalBotRunner,
} from "@/lib/bot/local-runner.server";
import { botLog } from "@/lib/bot/log.server";
import { mapPositions, mapOpenOrders, FUTURES_MAKER_FEE_RATE } from "@/lib/bot/position-mapper.server";
import {
  setLocalDashboardSnapshot,
  getLocalDashboardSnapshot,
  binanceNetworkRouteStatus,
  realizedTodayFromTradeHistory,
  localStartRiskBlock,
  botDayStartMs,
} from "@/lib/bot/dashboard-helpers.server";

const remoteDb: any = null;

function hasRemoteDb() {
  return false;
}

async function localDashboardFallback(userId: string) {
  const local = getLocalBotState(userId);
  if (local.cfg.is_running) ensureLocalBotRunner(userId);
  const testnet = Boolean(local.cfg.testnet ?? true);
  const snapshot = getLocalDashboardSnapshot(userId, testnet);
  const snapshotFresh = snapshot ? Date.now() - snapshot.updatedAt < 60_000 : false;
  const mainnetCreds = localBinanceCredsForUser(userId);
  const credsStatus = {
    mainnet: Boolean(mainnetCreds?.api_key && mainnetCreds?.api_secret),
    testnet: Boolean(mainnetCreds?.testnet_api_key && mainnetCreds?.testnet_api_secret),
  };
  let account: any = snapshotFresh ? (snapshot?.account ?? null) : null;
  let positions: any[] = snapshotFresh ? [...(snapshot?.positions ?? [])] : [];
  let openOrders: any[] = snapshotFresh ? [...(snapshot?.openOrders ?? [])] : [];
  let error: string | null = null;
  let realizedToday = snapshotFresh ? (snapshot?.realizedToday ?? 0) : 0;
  const trendBias: Record<string, "up" | "down" | "flat" | null> = snapshotFresh
    ? { ...(snapshot?.trendBias ?? {}) }
    : {};
  const marketSession = getMarketSession();

  const hasSelectedCreds = testnet ? credsStatus.testnet : credsStatus.mainnet;
  if (hasSelectedCreds) {
    try {
      const creds = await getCredsForUser(userId, testnet);
      const symbolsForPnL = local.symbols.filter((s) => s.enabled).map((s) => s.symbol);
      const sinceMs = (() => {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        return d.getTime();
      })();
      const accountUnavailable = (e: unknown) => creds.testnet && isBinanceNetworkBlock(e);
      const [acct, risk, premium, liveOrders, realizedTradesToday, income] = await Promise.all([
        binance.account(creds).catch((e) => {
          if (accountUnavailable(e)) return null;
          throw e;
        }),
        binance.positionRisk(creds).catch((e) => {
          if (accountUnavailable(e)) return [] as any[];
          throw e;
        }),
        binance.premiumIndexAll(creds).catch(() => [] as any[]),
        binance.openOrders(creds).catch(() => [] as any[]),
        realizedTodayFromTradeHistory(creds, symbolsForPnL, sinceMs),
        binance.income(creds, { startTime: sinceMs, limit: 1000 }).catch(() => [] as any[]),
      ]);

      const rawRealizedToday = (income ?? [])
        .filter((r) => ["REALIZED_PNL", "COMMISSION", "FUNDING_FEE"].includes(r.incomeType))
        .reduce((s, r) => s + Number(r.income || 0), 0);
      realizedToday = realizedTradesToday !== 0 ? realizedTradesToday : rawRealizedToday;
      if (testnet) {
        realizedToday = realizedTradesToday;
      } else {
        realizedToday = adjustTestnetRealizedToday(userId, realizedToday);
      }

      const marginBalance = parseFloat(acct?.totalMarginBalance ?? "0") || 0;
      account = acct
        ? {
            totalWalletBalance: acct.totalWalletBalance,
            totalUnrealizedProfit: acct.totalUnrealizedProfit,
            totalMarginBalance: acct.totalMarginBalance,
            availableBalance: acct.availableBalance,
          }
        : null;
      const premiumBySym = new Map<string, any>((premium ?? []).map((p) => [p.symbol, p]));
      const symConfigBySymbol = new Map<string, any>(local.symbols.map((s) => [s.symbol, s]));

      await Promise.all(
        local.symbols
          .filter((s) => s.enabled && (s.trend_filter_enabled ?? true))
          .map(async (s) => {
            const mark = parseFloat(premiumBySym.get(s.symbol)?.markPrice ?? "0") || 0;
            if (mark <= 0) {
              trendBias[s.symbol] = null;
              return;
            }
            trendBias[s.symbol] = await getTrendBias(
              creds,
              s.symbol,
              s.trend_interval ?? "1h",
              Math.max(5, Number(s.trend_ema_period ?? 50)),
              mark,
              marketSession.flatThresholdPct,
            );
          }),
      );

      positions = mapPositions(risk ?? [], premium ?? [], acct?.positions ?? [], marginBalance, symConfigBySymbol);
      openOrders = mapOpenOrders(liveOrders ?? []);

      setLocalDashboardSnapshot(userId, testnet, {
        account,
        positions,
        openOrders,
        realizedToday,
        trendBias,
      });
    } catch (e) {
      error = formatBinanceError(e, testnet);
      if (snapshotFresh) {
        account = account ?? snapshot?.account ?? null;
        positions = positions.length > 0 ? positions : [...(snapshot?.positions ?? [])];
        openOrders = openOrders.length > 0 ? openOrders : [...(snapshot?.openOrders ?? [])];
      realizedToday = realizedToday || snapshot?.realizedToday || 0;
        for (const [symbol, bias] of Object.entries(snapshot?.trendBias ?? {})) {
          if (!(symbol in trendBias)) trendBias[symbol] = bias;
        }
      }
    }
  }

  if (!snapshotFresh && (positions.length > 0 || openOrders.length > 0 || account)) {
    setLocalDashboardSnapshot(userId, testnet, {
      account,
      positions,
      openOrders,
      realizedToday,
      trendBias,
    });
  }

  return {
    cfg: local.cfg,
    symbols: local.symbols,
    account,
    positions,
    openOrders,
    snapshotAt: new Date().toISOString(),
    error,
    realizedToday,
    credsStatus,
    trendBias,
    marketSession,
    binanceNetworkRoute: await binanceNetworkRouteStatus(),
  };
}

async function loadCreds(userId: string): Promise<{ creds: BinanceCreds; testnet: boolean }> {
  const testnet = Boolean(getLocalBotState(userId).cfg.testnet ?? true);
  const creds = await getCredsForUser(userId, testnet);
  return { creds, testnet };
}

async function pauseBotForCredentialError(userId: string, message: string) {
  updateLocalBotConfig(userId, { is_running: false });
  await botLog(userId, "error", `Bot paused: ${message}`);
}

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    if (!hasRemoteDb()) return await localDashboardFallback(userId);

    let { data: cfg } = await remoteDb
      .from("bot_config")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    const { data: symbols } = await remoteDb
      .from("symbol_config")
      .select("*")
      .eq("user_id", userId)
      .order("symbol");

    // Indicate whether the user has saved Binance creds (without leaking them).
    const { data: credsRow } = await remoteDb
      .from("user_binance_creds")
      .select("api_key,testnet_api_key")
      .eq("user_id", userId)
      .maybeSingle();
    // Owner can also fall back to env-stored keys — probe getCredsForUser so
    // the UI doesn't show "Set up required" when env keys are present.
    const hasEnvCreds = async (tn: boolean) => {
      try {
        await getCredsForUser(userId, tn);
        return true;
      } catch {
        return false;
      }
    };
    const credsStatus = {
      mainnet: !!credsRow?.api_key || (await hasEnvCreds(false)),
      testnet: !!credsRow?.testnet_api_key || (await hasEnvCreds(true)),
    };

    let account: any = null;
    let positions: any[] = [];
    let openOrders: any[] = [];
    let error: string | null = null;
    let realizedTodayBinance: number | null = null;
    const trendBias: Record<string, "up" | "down" | "flat" | null> = {};
    const marketSession = getMarketSession();
    try {
      const { creds } = await loadCreds(userId);
      const sinceMs = (() => {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        return d.getTime();
      })();
      const accountUnavailable = (e: unknown) => creds.testnet && isBinanceNetworkBlock(e);
      const [acct, risk, premium, income, liveOrders] = await Promise.all([
        binance.account(creds).catch((e) => {
          if (accountUnavailable(e)) return null;
          throw e;
        }),
        binance.positionRisk(creds).catch((e) => {
          if (accountUnavailable(e)) return [] as any[];
          throw e;
        }),
        binance.premiumIndexAll(creds).catch(() => [] as any[]),
        binance.income(creds, { startTime: sinceMs, limit: 1000 }).catch(() => [] as any[]),
        binance.openOrders(creds).catch(() => [] as any[]),
      ]);
      // Net realized = REALIZED_PNL + COMMISSION (negative) + FUNDING_FEE
      const rawRealizedToday = (income ?? [])
        .filter((r) => ["REALIZED_PNL", "COMMISSION", "FUNDING_FEE"].includes(r.incomeType))
        .reduce((s, r) => s + Number(r.income || 0), 0);
      realizedTodayBinance = adjustTestnetRealizedToday(userId, rawRealizedToday);
      const marginBalance = parseFloat(acct?.totalMarginBalance ?? "0") || 0;
      account = acct
        ? {
            totalWalletBalance: acct.totalWalletBalance,
            totalUnrealizedProfit: acct.totalUnrealizedProfit,
            totalMarginBalance: acct.totalMarginBalance,
            availableBalance: acct.availableBalance,
          }
        : null;
      const premiumBySym = new Map<string, any>((premium ?? []).map((p) => [p.symbol, p]));
      const symConfigBySymbol = new Map<string, any>((symbols ?? []).map((s) => [s.symbol, s]));

      // Trend bias per enabled symbol (best-effort, parallel; failures → null).
      const enabledForTrend = (symbols ?? []).filter(
        (s: any) => s.enabled && (s.trend_filter_enabled ?? true),
      );
      await Promise.all(
        enabledForTrend.map(async (s: any) => {
          const mark = parseFloat(premiumBySym.get(s.symbol)?.markPrice ?? "0") || 0;
          if (mark <= 0) {
            trendBias[s.symbol] = null;
            return;
          }
          trendBias[s.symbol] = await getTrendBias(
            creds,
            s.symbol,
            s.trend_interval ?? "1h",
            Math.max(5, Number(s.trend_ema_period ?? 50)),
            mark,
            marketSession.flatThresholdPct,
          );
        }),
      );
      positions = mapPositions(risk ?? [], premium ?? [], acct?.positions ?? [], marginBalance, symConfigBySymbol);
      openOrders = mapOpenOrders(liveOrders ?? []);
    } catch (e) {
      const message = formatBinanceError(e, cfg?.testnet ?? true);
      if (cfg?.is_running && isBinanceAuthError(e)) {
        await pauseBotForCredentialError(userId, message);
        cfg = { ...cfg, is_running: false };
      }
      error = message;
    }

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { data: todayTrades } = await remoteDb
      .from("trades")
      .select("realized_pnl,commission")
      .eq("user_id", userId)
      .gte("filled_at", since.toISOString());
    const realizedTodayDb = (todayTrades ?? []).reduce(
      (s, t) => s + Number(t.realized_pnl) - Number(t.commission ?? 0),
      0,
    );
    const realizedToday = realizedTodayDb || realizedTodayBinance || 0;

    return {
      cfg,
      symbols,
      account,
      positions,
      openOrders,
      snapshotAt: new Date().toISOString(),
      error,
      realizedToday,
      credsStatus,
      trendBias,
      marketSession,
      binanceNetworkRoute: await binanceNetworkRouteStatus(),
    };
  });

const tradesQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  symbol: z.string().trim().optional().default("all"),
  side: z.enum(["all", "BUY", "SELL"]).default("all"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const getTrades = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: z.infer<typeof tradesQuerySchema>) => tradesQuerySchema.parse(d))
  .handler(async ({ context, data: input }) => {
    const page = input?.page ?? 1;
    const pageSize = input?.pageSize ?? 20;
    const symbolFilter = input?.symbol ?? "all";
    const sideFilter = input?.side ?? "all";
    const startMs = input?.startDate ? new Date(input.startDate).getTime() : 0;
    const endMs = input?.endDate ? new Date(input.endDate).getTime() + 86400000 : Infinity;

    const filterTrades = (rows: any[]) => {
      const filtered = rows.filter((trade) => {
        if (symbolFilter !== "all" && trade.symbol !== symbolFilter) return false;
        if (sideFilter !== "all" && trade.side !== sideFilter) return false;
        if (startMs > 0 || endMs < Infinity) {
          const t = new Date(trade.filled_at).getTime();
          if (t < startMs || t > endMs) return false;
        }
        return true;
      });
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const currentPage = Math.min(page, totalPages);
      const start = (currentPage - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize);
      return { items, total, page: currentPage, pageSize, totalPages };
    };

    if (!hasRemoteDb()) {
      const local = getLocalBotState(context.userId);
      const testnet = Boolean(local.cfg.testnet ?? true);
      const creds = await getCredsForUser(context.userId, testnet);
      const enabledSymbols = local.symbols.filter((s) => s.enabled).map((s) => s.symbol);
      const symbols =
        enabledSymbols.length > 0 ? enabledSymbols : local.symbols.map((s) => s.symbol);
      const trades = (
        await Promise.all(
          symbols.map(async (symbol) => {
            try {
              return await binance.userTrades(creds, symbol, undefined, 100);
            } catch {
              return [] as any[];
            }
          }),
        )
      ).flat();
      const normalized = trades
        .map((t: any) => ({
          id: `${t.symbol}-${t.id}`,
          symbol: t.symbol,
          side: t.side,
          price: Number(t.price),
          qty: Number(t.qty),
          realized_pnl: Number(t.realizedPnl ?? 0),
          commission: Number(t.commission ?? 0),
          binance_order_id: t.orderId,
          binance_trade_id: t.id,
          filled_at: new Date(t.time).toISOString(),
        }))
        .sort((a, b) => new Date(b.filled_at).getTime() - new Date(a.filled_at).getTime())
        .slice(0, 200);
      return filterTrades(normalized);
    }

    let dbQuery = remoteDb
      .from("trades")
      .select("*", { count: "exact" })
      .eq("user_id", context.userId)
      .order("filled_at", { ascending: false });

    if (symbolFilter !== "all") dbQuery = dbQuery.eq("symbol", symbolFilter);
    if (sideFilter !== "all") dbQuery = dbQuery.eq("side", sideFilter);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data: rows, count } = await dbQuery.range(from, to);
    const total = count ?? rows?.length ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      items: rows ?? [],
      total,
      page: Math.min(page, totalPages),
      pageSize,
      totalPages,
    };
  });

export const getRealizedPnlHistory = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .validator(
    (d: { startTime?: number; endTime?: number }) =>
      z.object({ startTime: z.number().optional(), endTime: z.number().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const local = getLocalBotState(userId);
    const testnet = Boolean(local.cfg.testnet ?? true);
    const creds = await getCredsForUser(userId, testnet);
    const now = Date.now();
    const startTime = data.startTime ?? now - 24 * 60 * 60 * 1000;
    const endTime = data.endTime ?? now;
    const income = await binance
      .income(creds, { startTime, endTime, limit: 1000 })
      .catch(() => [] as any[]);
    const relevant = income.filter((r: any) =>
      ["REALIZED_PNL", "COMMISSION", "FUNDING_FEE"].includes(r.incomeType),
    );
    const total = relevant.reduce((s: number, r: any) => s + Number(r.income || 0), 0);
    return {
      total,
      breakdown: relevant.map((r: any) => ({
        symbol: r.symbol,
        type: r.incomeType,
        amount: Number(r.income || 0),
        time: Number(r.time || 0),
      })),
    };
  });

export const getLogs = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    if (!hasRemoteDb()) return getLocalBotState(context.userId).logs;

    const { data } = await remoteDb
      .from("bot_logs")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

export const setBotRunning = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { running: boolean }) => z.object({ running: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!hasRemoteDb()) {
      if (data.running) {
        const { creds, testnet } = await loadCreds(context.userId);
        const check = await verifyFuturesCreds(creds);
        if (
          !check.ok &&
          !(testnet && check.reason?.includes("not treated as a credential failure"))
        ) {
          throw new Error(`Can't start bot: ${check.reason}`);
        }
        if (check.ok) {
          addLocalLog(
            context.userId,
            "info",
            `Pre-flight OK — Futures ${testnet ? "testnet" : "mainnet"} key authenticated, wallet=${check.account?.totalWalletBalance ?? "?"} USDT`,
          );
        } else {
          addLocalLog(context.userId, "warn", `Pre-flight account check skipped — ${check.reason}`);
        }
        const riskBlock = await localStartRiskBlock(context.userId, creds);
        if (riskBlock) {
          addLocalLog(context.userId, "error", riskBlock);
          throw new Error(`Can't start bot: ${riskBlock}`);
        }
      }
      updateLocalBotConfig(context.userId, { is_running: data.running });
      addLocalLog(context.userId, "info", data.running ? "Bot started" : "Bot stopped");
      if (data.running) {
        ensureLocalBotRunner(context.userId);
        runLocalBotTick(context.userId).catch((error) => {
          addLocalLog(
            context.userId,
            "error",
            `Initial local tick failed: ${(error as Error).message}`,
          );
        });
      } else {
        stopLocalBotRunner(context.userId);
      }
      return { ok: true };
    }

    if (data.running) {
      const { data: cfg } = await remoteDb
        .from("bot_config")
        .select("testnet")
        .eq("user_id", context.userId)
        .maybeSingle();
      const testnet = cfg?.testnet ?? true;
      let creds: BinanceCreds;
      try {
        creds = await getCredsForUser(context.userId, testnet);
      } catch (e) {
        const message = (e as Error).message;
        throw new Error(
          message.includes("not configured")
            ? `Save your Binance ${testnet ? "testnet" : "mainnet"} API key and secret in Settings before starting the bot.`
            : `Can't start bot: ${message}`,
        );
      }
      // Sanity check: correct API surface (Futures vs Spot) + trading permission.
      const check = await verifyFuturesCreds(creds);
      if (!check.ok) {
        if (testnet && check.reason?.includes("not treated as a credential failure")) {
          await botLog(
            context.userId,
            "warn",
            `Pre-flight account check skipped — ${check.reason}`,
          );
        } else {
          await pauseBotForCredentialError(
            context.userId,
            check.reason ?? "Credential check failed",
          );
          throw new Error(`Can't start bot: ${check.reason}`);
        }
      } else {
        await botLog(
          context.userId,
          "info",
          `Pre-flight OK — Futures ${testnet ? "testnet" : "mainnet"} key authenticated, canTrade=true, wallet=${check.account?.totalWalletBalance ?? "?"} USDT`,
        );
      }
    }
    await remoteDb
      .from("bot_config")
      .update({ is_running: data.running, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    await botLog(context.userId, "info", data.running ? "Bot started" : "Bot stopped");
    return { ok: true };
  });

export const setTestnet = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { testnet: boolean }) => z.object({ testnet: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!hasRemoteDb()) {
      updateLocalBotConfig(context.userId, {
        testnet: data.testnet,
        is_running: false,
        max_open_trades: data.testnet ? 4 : 1,
        bot_capital_pct: data.testnet ? 30 : 100,
      });
      if (!data.testnet) {
        updateLocalSymbol(context.userId, "BTCUSDT", {
          order_size_usdt: 5,
          min_order_size_usdt: 5,
          max_order_size_usdt: 10,
        });
      }
      addLocalLog(
        context.userId,
        "warn",
        `Switched to ${data.testnet ? "TESTNET" : "MAINNET"} and stopped the bot`,
      );
      return { ok: true };
    }

    await remoteDb
      .from("bot_config")
      .update({
      testnet: data.testnet,
      is_running: false,
      max_open_trades: data.testnet ? 4 : 1,
      bot_capital_pct: data.testnet ? 30 : 100,
      updated_at: new Date().toISOString(),
    })
      .eq("user_id", context.userId);
    if (!data.testnet) {
      await remoteDb
        .from("symbol_config")
        .update({
          order_size_usdt: 5,
          min_order_size_usdt: 5,
          max_order_size_usdt: 10,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", context.userId)
        .eq("symbol", "BTCUSDT");
    }
    await botLog(
      context.userId,
      "warn",
      `Switched to ${data.testnet ? "TESTNET" : "MAINNET"} and stopped the bot`,
    );
    return { ok: true };
  });

export const setMaxExposure = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { max: number }) => z.object({ max: z.number().positive() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!hasRemoteDb()) {
      updateLocalBotConfig(context.userId, { max_total_notional_usdt: data.max });
      return { ok: true };
    }

    await remoteDb
      .from("bot_config")
      .update({ max_total_notional_usdt: data.max })
      .eq("user_id", context.userId);
    return { ok: true };
  });

const intelligenceSchema = z.object({
  advisor_enabled: z.boolean().optional(),
  auto_select_enabled: z.boolean().optional(),
  auto_select_max_symbols: z.number().int().min(1).max(15).optional(),
  drawdown_pause_pct: z.number().min(0).max(50).optional(),
  max_open_trades: z.number().int().min(1).max(4).optional(),
  news_pause_enabled: z.boolean().optional(),
  news_pause_window_min: z.number().int().min(0).max(240).optional(),
  news_currencies: z.string().max(64).optional(),
});

export const setIntelligence = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: z.infer<typeof intelligenceSchema>) => intelligenceSchema.parse(d))
  .handler(async ({ data, context }) => {
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const k of Object.keys(data) as Array<keyof typeof data>) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    if (!hasRemoteDb()) {
      updateLocalBotConfig(context.userId, patch);
      addLocalLog(context.userId, "info", `Intelligence settings updated: ${JSON.stringify(data)}`);
      return { ok: true };
    }

    await remoteDb
      .from("bot_config")
      .update(patch as any)
      .eq("user_id", context.userId);
    await botLog(context.userId, "info", `Intelligence settings updated: ${JSON.stringify(data)}`);
    return { ok: true };
  });

export const applyPaperHighRiskProfile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    if (!hasRemoteDb()) {
      stopLocalBotRunner(context.userId);
      applyLocalPaperHighRiskProfile(context.userId);
      addLocalLog(
        context.userId,
        "warn",
        "Applied paper high-risk profile: TESTNET-only, 8x leverage, tighter grids, and hard kill switches.",
      );
      return { ok: true };
    }

    await remoteDb
      .from("bot_config")
      .update({
        risk_profile: PAPER_HIGH_RISK_PROFILE,
        testnet: true,
        is_running: false,
        bot_capital_pct: 40,
        daily_profit_target_pct: 4,
        daily_loss_limit_pct: 0.75,
        max_open_trades: 2,
        consecutive_loss_pause_count: 1,
        drawdown_pause_pct: 2,
        max_total_notional_usdt: 0,
        paper_start_equity_usdt: null,
        paper_peak_equity_usdt: null,
        paper_api_failure_count: 0,
        paper_kill_switch_triggered_at: null,
        paper_kill_switch_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", context.userId);
    await botLog(context.userId, "warn", "Applied paper high-risk profile");
    return { ok: true };
  });

export const runAutoSelect = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    if (!hasRemoteDb()) {
      const local = getLocalBotState(context.userId);
      const max = Number(local.cfg.auto_select_max_symbols ?? 4);
      const top = local.symbols.slice(0, max).map((s) => ({ symbol: s.symbol, score: 0 }));
      for (const item of top) updateLocalSymbol(context.userId, item.symbol, { enabled: true });
      addLocalLog(
        context.userId,
        "info",
        `Local ranking enabled: ${top.map((t) => t.symbol).join(", ")}`,
      );
      return { ok: true, top };
    }

    const { rankAndApplyAutoSelect } = await import("@/lib/bot/ranking.server");
    const { data: cfg } = await remoteDb
      .from("bot_config")
      .select("auto_select_max_symbols")
      .eq("user_id", context.userId)
      .maybeSingle();
    const max = Number((cfg as any)?.auto_select_max_symbols ?? 4);
    const top = await rankAndApplyAutoSelect(context.userId, max);
    return { ok: true, top };
  });

export const getNewsStatus = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    if (!hasRemoteDb()) {
      return { enabled: false, active: false } as const;
    }

    const { data: cfg } = await remoteDb
      .from("bot_config")
      .select("news_pause_enabled,news_pause_window_min,news_currencies")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!cfg || (cfg as any).news_pause_enabled === false) {
      return { enabled: false, active: false } as const;
    }
    const { getBlackout } = await import("@/lib/bot/news.server");
    const currencies = String((cfg as any).news_currencies ?? "USD")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const bo = await getBlackout({
      windowMinutes: Number((cfg as any).news_pause_window_min ?? 30),
      currencies,
    });
    return { enabled: true, ...bo } as const;
  });

const symbolSchema = z.object({
  symbol: z.string(),
  enabled: z.boolean(),
  grid_levels: z.number().int().min(1).max(20),
  grid_spacing_pct: z.number().positive(),
  order_size_usdt: z.number().positive(),
  leverage: z.number().int().min(1).max(20),
  upper_bound: z.number().nullable(),
  lower_bound: z.number().nullable(),
  auto_tune: z.boolean().optional(),
  min_order_size_usdt: z.number().positive().optional(),
  max_order_size_usdt: z.number().positive().optional(),
  min_spacing_pct: z.number().positive().optional(),
  max_spacing_pct: z.number().positive().optional(),
  stop_loss_roi_pct: z.number().max(0).optional(),
  max_position_age_minutes: z.number().int().min(0).optional(),
  trend_filter_enabled: z.boolean().optional(),
  trend_ema_period: z.number().int().min(5).max(500).optional(),
  trend_interval: z.enum(["15m", "30m", "1h", "2h", "4h", "1d"]).optional(),
  extreme_loss_threshold_usdt: z.number().max(0).optional(),
  extreme_loss_cooldown_min: z.number().int().min(0).max(1440).optional(),
  funding_filter_enabled: z.boolean().optional(),
  funding_max_abs_bps: z.number().min(0).max(1000).optional(),
  z_filter_enabled: z.boolean().optional(),
  z_lookback: z.number().int().min(5).max(500).optional(),
  z_interval: z.enum(["15m", "30m", "1h", "2h", "4h", "1d"]).optional(),
  z_entry_threshold: z.number().min(0).max(10).optional(),
});

export const updateSymbol = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: z.infer<typeof symbolSchema>) => symbolSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (!hasRemoteDb()) {
      const testnet = Boolean(getLocalBotState(context.userId).cfg.testnet ?? true);
      const liveMinOrderUsdt = 5;
      const nextData =
        !testnet && data.symbol === "BTCUSDT"
          ? {
              ...data,
              order_size_usdt: Math.max(liveMinOrderUsdt, Number(data.order_size_usdt ?? 0)),
              min_order_size_usdt: Math.max(liveMinOrderUsdt, Number(data.min_order_size_usdt ?? 0)),
              max_order_size_usdt: Math.max(liveMinOrderUsdt, Number(data.max_order_size_usdt ?? 0)),
            }
          : data;
      updateLocalSymbol(context.userId, data.symbol, nextData);
      addLocalLog(context.userId, "info", `Updated ${data.symbol} symbol settings`, data.symbol);
      if (getLocalBotState(context.userId).cfg.is_running) {
        ensureLocalBotRunner(context.userId);
        runLocalBotTick(context.userId).catch((error) => {
          addLocalLog(
            context.userId,
            "error",
            `Symbol update tick failed: ${(error as Error).message}`,
            data.symbol,
          );
        });
      }
      return { ok: true };
    }

    const { data: botCfg } = await remoteDb
      .from("bot_config")
      .select("testnet")
      .eq("user_id", context.userId)
      .maybeSingle();
    const testnet = Boolean((botCfg as any)?.testnet ?? true);
    const liveMinOrderUsdt = 5;
    const nextData =
      !testnet && data.symbol === "BTCUSDT"
        ? {
            ...data,
            order_size_usdt: Math.max(liveMinOrderUsdt, Number(data.order_size_usdt ?? 0)),
            min_order_size_usdt: Math.max(liveMinOrderUsdt, Number(data.min_order_size_usdt ?? 0)),
            max_order_size_usdt: Math.max(liveMinOrderUsdt, Number(data.max_order_size_usdt ?? 0)),
          }
        : data;

    await remoteDb
      .from("symbol_config")
      .update({ ...nextData, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol);
    return { ok: true };
  });

export const learnSymbol = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { symbol: string }) => z.object({ symbol: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!hasRemoteDb()) {
      const userId = context.userId;
      const symbol = data.symbol;
      const state = getLocalBotState(userId);
      const cfg = state.symbols.find((s) => s.symbol === symbol);
      if (!cfg) return { applied: false, note: "symbol not configured" };

      const { creds } = await loadCreds(userId);
      const { researchOpenSourceInspiredStrategies } =
        await import("@/lib/bot/strategy-research.server");
      const [fills, klines, account] = await Promise.all([
        binance.userTrades(creds, symbol, undefined, 500).catch(() => [] as any[]),
        binance.klines(creds, symbol, "1h", 1000),
        binance.account(creds),
      ]);
      const closedFills = fills
        .map((t: any) => ({
          realizedPnl: Number(t.realizedPnl ?? 0),
          commission: String(t.commissionAsset ?? "")
            .toUpperCase()
            .includes("USDT")
            ? Number(t.commission ?? 0)
            : 0,
        }))
        .filter((t) => t.realizedPnl !== 0 || t.commission !== 0);

      const research = researchOpenSourceInspiredStrategies(klines, {
        symbol,
        availableBalance: Math.max(
          0,
          Number(account.availableBalance ?? account.totalWalletBalance ?? 0),
        ),
      });
      const patch = { ...research.patch };

      let fillNote = `own fills: ${closedFills.length}/12, not enough to override research`;
      if (closedFills.length >= 12) {
        const netPnl = closedFills.reduce((sum, t) => sum + t.realizedPnl - t.commission, 0);
        const wins = closedFills.filter((t) => t.realizedPnl - t.commission > 0).length;
        const losses = closedFills.filter((t) => t.realizedPnl - t.commission < 0).length;
        const winRate = wins / closedFills.length;
        const currentSpacing = Number(patch.grid_spacing_pct ?? cfg.grid_spacing_pct ?? 0.8);
        const currentStop = Number(patch.stop_loss_roi_pct ?? cfg.stop_loss_roi_pct ?? -12);

        if (netPnl > 0 && winRate >= 0.58) {
          patch.grid_spacing_pct = Math.max(0.6, currentSpacing - 0.05);
          patch.stop_loss_roi_pct = Math.max(-16, currentStop - 1);
        } else if (netPnl < 0 || losses > wins) {
          patch.grid_spacing_pct = Math.min(1.2, currentSpacing + 0.1);
          patch.stop_loss_roi_pct = Math.min(-8, currentStop + 2);
        }
        patch.learning_net_pnl = Math.round(netPnl * 10000) / 10000;
        patch.learning_win_rate = Math.round(winRate * 10000) / 10000;
        patch.learning_fills = closedFills.length;
        fillNote = `own fills: net ${netPnl.toFixed(4)} USDT, win rate ${(winRate * 100).toFixed(1)}%`;
      }
      patch.learning_notes = `${patch.learning_notes}. ${fillNote}.`;
      patch.learning_fills = closedFills.length;
      patch.learning_at = new Date().toISOString();

      updateLocalSymbol(userId, symbol, {
        ...patch,
        grid_levels: 2,
        learning_at: new Date().toISOString(),
      });
      updateLocalBotConfig(userId, { max_open_trades: 4 });
      addLocalLog(
        userId,
        "info",
        `Learned open-source-inspired strategy: ${research.best.source}/${research.best.name} over ${Math.round(klines.length / 24)}d. OOS PnL ${research.best.test.realizedPnl} USDT, fills ${research.best.test.fills}, DD ${research.best.test.maxDrawdown}. Applied spacing ${patch.grid_spacing_pct}%, stop ${patch.stop_loss_roi_pct}%, ${patch.leverage}x. ${fillNote}.`,
        symbol,
      );
      return {
        applied: true,
        note: `applied ${research.best.source}/${research.best.name}: spacing ${patch.grid_spacing_pct}%, stop ${patch.stop_loss_roi_pct}%, ${patch.leverage}x`,
      };
    }

    const { learnFromTrades } = await import("@/lib/bot/learn.server");
    const { data: cfg } = await remoteDb
      .from("symbol_config")
      .select("*")
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol)
      .maybeSingle();
    if (!cfg) return { applied: false, note: "symbol not configured" };
    return learnFromTrades(cfg as any, { force: true });
  });

export const killSwitch = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    if (!hasRemoteDb()) {
      stopLocalBotRunner(userId);
      updateLocalBotConfig(userId, { is_running: false });
      const { creds } = await loadCreds(userId);
      const symbols = getLocalBotState(userId).symbols;
      for (const s of symbols) {
        try {
          await binance.cancelAllOrders(creds, s.symbol);
          addLocalLog(userId, "warn", "Canceled all open orders from kill switch", s.symbol);
        } catch (e) {
          addLocalLog(userId, "warn", `cancelAll ${s.symbol}: ${(e as Error).message}`, s.symbol);
        }
      }
      addLocalLog(
        userId,
        "error",
        "KILL SWITCH activated - bot stopped and all open orders were canceled",
      );
      return { ok: true };
    }

    await remoteDb.from("bot_config").update({ is_running: false }).eq("user_id", userId);
    try {
      const { creds } = await loadCreds(userId);
      const { data: symbols } = await remoteDb
        .from("symbol_config")
        .select("symbol")
        .eq("user_id", userId);
      for (const s of symbols ?? []) {
        try {
          await binance.cancelAllOrders(creds, s.symbol);
        } catch (e) {
          await botLog(userId, "warn", `cancelAll ${s.symbol}: ${(e as Error).message}`);
        }
      }
      await remoteDb
        .from("grid_orders")
        .update({ status: "CANCELED" })
        .eq("user_id", userId)
        .eq("status", "NEW");
      await botLog(userId, "error", "KILL SWITCH activated – bot stopped and all orders canceled");
    } catch (e) {
      await botLog(userId, "error", `kill switch: ${(e as Error).message}`);
      throw e;
    }
    return { ok: true };
  });

export const closePosition = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { symbol: string }) => z.object({ symbol: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { creds } = await loadCreds(userId);
    const closed = await closePositionAndCancel(userId, creds, data.symbol);
    await botLog(
      userId,
      closed ? "info" : "warn",
      closed
        ? "Manually closed position and canceled symbol orders"
        : "Manual close found no open position",
      data.symbol,
    );
    if (hasRemoteDb()) {
      await syncFillsForSymbol(userId, creds, data.symbol);
    }
    return { ok: true, message: closed ? "closed" : "no position" };
  });

export const cancelSymbolOrders = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { symbol: string }) => z.object({ symbol: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { creds } = await loadCreds(userId);
    await binance.cancelAllOrders(creds, data.symbol);
    if (!hasRemoteDb()) {
      addLocalLog(userId, "info", "Canceled all open orders", data.symbol);
      return { ok: true };
    }

    await remoteDb
      .from("grid_orders")
      .update({ status: "CANCELED" })
      .eq("user_id", userId)
      .eq("symbol", data.symbol)
      .eq("status", "NEW");
    await botLog(userId, "info", "Canceled all open orders", data.symbol);
    return { ok: true };
  });

export const testConnection = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    let activeTestnet = true;
    try {
      const { creds, testnet } = await loadCreds(context.userId);
      activeTestnet = testnet;
      const check = await verifyFuturesCreds(creds);
      if (!check.ok) {
        if (testnet && check.reason?.includes("not treated as a credential failure")) {
          return { ok: true, testnet, balance: "demo", canTrade: true, warning: check.reason };
        }
        return { ok: false, testnet, error: check.reason };
      }
      return {
        ok: true,
        testnet,
        balance: check.account!.totalWalletBalance,
        canTrade: check.account!.canTrade ?? true,
      };
    } catch (e) {
      const msg = isBinanceAuthError(e)
        ? formatBinanceError(e, activeTestnet)
        : (e as Error).message;
      return { ok: false, error: msg };
    }
  });

// --- Per-user Binance creds management ---

const credsSchema = z.object({
  api_key: z.string().nullable().optional(),
  api_secret: z.string().nullable().optional(),
  testnet_api_key: z.string().nullable().optional(),
  testnet_api_secret: z.string().nullable().optional(),
});

function cleanOptionalSecret(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const saveBinanceCreds = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: z.infer<typeof credsSchema>) => credsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const mainnetApiKey = cleanOptionalSecret(data.api_key);
    const mainnetApiSecret = cleanOptionalSecret(data.api_secret);
    const testnetApiKey = cleanOptionalSecret(data.testnet_api_key);
    const testnetApiSecret = cleanOptionalSecret(data.testnet_api_secret);

    if (!!mainnetApiKey !== !!mainnetApiSecret) {
      throw new Error("Enter both the mainnet API key and mainnet API secret together.");
    }
    if (!!testnetApiKey !== !!testnetApiSecret) {
      throw new Error("Enter both the testnet API key and testnet API secret together.");
    }

    // Only overwrite complete key/secret pairs. Empty/undefined leaves the existing pair untouched.
    const patch: Record<string, string> = {};
    if (mainnetApiKey && mainnetApiSecret) {
      patch.api_key = mainnetApiKey;
      patch.api_secret = mainnetApiSecret;
    }
    if (testnetApiKey && testnetApiSecret) {
      patch.testnet_api_key = testnetApiKey;
      patch.testnet_api_secret = testnetApiSecret;
    }

    if (Object.keys(patch).length === 0) {
      throw new Error("Enter a complete Binance API key and secret pair before saving.");
    }

    if (!hasRemoteDb()) {
      saveLocalBinanceCreds(userId, patch);
      addLocalLog(userId, "info", "Updated Binance API credentials");
      return { ok: true };
    }

    const { data: existing } = await remoteDb
      .from("user_binance_creds")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      await remoteDb
        .from("user_binance_creds")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    } else {
      await remoteDb.from("user_binance_creds").insert({ user_id: userId, ...patch });
    }
    await botLog(userId, "info", "Updated Binance API credentials");
    return { ok: true };
  });

export const autoConfigureSymbol = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { symbol: string }) => z.object({ symbol: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { creds } = await loadCreds(userId);
    const symbol = data.symbol;

    const [klines, acct, mark] = await Promise.all([
      binance.klines(creds, symbol, "1h", 168),
      binance.account(creds),
      binance.markPrice(creds, symbol),
    ]);

    if (!klines.length) throw new Error(`No kline data for ${symbol}`);

    const highs = klines.map((k) => parseFloat(k[2] as string));
    const lows = klines.map((k) => parseFloat(k[3] as string));
    const closes = klines.map((k) => parseFloat(k[4] as string));
    const ranges = klines.map((k, i) => {
      const high = parseFloat(k[2] as string);
      const low = parseFloat(k[3] as string);
      return (high - low) / closes[i];
    });
    const avgRangePct = (ranges.reduce((a, b) => a + b, 0) / ranges.length) * 100;
    const high7d = Math.max(...highs);
    const low7d = Math.min(...lows);
    const price = parseFloat(mark.markPrice);

    const last24 = closes.slice(-24);
    const trendPct = ((last24[last24.length - 1] - last24[0]) / last24[0]) * 100;

    const spacingPctRaw = Math.max(0.2, Math.min(2.0, avgRangePct * 1.2));
    const spacingPct = Math.round(spacingPctRaw * 100) / 100;
    const gridLevels = 1;
    const leverage = Math.max(2, Math.min(5, Math.round(2 / spacingPct)));

    if (!hasRemoteDb()) {
      const available = parseFloat(acct.availableBalance) || 0;
      const orderSize = Math.max(75, Math.min(150, Math.round(available * 0.02 * 100) / 100));
      const lowerBound = Math.round(low7d * 0.98 * 1e6) / 1e6;
      const upperBound = Math.round(high7d * 1.02 * 1e6) / 1e6;
      updateLocalSymbol(userId, symbol, {
        enabled: true,
        grid_levels: 1,
        grid_spacing_pct: spacingPct,
        order_size_usdt: orderSize,
        min_order_size_usdt: 50,
        max_order_size_usdt: 150,
        leverage,
        lower_bound: lowerBound,
        upper_bound: upperBound,
        backtest_at: new Date().toISOString(),
      });
      updateLocalBotConfig(userId, {
        max_total_notional_usdt: Math.max(1500, Math.ceil(orderSize * 3)),
      });
      addLocalLog(
        userId,
        "info",
        `Auto-configured one-grid ${symbol}: 1 order × ${spacingPct.toFixed(2)}% spacing, ${leverage}x, ${orderSize} USDT. Range ${lowerBound}-${upperBound}. Vol ${avgRangePct.toFixed(2)}%/h, 24h trend ${trendPct.toFixed(2)}%.`,
        symbol,
      );
      return {
        ok: true,
        analysis: {
          price,
          avgHourlyRangePct: Number(avgRangePct.toFixed(3)),
          trend24hPct: Number(trendPct.toFixed(2)),
          high7d,
          low7d,
          availableBalance: available,
        },
        config: {
          grid_levels: 1,
          grid_spacing_pct: spacingPct,
          order_size_usdt: orderSize,
          leverage,
          lower_bound: lowerBound,
          upper_bound: upperBound,
        },
      };
    }

    const [{ data: botCfg }, { data: otherSymbols }] = await Promise.all([
      remoteDb.from("bot_config").select("max_total_notional_usdt").eq("user_id", userId).single(),
      remoteDb
        .from("symbol_config")
        .select("symbol,enabled,order_size_usdt,grid_levels")
        .eq("user_id", userId)
        .neq("symbol", symbol),
    ]);
    const currentCap = Number(botCfg?.max_total_notional_usdt ?? 500);
    const otherExposure = (otherSymbols ?? [])
      .filter((r) => r.enabled)
      .reduce((sum, r) => sum + Number(r.order_size_usdt) * Number(r.grid_levels) * 2, 0);

    const available = parseFloat(acct.availableBalance) || 0;
    const totalOrders = gridLevels * 2;

    let orderSize = (available * 0.5) / totalOrders;
    orderSize = Math.max(5.5, orderSize);
    orderSize = Math.round(orderSize * 100) / 100;

    const thisExposure = orderSize * totalOrders;
    const requiredCap = Math.ceil(otherExposure + thisExposure);
    const newCap = Math.max(currentCap, requiredCap);

    const lowerBound = Math.round(low7d * 0.98 * 1e6) / 1e6;
    const upperBound = Math.round(high7d * 1.02 * 1e6) / 1e6;

    await remoteDb
      .from("symbol_config")
      .update({
        grid_levels: gridLevels,
        grid_spacing_pct: spacingPct,
        order_size_usdt: orderSize,
        leverage,
        lower_bound: lowerBound,
        upper_bound: upperBound,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("symbol", symbol);

    if (newCap !== currentCap) {
      await remoteDb
        .from("bot_config")
        .update({ max_total_notional_usdt: newCap, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }

    const capNote = newCap !== currentCap ? ` Cap raised ${currentCap}→${newCap} USDT.` : "";
    await botLog(
      userId,
      "info",
      `Auto-configured: ${gridLevels} levels × ${spacingPct.toFixed(2)}% spacing, ${leverage}x lev, ${orderSize} USDT/order. Range ${lowerBound}–${upperBound}. Vol ${avgRangePct.toFixed(2)}%/h, 24h trend ${trendPct.toFixed(2)}%.${capNote}`,
      symbol,
    );

    return {
      ok: true,
      analysis: {
        price,
        avgHourlyRangePct: Number(avgRangePct.toFixed(3)),
        trend24hPct: Number(trendPct.toFixed(2)),
        high7d,
        low7d,
        availableBalance: available,
      },
      config: {
        grid_levels: gridLevels,
        grid_spacing_pct: spacingPct,
        order_size_usdt: orderSize,
        leverage,
        lower_bound: lowerBound,
        upper_bound: upperBound,
      },
    };
  });

export const optimizeSymbol = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { symbol: string; days?: number }) =>
    z.object({ symbol: z.string(), days: z.number().int().min(7).max(90).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { backtestGrid } = await import("@/lib/binance/backtest.server");
    const { creds } = await loadCreds(userId);
    const symbol = data.symbol;
    const days = data.days ?? 60;

    const [klines, acct, mark] = await Promise.all([
      binance.klines(creds, symbol, "1h", Math.min(1500, days * 24)),
      binance.account(creds),
      binance.markPrice(creds, symbol),
    ]);
    if (klines.length < 24) throw new Error(`Not enough kline data for ${symbol}`);

    const closes = klines.map((k: any) => parseFloat(k[4]));
    const highs = klines.map((k: any) => parseFloat(k[2]));
    const lows = klines.map((k: any) => parseFloat(k[3]));
    const high60 = Math.max(...highs);
    const low60 = Math.min(...lows);
    const lowerBound = low60 * 0.98;
    const upperBound = high60 * 1.02;
    const available = parseFloat(acct.availableBalance) || 0;

    const spacings = [0.3, 0.5, 0.8, 1.2, 1.8, 2.5];
    const levelsArr = symbol === "BTCUSDT" ? [1, 2] : [1];
    const leverages = [2, 3, 5];

    type Trial = {
      spacingPct: number;
      gridLevels: number;
      leverage: number;
      orderSizeUsdt: number;
    } & ReturnType<typeof backtestGrid>;
    const trials: Trial[] = [];

    for (const spacingPct of spacings) {
      for (const gridLevels of levelsArr) {
        for (const leverage of leverages) {
          const totalOrders = gridLevels * 2;
          let orderSize = (available * 0.5) / totalOrders;
          orderSize = Math.max(5.5, Math.round(orderSize * 100) / 100);
          const result = backtestGrid(klines, {
            gridLevels,
            spacingPct,
            orderSizeUsdt: orderSize,
            leverage,
            lowerBound,
            upperBound,
          });
          trials.push({ spacingPct, gridLevels, leverage, orderSizeUsdt: orderSize, ...result });
        }
      }
    }

    const valid = trials.filter((t) => !t.liquidated && t.fills >= 5);
    const ranked = (valid.length ? valid : trials).sort((a, b) => b.score - a.score);
    const best = ranked[0];

    if (!hasRemoteDb()) {
      const testnet = Boolean(getLocalBotState(userId).cfg.testnet ?? true);
      const liveMinOrderUsdt = 5;
      const orderSizeUsdt = testnet
        ? Math.max(75, Math.min(150, best.orderSizeUsdt))
        : Math.max(liveMinOrderUsdt, best.orderSizeUsdt);
      updateLocalSymbol(userId, symbol, {
        enabled: true,
        grid_levels: best.gridLevels,
        grid_spacing_pct: best.spacingPct,
        order_size_usdt: orderSizeUsdt,
        min_order_size_usdt: testnet ? 50 : liveMinOrderUsdt,
        max_order_size_usdt: testnet ? 150 : Math.max(liveMinOrderUsdt, Math.ceil(orderSizeUsdt * 2)),
        leverage: best.leverage,
        lower_bound: Math.round(lowerBound * 1e6) / 1e6,
        upper_bound: Math.round(upperBound * 1e6) / 1e6,
        backtest_pnl: best.realizedPnl,
        backtest_max_drawdown: best.maxDrawdown,
        backtest_fills: best.fills,
        backtest_return_pct: best.netReturnPct,
        backtest_at: new Date().toISOString(),
      });
      updateLocalBotConfig(userId, { max_total_notional_usdt: 1500 });
      addLocalLog(
        userId,
        "info",
        `Optimized ${symbol} over ${days}d: ${best.gridLevels} level(s) x ${best.spacingPct}% x ${best.leverage}x -> backtest PnL ${best.realizedPnl} USDT, ${best.fills} fills, max DD ${best.maxDrawdown}, return ${best.netReturnPct}%`,
        symbol,
      );

      return {
        ok: true,
        best: { ...best, gridLevels: best.gridLevels, orderSizeUsdt },
        topResults: ranked.slice(0, 5).map((t) => ({
          spacingPct: t.spacingPct,
          gridLevels: t.gridLevels,
          leverage: t.leverage,
          orderSizeUsdt: Math.max(75, Math.min(150, t.orderSizeUsdt)),
          realizedPnl: t.realizedPnl,
          maxDrawdown: t.maxDrawdown,
          fills: t.fills,
          netReturnPct: t.netReturnPct,
          liquidated: t.liquidated,
        })),
        bounds: { lowerBound, upperBound },
        trialsTested: trials.length,
        validTrials: valid.length,
        daysAnalyzed: Math.round(klines.length / 24),
      };
    }

    await remoteDb
      .from("symbol_config")
      .update({
        grid_levels: best.gridLevels,
        grid_spacing_pct: best.spacingPct,
        order_size_usdt: best.orderSizeUsdt,
        min_order_size_usdt: 5,
        max_order_size_usdt: Math.max(5, Math.ceil(best.orderSizeUsdt * 2)),
        leverage: best.leverage,
        lower_bound: Math.round(lowerBound * 1e6) / 1e6,
        upper_bound: Math.round(upperBound * 1e6) / 1e6,
        backtest_pnl: best.realizedPnl,
        backtest_max_drawdown: best.maxDrawdown,
        backtest_fills: best.fills,
        backtest_return_pct: best.netReturnPct,
        backtest_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("symbol", symbol);

    const { data: botCfg } = await remoteDb
      .from("bot_config")
      .select("max_total_notional_usdt")
      .eq("user_id", userId)
      .single();
    const currentCap = Number(botCfg?.max_total_notional_usdt ?? 500);
    const planned = Math.max(5, best.orderSizeUsdt) * 2;
    if (planned > currentCap) {
      await remoteDb
        .from("bot_config")
        .update({
          max_total_notional_usdt: Math.ceil(planned),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }

    await botLog(
      userId,
      "info",
      `Optimized over ${days}d: ${best.gridLevels} level(s) x ${best.spacingPct}% x ${best.leverage}x -> backtest PnL ${best.realizedPnl} USDT, ${best.fills} fills, max DD ${best.maxDrawdown}, return ${best.netReturnPct}%`,
      symbol,
    );

    return {
      ok: true,
      best: { ...best, gridLevels: 1 },
      topResults: ranked.slice(0, 5).map((t) => ({
        spacingPct: t.spacingPct,
        gridLevels: t.gridLevels,
        leverage: t.leverage,
        orderSizeUsdt: t.orderSizeUsdt,
        realizedPnl: t.realizedPnl,
        maxDrawdown: t.maxDrawdown,
        fills: t.fills,
        netReturnPct: t.netReturnPct,
        liquidated: t.liquidated,
      })),
      bounds: { lowerBound, upperBound },
      trialsTested: trials.length,
      validTrials: valid.length,
      daysAnalyzed: Math.round(klines.length / 24),
    };
  });
