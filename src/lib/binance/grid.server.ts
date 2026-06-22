// Per-symbol grid reconciliation: ensure N buy levels below mark and N sell levels above.
import {
  binance,
  getCredsForUser,
  getSymbolFilters,
  isBinanceNetworkBlock,
  roundStep,
  type BinanceCreds,
} from "./client.server";
import { botLog } from "@/lib/bot/log.server";
import { getLocalBotState } from "@/lib/bot/local-bot-store.server";
// (advisor removed — see commit notes)

function localDbResult(data: unknown = null) {
  return Promise.resolve({ data, error: null });
}

const remoteDb = {
  from() {
    const builder: any = {
      select: () => builder,
      update: () => builder,
      delete: () => builder,
      insert: () => localDbResult(),
      upsert: () => localDbResult(),
      eq: () => builder,
      in: () => builder,
      lt: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => localDbResult(null),
      single: () => localDbResult(null),
      then: (resolve: (value: { data: null; error: null }) => unknown) =>
        localDbResult(null).then(resolve),
    };
    return builder;
  },
};

// Liquidation guard thresholds (% distance from mark to liquidation price)
const LIQUIDATION_HARD_PCT = 5;
const LIQUIDATION_SOFT_PCT = 10;
const DEFAULT_STOP_LOSS_ROI_PCT = -15;
const DUST_POSITION_NOTIONAL_USDT = 25;
const TAKE_PROFIT_SPACING_MULT = 0.20;
const TAKE_PROFIT_FEE_BUFFER_PCT = 0.015;
const GRID_ORDER_MIN_LIFETIME_MS = 90_000;
const GRID_REPRICE_TOLERANCE_MULT = 0.35;
const FRONT_LEVEL_SPACING_MULT = 0.25;

interface SymbolCfg {
  user_id: string;
  symbol: string;
  enabled: boolean;
  grid_levels: number;
  grid_spacing_pct: number;
  order_size_usdt: number;
  min_order_size_usdt?: number | null;
  max_order_size_usdt?: number | null;
  leverage: number;
  upper_bound: number | null;
  lower_bound: number | null;
  stop_loss_roi_pct?: number | null;
  max_position_age_minutes?: number | null;
  trend_filter_enabled?: boolean | null;
  trend_ema_period?: number | null;
  trend_interval?: string | null;
  extreme_loss_threshold_usdt?: number | null;
  extreme_loss_cooldown_min?: number | null;
  funding_filter_enabled?: boolean | null;
  funding_max_abs_bps?: number | null;
  z_filter_enabled?: boolean | null;
  z_lookback?: number | null;
  z_interval?: string | null;
  z_entry_threshold?: number | null;
  single_grid_order?: boolean | null;
}

function closeTargetPrice(
  entryPrice: number,
  positionAmt: number,
  spacingPct: number,
  feePctBuffer: number,
) {
  const netPct = Math.max(spacingPct + feePctBuffer, feePctBuffer);
  return positionAmt > 0 ? entryPrice * (1 + netPct / 100) : entryPrice * (1 - netPct / 100);
}

function stopLossTargetPrice(
  entryPrice: number,
  positionAmt: number,
  stopLossRoiPct: number,
  leverage: number,
) {
  const lossPct = Math.max(0, Math.abs(stopLossRoiPct)) / Math.max(leverage, 1);
  return positionAmt > 0 ? entryPrice * (1 - lossPct / 100) : entryPrice * (1 + lossPct / 100);
}

function effectiveStopLossRoi(stopLossRoiPct: number | null | undefined) {
  const value = Number(stopLossRoiPct ?? DEFAULT_STOP_LOSS_ROI_PCT);
  return value < 0 ? value : DEFAULT_STOP_LOSS_ROI_PCT;
}

function effectiveTakeProfitSpacingPct(gridSpacingPct: number) {
  return Math.max(0.1, Number(gridSpacingPct || 0) * TAKE_PROFIT_SPACING_MULT);
}

function gridRepriceTolerancePct(gridSpacingPct: number) {
  return Math.max(0.05, Number(gridSpacingPct || 0) * GRID_REPRICE_TOLERANCE_MULT);
}

function levelSpacingMultiplier(level: number) {
  return level === 1 ? FRONT_LEVEL_SPACING_MULT : level;
}

function roundStepUp(value: number, step: number, precision: number): number {
  const rounded = Math.ceil(value / step) * step;
  return parseFloat(rounded.toFixed(precision));
}

function makerSafeLimitPrice(
  side: "BUY" | "SELL",
  desiredPrice: number,
  bidPrice: number | null,
  askPrice: number | null,
  tickSize: number,
  pricePrecision: number,
) {
  const minTick = Math.max(tickSize, 0);
  const safePrice =
    side === "BUY"
      ? askPrice && askPrice > 0
        ? Math.min(desiredPrice, askPrice - minTick)
        : desiredPrice
      : bidPrice && bidPrice > 0
        ? Math.max(desiredPrice, bidPrice + minTick)
        : desiredPrice;
  return roundStep(Math.max(minTick, safePrice), tickSize, pricePrecision);
}

// EMA of the last N closes. Returns null if not enough data.
function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/**
 * Returns the active global market session based on current UTC time.
 * Sessions overlap; the most "active" one wins.
 *  - ny_london_overlap: 13:00–16:00 UTC (highest volatility, tightest gate)
 *  - us:               13:30–21:00 UTC (US cash open through close)
 *  - london:           07:00–16:00 UTC
 *  - asia:             00:00–08:00 UTC (Tokyo/HK/Singapore)
 *  - off:              everything else (low liquidity, widest gate)
 *
 * `flatThresholdPct` controls how close to EMA counts as "chop" (no bias).
 * Smaller = stricter trend respect; larger = more counter-trend entries allowed.
 */
export function getMarketSession(now: Date = new Date()): {
  name: "ny_london_overlap" | "us" | "london" | "asia" | "off";
  flatThresholdPct: number;
} {
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const t = h + m / 60;
  if (t >= 13 && t < 16) return { name: "ny_london_overlap", flatThresholdPct: 0.05 };
  if (t >= 13.5 && t < 21) return { name: "us", flatThresholdPct: 0.08 };
  if (t >= 7 && t < 16) return { name: "london", flatThresholdPct: 0.1 };
  if (t >= 0 && t < 8) return { name: "asia", flatThresholdPct: 0.15 };
  return { name: "off", flatThresholdPct: 0.25 };
}

/**
 * Returns 'up' | 'down' | 'flat' based on mark vs EMA on the configured TF.
 * `flatThresholdPct` is supplied by the caller (session-aware).
 * Returns null on error so caller can fall back to "allow both".
 */
export async function getTrendBias(
  creds: BinanceCreds,
  symbol: string,
  interval: string,
  period: number,
  mark: number,
  flatThresholdPct: number = 0.1,
): Promise<"up" | "down" | "flat" | null> {
  try {
    const limit = Math.min(500, Math.max(period + 5, 60));
    const kl = await binance.klines(creds, symbol, interval, limit);
    const closes = kl.map((k: any) => parseFloat(k[4]));
    const e = ema(closes, period);
    if (e === null || !isFinite(e) || e <= 0) return null;
    const distPct = ((mark - e) / e) * 100;
    if (Math.abs(distPct) < flatThresholdPct) return "flat";
    return distPct > 0 ? "up" : "down";
  } catch {
    return null;
  }
}

/**
 * ATR% (average true range as % of price) over the last `period` candles
 * on `interval`. Used to scale grid spacing with realized volatility.
 * Returns null on error.
 */
