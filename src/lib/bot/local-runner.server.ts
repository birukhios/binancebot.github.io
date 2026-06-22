import { binance, getCredsForUser } from "@/lib/binance/client.server";
import { closePositionAndCancel, reconcileSymbol } from "@/lib/binance/grid.server";
import {
  addLocalLog,
  adjustTestnetRealizedToday,
  getLocalBotState,
  listLocalBotUserIds,
  PAPER_HIGH_RISK_PROFILE,
  updateLocalBotConfig,
  updateLocalSymbol,
} from "@/lib/bot/local-bot-store.server";

const LOOP_MS = Number(process.env.LOCAL_BOT_LOOP_MS ?? 15_000);
const BTC_SYMBOL = "BTCUSDT";
const BTC_MAX_ENTRY_SLOTS = 4;
const BTC_GRID_LEVELS = 2;
const BTC_LEVERAGE = 3;
const BTC_FAST_SPACING_PCT = 0.18;
const BTC_MIN_ORDER_USDT = 75;
const LOSS_STREAK_MIN_LOSS_USDT = 1;

type RunnerRegistry = Record<string, { timer: ReturnType<typeof setInterval>; running: boolean }>;

function registry(): RunnerRegistry {
  const g = globalThis as typeof globalThis & { __localBotRunners?: RunnerRegistry };
  g.__localBotRunners ??= {};
  return g.__localBotRunners;
}

function isPaperHighRisk(userId: string) {
  return getLocalBotState(userId).cfg.risk_profile === PAPER_HIGH_RISK_PROFILE;
}

function lockPaperProfile(userId: string, reason: string) {
  updateLocalBotConfig(userId, {
    is_running: false,
    paper_kill_switch_triggered_at: new Date().toISOString(),
    paper_kill_switch_reason: reason,
  });
  addLocalLog(userId, "error", `Paper high-risk profile locked: ${reason}`);
  stopLocalBotRunner(userId);
}

function botDayStartMs(now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 0, 0, 0);
  return now.getTime() >= start ? start : start - 24 * 60 * 60 * 1000;
}

function nextBotDayStartIso(now = new Date()) {
  return new Date(botDayStartMs(now) + 24 * 60 * 60 * 1000).toISOString();
}

function entryPauseUntilMs(value: unknown) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : 0;
}

async function dailyPnl(
  userId: string,
  creds: Awaited<ReturnType<typeof getCredsForUser>>,
  openPositions: any[],
) {
  const startTime = botDayStartMs();
  const income = await binance.income(creds, { startTime, limit: 1000 }).catch(() => [] as any[]);
  const realized = income.reduce((sum: number, row: any) => {
    const type = String(row.incomeType ?? "");
    if (!["REALIZED_PNL", "COMMISSION", "FUNDING_FEE"].includes(type)) return sum;
    return sum + Number(row.income ?? 0);
  }, 0);
  const adjustedRealized = adjustTestnetRealizedToday(userId, realized);
  const unrealized = openPositions.reduce((sum: number, p: any) => {
    if (Number(p.positionAmt) === 0) return sum;
    return sum + Number(p.unRealizedProfit ?? p.unrealizedProfit ?? 0);
  }, 0);
  const realizedLosses = income
    .filter((row: any) => String(row.incomeType ?? "") === "REALIZED_PNL")
    .sort((a: any, b: any) => Number(b.time ?? 0) - Number(a.time ?? 0));
  let consecutiveLosses = 0;
  for (const row of realizedLosses) {
    const value = Number(row.income ?? 0);
    if (value <= -LOSS_STREAK_MIN_LOSS_USDT) consecutiveLosses++;
    else if (value > 0) break;
  }
  return { realized: adjustedRealized, unrealized, total: adjustedRealized + unrealized, consecutiveLosses };
}