export async function getAtrPct(
  creds: BinanceCreds,
  symbol: string,
  interval: string,
  period: number,
): Promise<number | null> {
  try {
    const kl = await binance.klines(creds, symbol, interval, period + 5);
    if (!Array.isArray(kl) || kl.length < period + 1) return null;
    const trs: number[] = [];
    for (let i = 1; i < kl.length; i++) {
      const h = parseFloat(kl[i][2]);
      const l = parseFloat(kl[i][3]);
      const pc = parseFloat(kl[i - 1][4]);
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const slice = trs.slice(-period);
    const atr = slice.reduce((s, v) => s + v, 0) / slice.length;
    const lastClose = parseFloat(kl[kl.length - 1][4]);
    if (!lastClose || !isFinite(atr)) return null;
    return (atr / lastClose) * 100;
  } catch {
    return null;
  }
}

/**
 * Z-score of the current price vs the rolling mean/stddev of the last `lookback`
 * closes on `interval`. Returns null on error or degenerate stddev.
 * z > 0 → overbought (price above mean), z < 0 → oversold.
 */
export async function getPriceZScore(
  creds: BinanceCreds,
  symbol: string,
  interval: string,
  lookback: number,
  currentPrice: number,
): Promise<number | null> {
  try {
    const kl = await binance.klines(creds, symbol, interval, lookback + 1);
    if (!Array.isArray(kl) || kl.length < lookback) return null;
    const closes = kl.slice(-lookback).map((c) => parseFloat(c[4]));
    const mean = closes.reduce((s, v) => s + v, 0) / closes.length;
    const variance = closes.reduce((s, v) => s + (v - mean) ** 2, 0) / closes.length;
    const std = Math.sqrt(variance);
    if (!isFinite(std) || std <= 0) return null;
    return (currentPrice - mean) / std;
  } catch {
    return null;
  }
}

/** Session-based spacing multiplier (tighter during high-vol overlaps). */
function sessionSpacingMult(name: string): number {
  switch (name) {
    case "ny_london_overlap":
      return 0.85;
    case "us":
      return 0.95;
    case "london":
      return 1.0;
    case "asia":
      return 1.15;
    default:
      return 1.3; // off-hours
  }
}

export async function closePositionAndCancel(
  userId: string,
  creds: BinanceCreds,
  symbol: string,
): Promise<boolean> {
  try {
    await binance.cancelAllOrders(creds, symbol);
    await remoteDb
      .from("grid_orders")
      .update({ status: "CANCELED" })
      .eq("user_id", userId)
      .eq("symbol", symbol)
      .in("status", ["NEW", "PARTIALLY_FILLED"]);
  } catch (e) {
    await botLog(userId, "warn", `cancelAll: ${(e as Error).message}`, symbol);
  }

  try {
    const openAlgo = await binance.openAlgoOrders(creds, symbol);
    for (const order of openAlgo) {
      const clientAlgoId = String(order.clientAlgoId ?? "");
      if (!clientAlgoId) continue;
      try {
        await binance.cancelAlgoOrder(creds, clientAlgoId);
      } catch (e) {
        await botLog(
          userId,
          "warn",
          `cancel protective ${clientAlgoId}: ${(e as Error).message}`,
          symbol,
        );
      }
    }
  } catch (e) {
    await botLog(userId, "warn", `cancelAlgo: ${(e as Error).message}`, symbol);
  }

  const f = await getSymbolFilters(creds, symbol);
  let submitted = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const positions = await binance.positionRisk(creds, symbol);
    const pos = positions.find((p: any) => p.symbol === symbol && Number(p.positionAmt) !== 0);
    if (!pos) return submitted;
    const positionAmt = Number(pos.positionAmt);
    const closeQty = roundStep(Math.abs(positionAmt), f.stepSize, f.quantityPrecision);
    if (closeQty <= 0) return submitted;
    if (closeQty < f.minQty) {
      await botLog(
        userId,
        "warn",
        `Close residual qty ${closeQty} < minQty ${f.minQty}; attempting reduce-only dust close.`,
        symbol,
      );
    }
    await binance.placeOrder(creds, {
      symbol,
      side: positionAmt > 0 ? "SELL" : "BUY",
      type: "MARKET",
      quantity: closeQty,
      reduceOnly: true,
      newClientOrderId: `cls${symbol.slice(0, 8)}${Date.now().toString().slice(-10)}${attempt}`,
    });
    submitted = true;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  const remaining = await binance.positionRisk(creds, symbol);
  const stillOpen = remaining.find((p: any) => p.symbol === symbol && Number(p.positionAmt) !== 0);
  if (stillOpen) {
    await botLog(
      userId,
      "error",
      `Close residual remains after retries: ${stillOpen.positionAmt}.`,
      symbol,
    );
    return false;
  }
  return submitted;
}

export async function maybeTakeProfit(
  userId: string,
  creds: BinanceCreds,
  cfg: SymbolCfg,
): Promise<boolean> {
  const positions = await binance.positionRisk(creds, cfg.symbol);
  const pos = positions.find((p: any) => p.symbol === cfg.symbol && Number(p.positionAmt) !== 0);
  if (!pos) return false;

  const positionAmt = Number(pos.positionAmt);
  const entryPrice = Number(pos.entryPrice);
  const markPrice = Number(pos.markPrice) || entryPrice;
  const unrealized = Number(pos.unRealizedProfit ?? pos.unrealizedProfit ?? 0);
  const notional = Math.abs(positionAmt * entryPrice);
  if (notional <= 0) return false;

  // Round-trip taker fee buffer (~0.08%). Don't close until profit exceeds
  // both grid spacing AND fees, otherwise the market close eats the gain.
  const tpSpacingPct = effectiveTakeProfitSpacingPct(cfg.grid_spacing_pct);
  const feeBufferUsdt = (notional * TAKE_PROFIT_FEE_BUFFER_PCT) / 100;
  const targetUsdt = notional * (tpSpacingPct / 100) + feeBufferUsdt;
  if (unrealized < targetUsdt) return false;

  // If the grid already has an opposite-side LIMIT order near the TP price,
  // let IT close the position as a maker fill (much lower fee, often a rebate)
  // and skip the market close entirely.
  try {
    const openOrders = await binance.openOrders(creds, cfg.symbol);
    const exitSide = positionAmt > 0 ? "SELL" : "BUY";
      const tpPrice =
      positionAmt > 0
        ? entryPrice * (1 + tpSpacingPct / 100)
        : entryPrice * (1 - tpSpacingPct / 100);
    const tolerancePct = tpSpacingPct * 1.5;
    const makerExit = openOrders.find((o: any) => {
      if (o.side !== exitSide) return false;
      const px = Number(o.price);
      if (px <= 0) return false;
      const nearTp = (Math.abs(px - tpPrice) / tpPrice) * 100 <= tolerancePct;
      const nearMark = (Math.abs(px - markPrice) / markPrice) * 100 <= cfg.grid_spacing_pct * 2;
      return nearTp && nearMark;
    });
    if (makerExit) {
      await botLog(
        userId,
        "info",
        `TP reached (uPnL ${unrealized.toFixed(4)} >= ${targetUsdt.toFixed(4)}). Letting maker grid ${exitSide}@${makerExit.price} close it — skipping market close to save commission.`,
        cfg.symbol,
      );
      return false;
    }
  } catch (e) {
    await botLog(userId, "warn", `TP maker check: ${(e as Error).message}`, cfg.symbol);
  }

  await botLog(
    userId,
    "info",
    `Take-profit market close: uPnL ${unrealized.toFixed(4)} >= ${targetUsdt.toFixed(4)} (no maker exit in book).`,
    cfg.symbol,
  );

  try {
    await binance.cancelAllOrders(creds, cfg.symbol);
    await remoteDb
      .from("grid_orders")
      .update({ status: "CANCELED" })
      .eq("user_id", userId)
      .eq("symbol", cfg.symbol)
      .in("status", ["NEW", "PARTIALLY_FILLED"]);
  } catch (e) {
    await botLog(userId, "warn", `cancelAll on TP: ${(e as Error).message}`, cfg.symbol);
  }

  const f = await getSymbolFilters(creds, cfg.symbol);
  const closeQty = roundStep(Math.abs(positionAmt), f.stepSize, f.quantityPrecision);
  if (closeQty < f.minQty) {
    await botLog(userId, "warn", `TP close qty ${closeQty} < minQty ${f.minQty}`, cfg.symbol);
    return false;
  }
  await binance.placeOrder(creds, {
    symbol: cfg.symbol,
    side: positionAmt > 0 ? "SELL" : "BUY",
    type: "MARKET",
    quantity: closeQty,
    reduceOnly: true,
    newClientOrderId: `tp_${cfg.symbol}_${Date.now()}`,
  });
  return true;
}

export async function maybeStopLoss(
  userId: string,
  creds: BinanceCreds,
  cfg: SymbolCfg,
): Promise<boolean> {
  const stopRoi = effectiveStopLossRoi(cfg.stop_loss_roi_pct);
  const maxAgeMin = Number(cfg.max_position_age_minutes ?? 0);

  const positions = await binance.positionRisk(creds, cfg.symbol);
  const pos = positions.find((p: any) => p.symbol === cfg.symbol && Number(p.positionAmt) !== 0);
  if (!pos) return false;

  const positionAmt = Number(pos.positionAmt);
  const entryPrice = Number(pos.entryPrice);
  const upnl = Number(pos.unRealizedProfit ?? pos.unrealizedProfit ?? 0);
  const notional = Math.abs(positionAmt * entryPrice);
  const leverage = Number(pos.leverage) || cfg.leverage || 1;
  const initialMargin = leverage > 0 ? notional / leverage : 0;
  const roiPct = initialMargin > 0 ? (upnl / initialMargin) * 100 : 0;

  let reason: string | null = null;
  if (stopRoi < 0 && roiPct <= stopRoi) {
    reason = `Stop-loss: ROI ${roiPct.toFixed(2)}% <= ${stopRoi}% (uPnL ${upnl.toFixed(4)} USDT).`;
  } else if (maxAgeMin > 0) {
    const { data: lastFill } = await remoteDb
      .from("trades")
      .select("filled_at")
      .eq("user_id", userId)
      .eq("symbol", cfg.symbol)
      .order("filled_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastFill?.filled_at) {
      const ageMin = (Date.now() - new Date(lastFill.filled_at).getTime()) / 60000;
      if (ageMin >= maxAgeMin) {
        reason = `Max age: position open ~${ageMin.toFixed(0)}min >= ${maxAgeMin}min (ROI ${roiPct.toFixed(2)}%).`;
      }
    }
  }
  if (!reason) return false;

  await botLog(userId, "warn", `${reason} Closing position.`, cfg.symbol);
  try {
    await closePositionAndCancel(userId, creds, cfg.symbol);
  } catch (e) {
    await botLog(userId, "error", `stop-loss close: ${(e as Error).message}`, cfg.symbol);
    return false;
  }
  return true;
}

export async function syncFillsForSymbol(userId: string, creds: BinanceCreds, symbol: string) {
  const { data: last } = await remoteDb
    .from("trades")
    .select("binance_trade_id")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .order("binance_trade_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fromId = last?.binance_trade_id ? Number(last.binance_trade_id) + 1 : undefined;
  const fills = await binance.userTrades(creds, symbol, fromId, 100);
  for (const t of fills) {
    await remoteDb.from("trades").upsert(
      {
        user_id: userId,
        symbol,
        side: t.side,
        price: Number(t.price),
        qty: Number(t.qty),
        realized_pnl: Number(t.realizedPnl ?? 0),
        commission: Number(t.commission ?? 0),
        binance_order_id: t.orderId,
        binance_trade_id: t.id,
        filled_at: new Date(t.time).toISOString(),
      },
      { onConflict: "binance_trade_id" },
    );
  }
  return fills.length;
}

async function getGlobalExposure(creds: BinanceCreds) {
  const [positions, openOrders] = await Promise.all([
    binance.positionRisk(creds),
    binance.openOrders(creds).catch((e) => {
      if (creds.testnet && isBinanceNetworkBlock(e)) return [];
      throw e;
    }),
  ]);

  const posNotional = positions.reduce((sum: number, p: any) => {
    const amt = Number(p.positionAmt);
    const mp = Number(p.markPrice ?? p.entryPrice ?? 0);
    return sum + Math.abs(amt * mp);
  }, 0);

  const orderNotional = openOrders.reduce((sum: number, o: any) => {
    return sum + Number(o.origQty) * Number(o.price);
  }, 0);

  return posNotional + orderNotional;
}

// Guardrails for auto-eviction.
const EVICT_MIN_AGE_MIN = 10; // never close a position younger than this
const EVICT_MAX_ROI_PCT = 0; // never close a position with ROI above this

/**
 * If global exposure exceeds the user's cap, close the single "worst" open
 * position to free room. Score = age_minutes + max(0, -roi_pct) * 10, so
 * older + more-losing positions go first; winners and fresh entries are
 * protected. Closes at most one position per tick.
 */
export async function evictWorstPositionIfOverCap(
  userId: string,
  creds: BinanceCreds,
  maxNotional: number,
): Promise<boolean> {
  const exposure = await getGlobalExposure(creds);
  if (exposure <= maxNotional) return false;

  const positions = await binance.positionRisk(creds);
  const open = positions.filter((p: any) => Number(p.positionAmt) !== 0);
  if (open.length === 0) return false;

  const symbols = open.map((p: any) => p.symbol);
  const { data: lastFills } = await remoteDb
    .from("trades")
    .select("symbol,filled_at")
    .eq("user_id", userId)
    .in("symbol", symbols)
    .order("filled_at", { ascending: false });
  const ageBySymbol = new Map<string, number>();
  for (const row of lastFills ?? []) {
    if (!ageBySymbol.has(row.symbol) && row.filled_at) {
      ageBySymbol.set(row.symbol, (Date.now() - new Date(row.filled_at).getTime()) / 60000);
    }
  }

  type Cand = { symbol: string; ageMin: number; roiPct: number; score: number; notional: number };
  const candidates: Cand[] = [];
  for (const p of open) {
    const amt = Number(p.positionAmt);
    const entry = Number(p.entryPrice) || 0;
    const mark = Number(p.markPrice) || entry;
    const upnl = Number(p.unRealizedProfit ?? p.unrealizedProfit ?? 0);
    const notional = Math.abs(amt * mark);
    const leverage = Number(p.leverage) || 1;
    const initialMargin = leverage > 0 ? notional / leverage : 0;
    const roiPct = initialMargin > 0 ? (upnl / initialMargin) * 100 : 0;
    const ageMin = ageBySymbol.get(p.symbol) ?? Number.POSITIVE_INFINITY;
    if (roiPct > EVICT_MAX_ROI_PCT) continue;
    if (ageMin < EVICT_MIN_AGE_MIN) continue;
    const score = ageMin + Math.max(0, -roiPct) * 10;
    candidates.push({ symbol: p.symbol, ageMin, roiPct, score, notional });
  }
  if (candidates.length === 0) {
    await botLog(
      userId,
      "warn",
      `Exposure ${exposure.toFixed(2)} > cap ${maxNotional} but no evictable position (all in profit or <${EVICT_MIN_AGE_MIN}min old).`,
    );
    return false;
  }
  candidates.sort((a, b) => b.score - a.score);
  const pick = candidates[0];
  await botLog(
    userId,
    "warn",
    `Auto-evict: exposure ${exposure.toFixed(2)} > cap ${maxNotional}. Closing ${pick.symbol} (age ${pick.ageMin.toFixed(0)}min, ROI ${pick.roiPct.toFixed(2)}%, notional ${pick.notional.toFixed(2)}).`,
    pick.symbol,
  );
  try {
    await closePositionAndCancel(userId, creds, pick.symbol);
    return true;
  } catch (e) {
    await botLog(userId, "error", `auto-evict close: ${(e as Error).message}`, pick.symbol);
    return false;
  }
}

// Per-symbol distributed lock. Prevents two concurrent ticks (e.g. cron +
// manual /bot-tick) from both placing entries for the same user/symbol pair.
// Stale locks older than LOCK_TTL_MS are auto-reclaimed in case a prior tick
// crashed before releasing.
const LOCK_TTL_MS = 90_000;

async function acquireSymbolLock(userId: string, symbol: string): Promise<boolean> {
  // Reclaim stale lock first.
  await remoteDb
    .from("symbol_locks")
    .delete()
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .lt("locked_at", new Date(Date.now() - LOCK_TTL_MS).toISOString());
  const { error } = await remoteDb
    .from("symbol_locks")
    .insert({ user_id: userId, symbol, locked_at: new Date().toISOString() });
  if (error) {
    // 23505 = unique_violation → another tick holds the lock.
    if ((error as any).code === "23505") return false;
    throw error;
  }
  return true;
}

async function releaseSymbolLock(userId: string, symbol: string): Promise<void> {
  await remoteDb.from("symbol_locks").delete().eq("user_id", userId).eq("symbol", symbol);
}

export async function reconcileSymbol(
  cfg: SymbolCfg,
  opts: { newsBlackout?: boolean; entriesBlocked?: boolean } = {},
) {
  const userId = cfg.user_id;

  const gotLock = await acquireSymbolLock(userId, cfg.symbol);
  if (!gotLock) {
    await botLog(
      userId,
      "info",
      `Skipping tick: another run holds the lock for this symbol.`,
      cfg.symbol,
    );
    return;
  }

  try {
    if (true) {
      const local = getLocalBotState(userId);
      const testnet = Boolean(local.cfg.testnet ?? true);
      const creds = await getCredsForUser(userId, testnet);
      const maxNotional = Number(local.cfg.max_total_notional_usdt ?? 1500);
      await reconcileSymbolLocked(
        cfg,
        creds,
        maxNotional,
        opts.newsBlackout ?? false,
        opts.entriesBlocked ?? false,
      );
      return;
    }

    const { data: bot } = await remoteDb
      .from("bot_config")
      .select("testnet,max_total_notional_usdt")
      .eq("user_id", userId)
      .single();
    const creds = await getCredsForUser(userId, bot?.testnet ?? true);
    const maxNotional = Number(bot?.max_total_notional_usdt ?? 500);
    await reconcileSymbolLocked(
      cfg,
      creds,
      maxNotional,
      opts.newsBlackout ?? false,
      opts.entriesBlocked ?? false,
    );
  } finally {
    await releaseSymbolLock(userId, cfg.symbol);
  }
}

async function reconcileSymbolLocked(
  cfg: SymbolCfg,
  creds: BinanceCreds,
  maxNotional: number,
  newsBlackout: boolean = false,
  entriesBlocked: boolean = false,
) {
  const userId = cfg.user_id;

  try {
    await syncFillsForSymbol(userId, creds, cfg.symbol);
  } catch (e) {
    await botLog(
      userId,
      "warn",
      `syncFills skipped: ${(e as Error).message.slice(0, 160)}`,
      cfg.symbol,
    );
  }

  try {
    const closed = await maybeTakeProfit(userId, creds, cfg);
    if (closed) return;
  } catch (e) {
    await botLog(
      userId,
      "warn",
      `take-profit check: ${(e as Error).message.slice(0, 160)}`,
      cfg.symbol,
    );
  }

  try {
    const stopped = await maybeStopLoss(userId, creds, cfg);
    if (stopped) return;
  } catch (e) {
    await botLog(
      userId,
      "warn",
      `stop-loss check: ${(e as Error).message.slice(0, 160)}`,
      cfg.symbol,
    );
  }

  const mp = await binance.markPrice(creds, cfg.symbol);
  const mark = parseFloat(mp.markPrice);

  let blockBuyAdds = false;
  let blockSellAdds = false;
  let trendBias: "up" | "down" | "flat" = "flat";
  const session = getMarketSession();

  // News blackout: don't open new grid entries either side.
  if (newsBlackout) {
    blockBuyAdds = true;
    blockSellAdds = true;
  }
  if (entriesBlocked) {
    blockBuyAdds = true;
    blockSellAdds = true;
  }

  // Extreme-loss cooldown: after a single realized fill at or below the
  // configured loss threshold, pause new entries for this symbol for the
  // cooldown window. Maker exits on any existing position still run via the
  // position guard below. Stop-loss / take-profit / liq guards already ran
  // above and are not affected.
  {
    const lossThreshold = Number(cfg.extreme_loss_threshold_usdt ?? 0);
    const cooldownMin = Number(cfg.extreme_loss_cooldown_min ?? 0);
    if (lossThreshold < 0 && cooldownMin > 0) {
      const sinceIso = new Date(Date.now() - cooldownMin * 60_000).toISOString();
      const { data: badFill } = await remoteDb
        .from("trades")
        .select("realized_pnl,filled_at")
        .eq("user_id", userId)
        .eq("symbol", cfg.symbol)
        .gte("filled_at", sinceIso)
        .lte("realized_pnl", lossThreshold)
        .order("filled_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (badFill?.filled_at) {
        const minsAgo = (Date.now() - new Date(badFill.filled_at).getTime()) / 60000;
        const remaining = Math.max(0, cooldownMin - minsAgo);
        blockBuyAdds = true;
        blockSellAdds = true;
        await botLog(
          userId,
          "warn",
          `Extreme-loss cooldown: last fill realized ${Number(badFill.realized_pnl).toFixed(4)} USDT (<= ${lossThreshold}). Pausing new entries ~${remaining.toFixed(0)}min more.`,
          cfg.symbol,
        );
      }
    }
  }

  // Funding-rate filter: perpetual funding is paid every 8h. Positive funding
  // means longs pay shorts (skip new BUYs); negative means shorts pay longs
  // (skip new SELLs). Threshold is in basis points (1 bp = 0.01%) on the
  // last funding rate. Doesn't touch existing positions or exits.
  if (cfg.funding_filter_enabled) {
    const thresholdBps = Math.max(0, Number(cfg.funding_max_abs_bps ?? 0));
    if (thresholdBps > 0) {
      try {
        const pi = await binance.markPrice(creds, cfg.symbol);
        const fundingBps = Number(pi.lastFundingRate) * 10_000; // decimal → bps
        if (fundingBps > thresholdBps) {
          blockBuyAdds = true;
          await botLog(
            userId,
            "info",
            `Funding filter: rate ${fundingBps.toFixed(2)}bps > +${thresholdBps}bps (longs pay). Pausing new BUY entries.`,
            cfg.symbol,
          );
        } else if (fundingBps < -thresholdBps) {
          blockSellAdds = true;
          await botLog(
            userId,
            "info",
            `Funding filter: rate ${fundingBps.toFixed(2)}bps < -${thresholdBps}bps (shorts pay). Pausing new SELL entries.`,
            cfg.symbol,
          );
        }
      } catch (e) {
        await botLog(
          userId,
          "warn",
          `funding filter: ${(e as Error).message.slice(0, 160)}`,
          cfg.symbol,
        );
      }
    }
  }

  // Z-score mean-reversion confidence filter: only enter on the favored side
  // when the price is stretched far enough from its rolling mean. z > +T →
  // overbought → block new BUYs (still allow SELL entries that fade the
  // stretch). z < -T → oversold → block new SELLs. |z| < T → no strong
  // mean-reversion edge → block both sides to avoid low-confidence churn.
  if (cfg.z_filter_enabled) {
    const interval = cfg.z_interval ?? "1h";
    const lookback = Math.max(5, Number(cfg.z_lookback ?? 20));
    const threshold = Math.max(0, Number(cfg.z_entry_threshold ?? 1.5));
    const z = await getPriceZScore(creds, cfg.symbol, interval, lookback, mark);
    if (z == null) {
      await botLog(
        userId,
        "warn",
        `Z-filter: not enough ${interval} data (need ${lookback}). Skipping filter.`,
        cfg.symbol,
      );
    } else if (threshold > 0) {
      const absZ = Math.abs(z);
      if (absZ < threshold) {
        blockBuyAdds = true;
        blockSellAdds = true;
        await botLog(
          userId,
          "info",
          `Z-filter: z=${z.toFixed(2)} within ±${threshold} (no mean-reversion edge). Pausing both sides.`,
          cfg.symbol,
        );
      } else if (z > 0) {
        blockBuyAdds = true;
        await botLog(
          userId,
          "info",
          `Z-filter: z=${z.toFixed(2)} > +${threshold} (overbought). Pausing new BUY entries.`,
          cfg.symbol,
        );
      } else {
        blockSellAdds = true;
        await botLog(
          userId,
          "info",
          `Z-filter: z=${z.toFixed(2)} < -${threshold} (oversold). Pausing new SELL entries.`,
          cfg.symbol,
        );
      }
    }
  }

  // Trend bias drives SKEW, not a block. (Grids are mean-reversion tools;
  // hard-blocking counter-trend entries turned this into a momentum chaser
  // with high drag. We now bias spacing/center toward the trend but still
  // place both sides — the position guard below enforces one-position-per-symbol.)
  if (cfg.trend_filter_enabled ?? true) {
    const interval = cfg.trend_interval ?? "1h";
    const period = Math.max(5, Number(cfg.trend_ema_period ?? 50));
    const bias = await getTrendBias(
      creds,
      cfg.symbol,
      interval,
      period,
      mark,
      session.flatThresholdPct,
    );
    trendBias = bias ?? "flat";
  }

  // Position guard: enforce one-position-per-symbol and liquidation safety.
  // Also captures inventory for the inventory-relative skew below.
  let positionAmt = 0;
  let positionNotional = 0;
  let positionEntryPrice = 0;
  let positionLeverage = Math.max(1, Number(cfg.leverage ?? 1));
  try {
    const positions = await binance.positionRisk(creds, cfg.symbol);
    const pos = positions.find((p: any) => p.symbol === cfg.symbol && Number(p.positionAmt) !== 0);
    if (pos) {
      const amt = Number(pos.positionAmt);
      positionAmt = amt;
      positionEntryPrice = Number(pos.entryPrice) || mark;
      positionLeverage = Math.max(1, Number(pos.leverage) || Number(cfg.leverage) || 1);
      positionNotional = Math.abs(amt) * (Number(pos.markPrice) || mark);
      // Fee-control mode: once a position is open, stop adding more entries.
      // Keep only reduce-only exits live so entry fees are not stacked while
      // realized PnL is still zero.
      if (amt > 0) blockBuyAdds = true;
      else blockSellAdds = true;

      const liq = Number(pos.liquidationPrice);
      if (liq > 0 && mark > 0) {
        const distancePct = (Math.abs(mark - liq) / mark) * 100;
        if (distancePct <= LIQUIDATION_HARD_PCT) {
          await botLog(
            userId,
            "error",
            `Liquidation risk: mark ${mark} within ${distancePct.toFixed(2)}% of liq ${liq} (<= ${LIQUIDATION_HARD_PCT}%). Closing position.`,
            cfg.symbol,
          );
          try {
            await closePositionAndCancel(userId, creds, cfg.symbol);
          } catch (e) {
            await botLog(userId, "error", `liq hard-close: ${(e as Error).message}`, cfg.symbol);
          }
          return;
        }
      }
      await botLog(
        userId,
        "info",
        `Position open (${amt > 0 ? "LONG" : "SHORT"} ${Math.abs(amt)}). Pausing new ${amt > 0 ? "BUY" : "SELL"} entries to avoid stacking fees; only reduce-only exits stay live.`,
        cfg.symbol,
      );
    }
  } catch (e) {
    await botLog(
      userId,
      "warn",
      `position/liq guard: ${(e as Error).message.slice(0, 160)}`,
      cfg.symbol,
    );
  }

  const outOfRange =
    (cfg.lower_bound && mark < cfg.lower_bound) || (cfg.upper_bound && mark > cfg.upper_bound);
  if (outOfRange) {
    if (positionAmt !== 0) {
      blockBuyAdds = true;
      blockSellAdds = true;
      await botLog(
        userId,
        "warn",
        `Price ${mark} is outside grid range [${cfg.lower_bound ?? "-"}, ${cfg.upper_bound ?? "-"}]. Keeping the open position in exit-only mode and not placing new entries.`,
        cfg.symbol,
      );
    } else {
      await botLog(
        userId,
        "warn",
        `Price ${mark} outside grid range [${cfg.lower_bound ?? "-"}, ${cfg.upper_bound ?? "-"}]. Closing position and cancelling orders.`,
        cfg.symbol,
      );
      try {
        await closePositionAndCancel(userId, creds, cfg.symbol);
      } catch (e) {
        await botLog(userId, "error", `out-of-range close: ${(e as Error).message}`, cfg.symbol);
      }
      return;
    }
  }

  try {
    await binance.setMarginType(creds, cfg.symbol, "ISOLATED");
    await binance.setLeverage(creds, cfg.symbol, cfg.leverage);
  } catch (e) {
    await botLog(userId, "warn", `setLeverage: ${(e as Error).message}`, cfg.symbol);
  }

  // ===== Adaptive grid positioning =====
  // Scale spacing with realized volatility (ATR%), tighten/loosen by session,
  // and skew the grid in the direction of the trend so we buy pullbacks
  // close to mark and let trend-side exits run further.
  const baseSpacing = cfg.grid_spacing_pct;
  const atrPct = await getAtrPct(creds, cfg.symbol, "1h", 14);

  // (AI advisor multipliers removed — deterministic ATR/EMA math is the
  // edge; LLM-injected spacing/size flips added tail risk without proven
  // alpha. Drawdown circuit-breaker and news blackout still gate the bot.)

  // Volatility-adjusted sizing ("Kelly lite"): shrink order size when realized
  // vol exceeds the user's baseline spacing — high-ATR symbols shouldn't
  // burn margin faster than low-ATR ones just because spacing is wider.
  const targetAtr = Math.max(0.05, baseSpacing);
  const sizeMult = atrPct ? Math.max(0.4, Math.min(1.0, targetAtr / atrPct)) : 1.0;
  const f = await getSymbolFilters(creds, cfg.symbol);
  if (positionAmt !== 0 && positionNotional > 0 && positionNotional < DUST_POSITION_NOTIONAL_USDT) {
    await botLog(
      userId,
      "warn",
      `Dust position ${Math.abs(positionAmt)} (~${positionNotional.toFixed(2)} USDT) below ${DUST_POSITION_NOTIONAL_USDT} USDT. Closing it instead of placing tiny TP orders.`,
      cfg.symbol,
    );
    try {
      await closePositionAndCancel(userId, creds, cfg.symbol);
    } catch (e) {
      await botLog(userId, "error", `dust close: ${(e as Error).message}`, cfg.symbol);
    }
    return;
  }
  const rawOrderSize = cfg.order_size_usdt * sizeMult;
  const configuredMinOrder = Math.max(0, Number(cfg.min_order_size_usdt ?? 0));
  const configuredMaxOrder = Math.max(
    configuredMinOrder,
    Number(cfg.max_order_size_usdt ?? rawOrderSize),
  );
  const minEntryNotional = Math.max(configuredMinOrder, f.minNotional * 1.1);

  const volMult = atrPct ? Math.max(0.6, Math.min(2.0, atrPct / baseSpacing)) : 1.0;
  const sessMult = sessionSpacingMult(session.name);
  const buySkew = trendBias === "up" ? 0.75 : trendBias === "down" ? 1.25 : 1.0;
  const sellSkew = trendBias === "down" ? 0.75 : trendBias === "up" ? 1.25 : 1.0;

  // Trend-based center shift (mild bias, not dislocation).
  const trendCenterPct =
    trendBias === "up" ? baseSpacing * 0.25 : trendBias === "down" ? -baseSpacing * 0.25 : 0;

  // Inventory-relative center shift (Avellaneda–Stoikov style). As position
  // notional approaches the per-symbol cap, push center against the position
  // so opposite-side exits move closer to mark and fill sooner.
  const invRatio =
    maxNotional > 0 && positionNotional > 0
      ? Math.max(-1, Math.min(1, (positionAmt > 0 ? -1 : 1) * (positionNotional / maxNotional)))
      : 0;
  const invCenterPct = invRatio * baseSpacing * 0.75;

  const centerShiftPct = trendCenterPct + invCenterPct;
  const center = mark * (1 + centerShiftPct / 100);

  await botLog(
    userId,
    "info",
    `Adaptive grid [${session.name}] bias=${trendBias} atr%=${atrPct?.toFixed(3) ?? "n/a"} vol×${volMult.toFixed(2)} sess×${sessMult.toFixed(2)} buy×${buySkew} sell×${sellSkew} size×${sizeMult.toFixed(2)} trendΔ=${trendCenterPct.toFixed(3)}% invΔ=${invCenterPct.toFixed(3)}% (inv=${(invRatio * 100).toFixed(0)}%)`,
    cfg.symbol,
  );

  const desired: Array<{
    side: "BUY" | "SELL";
    price: number;
    level: number;
    quantity: number;
    reduceOnly?: boolean;
  }> = [];
  const protective: Array<{
    clientOrderId: string;
    side: "BUY" | "SELL";
    type: "STOP" | "STOP_MARKET";
    stopPrice: number;
    quantity: number;
  }> = [];
  const levels = cfg.single_grid_order ? 1 : cfg.grid_levels;

  // When a position is open, always keep one explicit reduce-only take-profit
  // resting off the actual entry price instead of the adaptive grid center.
  // That gives the bot a deterministic closing plan even if mark/center shifts
  // around after entry.
  if (positionAmt !== 0 && positionEntryPrice > 0) {
      const tpSpacingPct = effectiveTakeProfitSpacingPct(cfg.grid_spacing_pct);
      const closeQty = roundStep(Math.abs(positionAmt), f.stepSize, f.quantityPrecision);
      if (closeQty >= f.minQty) {
        const tpPx = roundStep(
          closeTargetPrice(
            positionEntryPrice,
            positionAmt,
            tpSpacingPct,
            TAKE_PROFIT_FEE_BUFFER_PCT,
          ),
          f.tickSize,
          f.pricePrecision,
        );
      if (positionAmt > 0) {
        desired.push({ side: "SELL", price: tpPx, level: 1, quantity: closeQty, reduceOnly: true });
      } else {
        desired.push({ side: "BUY", price: tpPx, level: -1, quantity: closeQty, reduceOnly: true });
      }

      const stopRoi = effectiveStopLossRoi(cfg.stop_loss_roi_pct);
      if (stopRoi < 0) {
        const stopPx = roundStep(
          stopLossTargetPrice(positionEntryPrice, positionAmt, stopRoi, positionLeverage),
          f.tickSize,
          f.pricePrecision,
        );
        protective.push({
          clientOrderId: `protect_sl_${cfg.symbol}`,
          side: positionAmt > 0 ? "SELL" : "BUY",
          type: "STOP_MARKET",
          stopPrice: stopPx,
          quantity: closeQty,
        });
      }
    }
  }

  for (let i = 1; i <= levels; i++) {
    const levelMult = levelSpacingMultiplier(i);
    const buySpacing = ((baseSpacing * volMult * sessMult * buySkew) / 100) * levelMult;
    const sellSpacing = ((baseSpacing * volMult * sessMult * sellSkew) / 100) * levelMult;
    const buyPx = roundStep(center * (1 - buySpacing), f.tickSize, f.pricePrecision);
    const sellPx = roundStep(center * (1 + sellSpacing), f.tickSize, f.pricePrecision);
    if (cfg.single_grid_order) {
      if (positionAmt > 0 && !blockSellAdds) {
        // Dedicated entry-price TP above already owns the close plan.
      } else if (positionAmt < 0 && !blockBuyAdds) {
        // Dedicated entry-price TP above already owns the close plan.
      } else if (!blockBuyAdds) {
        const plannedStop = roundStep(
          stopLossTargetPrice(
            buyPx,
            1,
            effectiveStopLossRoi(cfg.stop_loss_roi_pct),
            Math.max(1, Number(cfg.leverage ?? 1)),
          ),
          f.tickSize,
          f.pricePrecision,
        );
        const plannedTp = roundStep(
          closeTargetPrice(buyPx, 1, cfg.grid_spacing_pct, 0.1),
          f.tickSize,
          f.pricePrecision,
        );
        if (plannedStop <= 0 || plannedTp <= 0 || plannedStop >= buyPx || plannedTp <= buyPx) {
          await botLog(
            userId,
            "warn",
            "Entry rejected: invalid planned BUY stop-loss/take-profit prices.",
            cfg.symbol,
          );
        } else {
          desired.push({ side: "BUY", price: buyPx, level: -i, quantity: 0 });
        }
      } else if (!blockSellAdds) {
        const plannedStop = roundStep(
          stopLossTargetPrice(
            sellPx,
            -1,
            effectiveStopLossRoi(cfg.stop_loss_roi_pct),
            Math.max(1, Number(cfg.leverage ?? 1)),
          ),
          f.tickSize,
          f.pricePrecision,
        );
        const plannedTp = roundStep(
          closeTargetPrice(sellPx, -1, cfg.grid_spacing_pct, 0.1),
          f.tickSize,
          f.pricePrecision,
        );
        if (plannedStop <= 0 || plannedTp <= 0 || plannedStop <= sellPx || plannedTp >= sellPx) {
          await botLog(
            userId,
            "warn",
            "Entry rejected: invalid planned SELL stop-loss/take-profit prices.",
            cfg.symbol,
          );
        } else {
          desired.push({ side: "SELL", price: sellPx, level: i, quantity: 0 });
        }
      }
    } else {
      const allowBuyEntry = positionAmt >= 0 && !blockBuyAdds;
      const allowSellEntry = positionAmt <= 0 && !blockSellAdds;
      if (allowBuyEntry) {
        const plannedStop = roundStep(
          stopLossTargetPrice(
            buyPx,
            1,
            effectiveStopLossRoi(cfg.stop_loss_roi_pct),
            Math.max(1, Number(cfg.leverage ?? 1)),
          ),
          f.tickSize,
          f.pricePrecision,
        );
        const plannedTp = roundStep(
          closeTargetPrice(buyPx, 1, cfg.grid_spacing_pct, 0.1),
          f.tickSize,
          f.pricePrecision,
        );
        if (plannedStop <= 0 || plannedTp <= 0 || plannedStop >= buyPx || plannedTp <= buyPx) {
          await botLog(
            userId,
            "warn",
            "Entry rejected: invalid planned BUY stop-loss/take-profit prices.",
            cfg.symbol,
          );
        } else {
          desired.push({ side: "BUY", price: buyPx, level: -i, quantity: 0 });
        }
      }
      if (allowSellEntry) {
        const plannedStop = roundStep(
          stopLossTargetPrice(
            sellPx,
            -1,
            effectiveStopLossRoi(cfg.stop_loss_roi_pct),
            Math.max(1, Number(cfg.leverage ?? 1)),
          ),
          f.tickSize,
          f.pricePrecision,
        );
        const plannedTp = roundStep(
          closeTargetPrice(sellPx, -1, cfg.grid_spacing_pct, 0.1),
          f.tickSize,
          f.pricePrecision,
        );
        if (plannedStop <= 0 || plannedTp <= 0 || plannedStop <= sellPx || plannedTp >= sellPx) {
          await botLog(
            userId,
            "warn",
            "Entry rejected: invalid planned SELL stop-loss/take-profit prices.",
            cfg.symbol,
          );
        } else {
          desired.push({ side: "SELL", price: sellPx, level: i, quantity: 0 });
        }
      }
    }
  }

  let globalExposure = 0;
  try {
    globalExposure = await getGlobalExposure(creds);
  } catch (e) {
    await botLog(
      userId,
      "warn",
      `global exposure read failed: ${(e as Error).message}`,
      cfg.symbol,
    );
  }
  const remainingBudget = Math.max(0, maxNotional - globalExposure);
  const reduceOnlyDesired = desired.filter((d) => d.reduceOnly);
  let entryDesired = desired.filter((d) => !d.reduceOnly);
  const totalEntryCandidates = entryDesired.length;
  if (cfg.single_grid_order && entryDesired.length > 1) {
    entryDesired.sort((a, b) => Math.abs(a.level) - Math.abs(b.level));
    entryDesired = entryDesired.slice(0, 1);
  }
  entryDesired.sort((a, b) => Math.abs(a.level) - Math.abs(b.level));
  const maxEntryCountByMin =
    minEntryNotional > 0 ? Math.floor(remainingBudget / minEntryNotional) : entryDesired.length;
  if (maxEntryCountByMin <= 0) {
      await botLog(
        userId,
        "warn",
        `Exposure ${globalExposure.toFixed(2)}/${maxNotional}: fitting 0/${totalEntryCandidates} entry levels (~${minEntryNotional.toFixed(2)} min each, budget ${remainingBudget.toFixed(2)}).`,
        cfg.symbol,
      );
    entryDesired = [];
  } else if (entryDesired.length > 0) {
    if (maxEntryCountByMin < entryDesired.length) {
      entryDesired = entryDesired.slice(0, maxEntryCountByMin);
    }

    const perEntryBudget = Math.min(
      configuredMaxOrder,
      Math.max(minEntryNotional, remainingBudget / entryDesired.length),
    );
    const sizedQty = roundStepUp(perEntryBudget / mark, f.stepSize, f.quantityPrecision);
    const sizedNotional = sizedQty * mark;

    if (sizedQty < f.minQty || sizedNotional < minEntryNotional || sizedNotional < f.minNotional) {
      await botLog(
        userId,
        "warn",
        `Exposure sizing produced qty ${sizedQty} (~${sizedNotional.toFixed(2)} USDT), below exchange minimums or configured entry floor.`,
        cfg.symbol,
      );
      entryDesired = [];
    } else {
      entryDesired = entryDesired.map((d) => ({ ...d, quantity: sizedQty }));
      await botLog(
        userId,
        entryDesired.length === totalEntryCandidates ? "info" : "warn",
        `Exposure ${globalExposure.toFixed(2)}/${maxNotional}: fitting ${entryDesired.length}/${totalEntryCandidates} entry levels (~${sizedNotional.toFixed(2)} each, budget ${remainingBudget.toFixed(2)}).`,
        cfg.symbol,
      );
    }
  }
  desired.length = 0;
  desired.push(...reduceOnlyDesired, ...entryDesired);

  const open = await binance.openOrders(creds, cfg.symbol).catch((e) => {
    if (creds.testnet && isBinanceNetworkBlock(e)) {
      return [];
    }
    throw e;
  });
  const openAlgo = await binance.openAlgoOrders(creds, cfg.symbol).catch((e) => {
    if (creds.testnet && isBinanceNetworkBlock(e)) {
      return [];
    }
    throw e;
  });
  const book = await binance.bookTicker(creds, cfg.symbol).catch(() => null);
  const bestBid = book ? Number(book.bidPrice ?? 0) : null;
  const bestAsk = book ? Number(book.askPrice ?? 0) : null;
  const liveByLevel = new Map<string, any>();
  const liveProtective = new Map<string, any>();
  const liveProtectiveOrders: any[] = [];
  for (const o of open) {
    if (o.clientOrderId?.startsWith(`grid_${cfg.symbol}_`)) {
      liveByLevel.set(o.clientOrderId, o);
    }
  }
  for (const o of openAlgo) {
    const cid = String(o.clientAlgoId ?? o.clientOrderId ?? "");
    if (cid.startsWith(`protect_`)) {
      liveProtective.set(cid, o);
      liveProtectiveOrders.push(o);
    }
  }

  const desiredCids = new Set(desired.map((d) => `grid_${cfg.symbol}_${d.level}`));
  for (const [cid, o] of liveByLevel.entries()) {
    if (!desiredCids.has(cid)) {
      const liveCreatedAt = Number(o.time ?? o.updateTime ?? 0);
      const liveAgeMs = liveCreatedAt > 0 ? Date.now() - liveCreatedAt : Number.POSITIVE_INFINITY;
      if (liveAgeMs < GRID_ORDER_MIN_LIFETIME_MS) continue;
      try {
        await binance.cancelOrder(creds, cfg.symbol, o.orderId);
        await remoteDb
          .from("grid_orders")
          .update({ status: "CANCELED" })
          .eq("user_id", userId)
          .eq("binance_order_id", o.orderId);
      } catch (e) {
        await botLog(userId, "warn", `cancel ${o.orderId}: ${(e as Error).message}`, cfg.symbol);
      }
    }
  }

  const desiredProtectiveCids = new Set(protective.map((p) => p.clientOrderId));
  for (const [cid, o] of liveProtective.entries()) {
    if (!desiredProtectiveCids.has(cid)) {
      try {
        await binance.cancelAlgoOrder(creds, cid);
      } catch (e) {
        await botLog(
          userId,
          "warn",
          `cancel protective ${cid}: ${(e as Error).message}`,
          cfg.symbol,
        );
      }
    }
  }

  for (const d of desired) {
    const cid = `grid_${cfg.symbol}_${d.level}`;
    const live = liveByLevel.get(cid);
    if (live) {
      const livePx = Number(live.price ?? 0);
      const liveQty = Number(live.origQty ?? 0);
      const liveCreatedAt = Number(live.time ?? live.updateTime ?? 0);
      const liveAgeMs = liveCreatedAt > 0 ? Date.now() - liveCreatedAt : Number.POSITIVE_INFINITY;
      const repriceTolerancePct = gridRepriceTolerancePct(cfg.grid_spacing_pct);
      const samePrice =
        Math.abs(livePx - d.price) < Math.max(f.tickSize / 2, 1e-9) ||
        (livePx > 0 && (Math.abs(livePx - d.price) / livePx) * 100 <= repriceTolerancePct);
      const sameQty = Math.abs(liveQty - d.quantity) < Math.max(f.stepSize / 2, 1e-9);
      if ((samePrice && sameQty) || liveAgeMs < GRID_ORDER_MIN_LIFETIME_MS) continue;
      try {
        await binance.cancelOrder(creds, cfg.symbol, live.orderId);
      } catch (e) {
        await botLog(
          userId,
          "warn",
          `replace-cancel ${live.orderId}: ${(e as Error).message}`,
          cfg.symbol,
        );
        continue;
      }
    }
    try {
      let finalPrice = makerSafeLimitPrice(
        d.side,
        d.price,
        bestBid,
        bestAsk,
        f.tickSize,
        f.pricePrecision,
      );
      if (Math.abs(finalPrice - d.price) > Math.max(f.tickSize / 2, 1e-9)) {
        await botLog(
          userId,
          "info",
          `Adjusted ${d.side} limit ${d.price} → ${finalPrice} to keep the order post-only and away from the spread.`,
          cfg.symbol,
        );
      }
      const placed = await binance.placeOrder(creds, {
        symbol: cfg.symbol,
        side: d.side,
        type: "LIMIT",
        quantity: d.quantity,
        price: finalPrice,
        timeInForce: "GTX",
        reduceOnly: d.reduceOnly,
        newClientOrderId: cid,
      });
      await remoteDb.from("grid_orders").insert({
        user_id: userId,
        symbol: cfg.symbol,
        side: d.side,
        price: finalPrice,
        qty: d.quantity,
        binance_order_id: placed.orderId,
        client_order_id: cid,
        status: placed.status,
        level_index: d.level,
      });
      if (d.reduceOnly) {
        await botLog(
          userId,
          "info",
          `Attached take-profit ${d.side} ${d.quantity} @ ${finalPrice}.`,
          cfg.symbol,
        );
      } else {
        await botLog(
          userId,
          "info",
          `Placed grid entry ${d.side} ${d.quantity} @ ${finalPrice} (level ${d.level}).`,
          cfg.symbol,
        );
      }
    } catch (e) {
      const msg = (e as Error).message;
      const isPostOnlyReject =
        msg.includes("immediately match") ||
        msg.includes("-2010") ||
        msg.includes("Post Only") ||
        msg.includes("post only");
      if (isPostOnlyReject) {
        try {
          const freshBook = await binance.bookTicker(creds, cfg.symbol).catch(() => null);
          const retryBid = freshBook ? Number(freshBook.bidPrice ?? 0) : bestBid;
          const retryAsk = freshBook ? Number(freshBook.askPrice ?? 0) : bestAsk;
          const retryPrice = makerSafeLimitPrice(
            d.side,
            d.price,
            retryBid,
            retryAsk,
            f.tickSize,
            f.pricePrecision,
          );
          if (retryPrice !== d.price) {
            const placed = await binance.placeOrder(creds, {
              symbol: cfg.symbol,
              side: d.side,
              type: "LIMIT",
              quantity: d.quantity,
              price: retryPrice,
              timeInForce: "GTX",
              reduceOnly: d.reduceOnly,
              newClientOrderId: cid,
            });
            await remoteDb.from("grid_orders").insert({
              user_id: userId,
              symbol: cfg.symbol,
              side: d.side,
              price: retryPrice,
              qty: d.quantity,
              binance_order_id: placed.orderId,
              client_order_id: cid,
              status: placed.status,
              level_index: d.level,
            });
            await botLog(
              userId,
              "info",
              `Repriced ${d.side} ${d.quantity} @ ${retryPrice} after post-only rejection.`,
              cfg.symbol,
            );
            continue;
          }
        } catch {
          // fall through to the warning below
        }
      }
      if (!msg.includes("immediately match") && !msg.includes("-2010")) {
        await botLog(userId, "warn", `place ${d.side}@${d.price}: ${msg}`, cfg.symbol);
      } else {
        await botLog(
          userId,
          "warn",
          `Post-only rejection on ${d.side}@${d.price}; the bot will reprice away from the spread next tick.`,
          cfg.symbol,
        );
      }
    }
  }

  const sameProtectiveOrder = (live: any, p: (typeof protective)[number]) => {
    const liveStop = Number(live.triggerPrice ?? live.stopPrice ?? live.price ?? 0);
    const sameStop = Math.abs(liveStop - p.stopPrice) < Math.max(f.tickSize / 2, 1e-9);
    const sameSide = String(live.side) === p.side;
    const liveType = String(live.type ?? live.orderType ?? "");
    const sameType = liveType === p.type || liveType === "CONDITIONAL" || liveType === "";
    const liveQty = Number(live.origQty ?? live.quantity ?? live.origQuantity ?? 0);
    const sameQty = Math.abs(liveQty - p.quantity) < Math.max(f.stepSize / 2, 1e-9);
    return sameStop && sameSide && sameType && sameQty;
  };

  for (const p of protective) {
    const live =
      liveProtective.get(p.clientOrderId) ??
      liveProtectiveOrders.find((order) => sameProtectiveOrder(order, p));
    if (live) {
      if (sameProtectiveOrder(live, p)) continue;
      try {
        await binance.cancelAlgoOrder(creds, p.clientOrderId);
      } catch (e) {
        await botLog(
          userId,
          "warn",
          `replace protective ${p.clientOrderId}: ${(e as Error).message}`,
          cfg.symbol,
        );
        continue;
      }
    }

    try {
      await binance.placeAlgoOrder(creds, {
        symbol: cfg.symbol,
        side: p.side,
        type: p.type,
        quantity: p.quantity,
        price: p.type === "STOP_MARKET" ? undefined : p.stopPrice,
        triggerPrice: p.stopPrice,
        workingType: "MARK_PRICE",
        reduceOnly: true,
        timeInForce: p.type === "STOP_MARKET" ? undefined : "GTC",
        clientAlgoId: p.clientOrderId,
      });
      await botLog(
        userId,
        "info",
        `Attached stop-loss ${p.side} stop-market @ ${p.stopPrice}.`,
        cfg.symbol,
      );
    } catch (e) {
      await botLog(
        userId,
        "warn",
        `place protective ${p.side} stop@${p.stopPrice}: ${(e as Error).message}`,
        cfg.symbol,
      );
    }
  }
}