export async function runLocalBotTick(userId: string) {
  let state = getLocalBotState(userId);
  if (!state.cfg.is_running) return { ok: true, skipped: "stopped" };
  const testnet = Boolean(state.cfg.testnet ?? true);
  const creds = await getCredsForUser(userId, testnet);
  const account = await binance.account(creds);
  const walletBalance = Math.max(
    0,
    Number(account.availableBalance ?? account.totalWalletBalance ?? 0),
  );
  const totalEquity = walletBalance + Number(account.totalUnrealizedProfit ?? 0);
  const botCapitalPct = testnet
    ? Math.max(20, Math.min(40, Number(state.cfg.bot_capital_pct ?? 30)))
    : 100;
  const botCapital = walletBalance * (botCapitalPct / 100);
  const configuredCap = Number(state.cfg.max_total_notional_usdt ?? 0);
  const effectiveCapital = testnet
    ? configuredCap > 0
      ? Math.min(configuredCap, botCapital)
      : botCapital
    : botCapital;
  updateLocalBotConfig(userId, { max_total_notional_usdt: effectiveCapital });
  const paperHighRisk = state.cfg.risk_profile === PAPER_HIGH_RISK_PROFILE;
  if (paperHighRisk) {
    const startEquity = Number(state.cfg.paper_start_equity_usdt ?? 0);
    const peakEquity = Number(state.cfg.paper_peak_equity_usdt ?? 0);
    const nextStart = startEquity > 0 ? startEquity : totalEquity;
    const nextPeak = Math.max(peakEquity > 0 ? peakEquity : totalEquity, totalEquity);
    updateLocalBotConfig(userId, {
      paper_start_equity_usdt: nextStart,
      paper_peak_equity_usdt: nextPeak,
      paper_api_failure_count: 0,
    });
    const drawdownLimit = Math.max(0.1, Number(state.cfg.drawdown_pause_pct ?? 2));
    if (nextPeak > 0) {
      const drawdownPct = ((nextPeak - totalEquity) / nextPeak) * 100;
      if (drawdownPct >= drawdownLimit) {
        const positionsToClose = await binance.positionRisk(creds).catch(() => [] as any[]);
        for (const p of positionsToClose) {
          if (Number(p.positionAmt) === 0) continue;
          try {
            await closePositionAndCancel(userId, creds, String(p.symbol));
          } catch {
            // Best-effort flattening on kill switch.
          }
        }
        lockPaperProfile(
          userId,
          `max drawdown reached: equity ${totalEquity.toFixed(2)} USDT, peak ${nextPeak.toFixed(2)} USDT, drawdown ${drawdownPct.toFixed(2)}%`,
        );
        return { ok: false, error: "paper drawdown kill switch", processed: 0, errors: 0 };
      }
    }
  }
  const openPositions = await binance.positionRisk(creds).catch(() => [] as any[]);
  const rawActiveOpenPositions = openPositions.filter((p: any) => Number(p.positionAmt) !== 0);
  for (const p of rawActiveOpenPositions.filter((pos: any) => String(pos.symbol) !== BTC_SYMBOL)) {
    const symbol = String(p.symbol);
    try {
      const closed = await closePositionAndCancel(userId, creds, symbol);
      addLocalLog(
        userId,
        closed ? "warn" : "error",
        closed
          ? "BTC-only guard closed non-BTC position and canceled its orders."
          : "BTC-only guard tried to close this non-BTC position, but a residual remains.",
        symbol,
      );
    } catch (error) {
      addLocalLog(
        userId,
        "error",
        `BTC-only guard close failed: ${(error as Error).message}`,
        symbol,
      );
    }
  }
  const activeOpenPositions = rawActiveOpenPositions.filter(
    (p: any) => String(p.symbol) === BTC_SYMBOL,
  );
  const openPositionSymbols = new Set(activeOpenPositions.map((p: any) => String(p.symbol)));
  const pnl = await dailyPnl(userId, creds, activeOpenPositions);
  const dailyTarget =
    effectiveCapital * (Math.max(0, Number(state.cfg.daily_profit_target_pct ?? 2)) / 100);
  const dailyLossLimit =
    effectiveCapital * (Math.max(0.1, Number(state.cfg.daily_loss_limit_pct ?? 1)) / 100);
  const maxOpenTrades = paperHighRisk
    ? 2
    : Math.max(
        1,
        Math.min(
          BTC_MAX_ENTRY_SLOTS,
          Math.floor(Number(state.cfg.max_open_trades ?? BTC_MAX_ENTRY_SLOTS)),
        ),
      );
  const lossPauseCount = Math.max(
    1,
    Math.floor(Number(state.cfg.consecutive_loss_pause_count ?? 3)),
  );
  const liveMinOrderUsdt = 5;
  const minOrderFloor = testnet ? BTC_MIN_ORDER_USDT : liveMinOrderUsdt;
  const btcOrderSize = paperHighRisk
    ? Math.max(BTC_MIN_ORDER_USDT, effectiveCapital / 2)
    : Math.max(minOrderFloor, effectiveCapital / maxOpenTrades);
  const btcCfg = state.symbols.find((s) => s.symbol === BTC_SYMBOL);
  updateLocalSymbol(userId, BTC_SYMBOL, {
    enabled: true,
    grid_levels: paperHighRisk ? 3 : testnet ? BTC_GRID_LEVELS : 1,
    single_grid_order: !paperHighRisk && !testnet,
    order_size_usdt: btcOrderSize,
    min_order_size_usdt: minOrderFloor,
    max_order_size_usdt: Math.max(minOrderFloor, btcOrderSize * 2),
    grid_spacing_pct: paperHighRisk ? 0.25 : testnet ? BTC_FAST_SPACING_PCT : 0.5,
    leverage: paperHighRisk ? 8 : testnet ? BTC_LEVERAGE : 2,
    stop_loss_roi_pct: Number(btcCfg?.stop_loss_roi_pct ?? (paperHighRisk ? -6 : testnet ? -8 : -6)),
    trend_filter_enabled: Boolean(btcCfg?.trend_filter_enabled ?? true),
    funding_filter_enabled: Boolean(btcCfg?.funding_filter_enabled ?? true),
    funding_max_abs_bps: Number(btcCfg?.funding_max_abs_bps ?? (paperHighRisk ? 10 : testnet ? 10 : 8)),
    z_filter_enabled: Boolean(btcCfg?.z_filter_enabled ?? !testnet),
    z_entry_threshold: Number(btcCfg?.z_entry_threshold ?? (paperHighRisk ? 1.25 : testnet ? 1.0 : 1.4)),
  });

  const pauseUntilMs = entryPauseUntilMs(state.cfg.entry_pause_until_iso);
  const entryPauseActive = pauseUntilMs > Date.now();
  if (!entryPauseActive && state.cfg.entry_pause_until_iso) {
    updateLocalBotConfig(userId, {
      entry_pause_until_iso: null,
      entry_pause_reason: null,
    });
  }

  if (effectiveCapital <= 0) {
    addLocalLog(
      userId,
      "error",
      "Risk gate: wallet balance is zero or unreadable; new entries paused.",
    );
  }
  if (!testnet && effectiveCapital > 0 && effectiveCapital < liveMinOrderUsdt) {
    addLocalLog(
      userId,
      "warn",
      `Live wallet/available balance is ${walletBalance.toFixed(4)} USDT, below the Binance minimum notional (~${liveMinOrderUsdt} USDT). The bot will keep managing exits, but new entries are paused until you add more funds.`,
      BTC_SYMBOL,
      { dedupeKey: "live-wallet-too-small", dedupeWindowMs: 10 * 60 * 1000 },
    );
  }

  if (dailyLossLimit > 0 && pnl.total <= -dailyLossLimit) {
    if (paperHighRisk) {
      updateLocalBotConfig(userId, { is_running: false });
      addLocalLog(
        userId,
        "error",
        `Daily loss stop hit: PnL ${pnl.total.toFixed(2)} <= -${dailyLossLimit.toFixed(2)} USDT (${Number(state.cfg.daily_loss_limit_pct ?? 1)}% of bot capital). Stopping bot and closing open positions.`,
      );
      for (const p of activeOpenPositions) {
        try {
          await closePositionAndCancel(userId, creds, String(p.symbol));
        } catch (error) {
          addLocalLog(
            userId,
            "error",
            `Daily-loss close failed: ${(error as Error).message}`,
            String(p.symbol),
          );
        }
      }
      lockPaperProfile(
        userId,
        `daily loss stop: PnL ${pnl.total.toFixed(2)} USDT, limit -${dailyLossLimit.toFixed(2)} USDT`,
      );
      return { ok: false, error: "daily loss stop", processed: 0, errors: 0 };
    }

    updateLocalBotConfig(userId, {
      entry_pause_until_iso: nextBotDayStartIso(),
      entry_pause_reason: `daily loss stop: PnL ${pnl.total.toFixed(2)} USDT, limit -${dailyLossLimit.toFixed(2)} USDT`,
    });
    addLocalLog(
      userId,
      "warn",
      `Daily loss gate hit: PnL ${pnl.total.toFixed(2)} <= -${dailyLossLimit.toFixed(2)} USDT. New entries paused until the next bot day (${nextBotDayStartIso()} UTC); exits will keep running.`,
      BTC_SYMBOL,
      { dedupeKey: "live-daily-loss-pause", dedupeWindowMs: 60 * 60 * 1000 },
    );
    return { ok: true, paused: "daily loss gate", processed: 0, errors: 0 };
  }

  if (pnl.total < 0 && pnl.consecutiveLosses >= lossPauseCount) {
    if (paperHighRisk) {
      updateLocalBotConfig(userId, { is_running: false });
      addLocalLog(
        userId,
        "error",
        `Loss-streak pause: ${pnl.consecutiveLosses} realized losses of at least ${LOSS_STREAK_MIN_LOSS_USDT.toFixed(2)} USDT in a row while daily PnL is ${pnl.total.toFixed(2)}. Bot stopped before opening more trades.`,
      );
      lockPaperProfile(
        userId,
        `loss streak pause: ${pnl.consecutiveLosses} losses in a row while daily PnL is ${pnl.total.toFixed(2)} USDT`,
      );
      return { ok: false, error: "loss streak pause", processed: 0, errors: 0 };
    }

    updateLocalBotConfig(userId, {
      entry_pause_until_iso: nextBotDayStartIso(),
      entry_pause_reason: `loss streak pause: ${pnl.consecutiveLosses} losses in a row while daily PnL is ${pnl.total.toFixed(2)} USDT`,
    });
    addLocalLog(
      userId,
      "warn",
      `Loss streak gate hit: ${pnl.consecutiveLosses} realized losses in a row today. New entries paused until the next bot day (${nextBotDayStartIso()} UTC); exits will keep running.`,
      BTC_SYMBOL,
      { dedupeKey: "live-loss-streak-pause", dedupeWindowMs: 60 * 60 * 1000 },
    );
    return { ok: true, paused: "loss streak gate", processed: 0, errors: 0 };
  }

  const entriesBlocked =
    activeOpenPositions.length >= maxOpenTrades ||
    effectiveCapital <= 0 ||
    (!testnet && effectiveCapital < liveMinOrderUsdt) ||
    entryPauseActive;

  for (const symbol of openPositionSymbols) {
    if (!state.symbols.some((s) => s.symbol === symbol)) {
      updateLocalSymbol(userId, symbol, { enabled: false });
      addLocalLog(
        userId,
        "info",
        "Discovered an existing open position on Binance and added it to local management so the bot can attach exits.",
        symbol,
      );
    }
  }
  state = getLocalBotState(userId);
  const managed = state.symbols.filter(
    (s) => s.symbol === BTC_SYMBOL && (s.enabled || openPositionSymbols.has(s.symbol)),
  );

  if (managed.length === 0) {
    addLocalLog(userId, "warn", "No enabled symbols or open positions to manage.");
    return { ok: true, processed: 0 };
  }

  let processed = 0;
  let errors = 0;

  for (const symbolCfg of state.symbols.filter(
    (s) => !managed.some((m) => m.symbol === s.symbol),
  )) {
    try {
      const open = await binance.openOrders(creds, symbolCfg.symbol).catch(() => [] as any[]);
      const gridOrders = open.filter((o: any) =>
        String(o.clientOrderId ?? "").startsWith(`grid_${symbolCfg.symbol}_`),
      );
      if (gridOrders.length > 0) {
        await binance.cancelAllOrders(creds, symbolCfg.symbol);
        addLocalLog(
          userId,
          "info",
          `Canceled ${gridOrders.length} stale grid order(s) on inactive symbol`,
          symbolCfg.symbol,
        );
      }
    } catch (error) {
      addLocalLog(
        userId,
        "warn",
        `Inactive-symbol cleanup failed: ${(error as Error).message}`,
        symbolCfg.symbol,
      );
    }
  }

  for (const symbolCfg of managed) {
    try {
      if (!symbolCfg.enabled && openPositionSymbols.has(symbolCfg.symbol)) {
        addLocalLog(
          userId,
          "info",
          "Managing close strategy for an open position on a symbol that is not currently enabled.",
          symbolCfg.symbol,
        );
      }
      const open = await binance.openOrders(creds, symbolCfg.symbol).catch(() => [] as any[]);
      const gridOrders = open.filter((o: any) =>
        String(o.clientOrderId ?? "").startsWith(`grid_${symbolCfg.symbol}_`),
      );
      const configuredGridLevels = Math.max(1, Math.floor(Number(symbolCfg.grid_levels ?? 1)));
      const expectedEntryOrders = symbolCfg.single_grid_order ? 1 : configuredGridLevels * 2;
      // Allow one extra resting reduce-only take-profit when a position is open.
      const maxAllowedGridOrders = expectedEntryOrders + 1;
      if (gridOrders.length > maxAllowedGridOrders) {
        await binance.cancelAllOrders(creds, symbolCfg.symbol);
        addLocalLog(
          userId,
          "info",
          `Canceled ${gridOrders.length} extra grid order(s) before recreating the ${maxAllowedGridOrders}-slot grid`,
          symbolCfg.symbol,
        );
      }
      await reconcileSymbol(
        {
          ...symbolCfg,
          grid_levels: BTC_GRID_LEVELS,
          single_grid_order: false,
          user_id: userId,
        } as any,
        {
          entriesBlocked,
        },
      );
      processed++;
    } catch (error) {
      errors++;
      addLocalLog(userId, "error", (error as Error).message, symbolCfg.symbol);
    }
  }

  return { ok: errors === 0, processed, errors };
}

export function ensureLocalBotRunner(userId: string) {
  const runners = registry();
  if (runners[userId]) return;

  const tickSoon = () => {
    const entry = runners[userId];
    if (!entry || entry.running) return;
    entry.running = true;
    runLocalBotTick(userId)
      .then(() => {
        if (isPaperHighRisk(userId)) {
          const state = getLocalBotState(userId);
          if (Number(state.cfg.paper_api_failure_count ?? 0) !== 0) {
            updateLocalBotConfig(userId, { paper_api_failure_count: 0 });
          }
        }
      })
      .catch((error) => {
        if (isPaperHighRisk(userId)) {
          const state = getLocalBotState(userId);
          const failures = Number(state.cfg.paper_api_failure_count ?? 0) + 1;
          updateLocalBotConfig(userId, { paper_api_failure_count: failures });
          if (failures >= 3) {
            lockPaperProfile(
              userId,
              `API/data failures repeated ${failures} times in a row: ${(error as Error).message}`,
            );
            return;
          }
        }
        addLocalLog(userId, "error", `Local runner tick failed: ${(error as Error).message}`);
      })
      .finally(() => {
        const current = runners[userId];
        if (current) current.running = false;
      });
  };

  runners[userId] = {
    running: false,
    timer: setInterval(() => {
      tickSoon();
    }, LOOP_MS),
  };

  setTimeout(tickSoon, 250);
}

export function stopLocalBotRunner(userId: string) {
  const runners = registry();
  const entry = runners[userId];
  if (!entry) return;
  clearInterval(entry.timer);
  delete runners[userId];
}

export function bootstrapLocalBotRunners() {
  for (const userId of listLocalBotUserIds()) {
    const state = getLocalBotState(userId);
    if (state.cfg.is_running) ensureLocalBotRunner(userId);
  }
}

setTimeout(() => {
  bootstrapLocalBotRunners();
}, 500);
