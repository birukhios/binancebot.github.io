import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function defaultBotStorePath() {
  if (
    process.env.VERCEL ||
    process.env.VERCEL_URL ||
    process.env.NOW_REGION ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
  ) {
    return "/tmp/local-bot-store.json";
  }

  return "./data/local-bot-store.json";
}

const requestedPath = process.env.LOCAL_BOT_STORE_PATH ?? defaultBotStorePath();
const filePath = requestedPath.startsWith("/") ? requestedPath : resolve(requestedPath);

type LocalUserStore = {
  cfg: Record<string, any>;
  symbols: Array<Record<string, any>>;
  logs: Array<Record<string, any>>;
};

type LocalBotStore = Record<string, LocalUserStore>;

const now = () => new Date().toISOString();
const BTC_SYMBOL = "BTCUSDT";
const BTC_MAX_ENTRY_SLOTS = 4;
const BTC_GRID_LEVELS = 2;
const BTC_LEVERAGE = 3;
const BTC_FAST_SPACING_PCT = 0.35;
const BTC_MIN_ORDER_USDT = 75;
export const PAPER_HIGH_RISK_PROFILE = "paper_high_risk";

type LocalLogOptions = {
  dedupeKey?: string;
  dedupeWindowMs?: number;
};

function recentLocalLogKeys(): Map<string, number> {
  const g = globalThis as typeof globalThis & { __localBotRecentLogKeys?: Map<string, number> };
  g.__localBotRecentLogKeys ??= new Map();
  return g.__localBotRecentLogKeys;
}

function defaultSymbol(symbol: string, enabled = symbol === BTC_SYMBOL) {
  const btc = symbol === BTC_SYMBOL;
  return {
    id: symbol,
    symbol,
    enabled: btc && enabled,
    grid_levels: btc ? BTC_GRID_LEVELS : 1,
    grid_spacing_pct: btc ? BTC_FAST_SPACING_PCT : 0.6,
    order_size_usdt: btc ? BTC_MIN_ORDER_USDT : 75,
    leverage: btc ? BTC_LEVERAGE : 3,
    upper_bound: null,
    lower_bound: null,
    auto_tune: false,
    min_order_size_usdt: btc ? BTC_MIN_ORDER_USDT : 50,
    max_order_size_usdt: btc ? BTC_MIN_ORDER_USDT : 150,
    min_spacing_pct: 0.2,
    max_spacing_pct: 3,
    stop_loss_roi_pct: btc ? -12 : -50,
    max_position_age_minutes: 0,
    trend_filter_enabled: true,
    trend_ema_period: 50,
    trend_interval: "1h",
    extreme_loss_threshold_usdt: -10,
    extreme_loss_cooldown_min: 60,
    funding_filter_enabled: btc,
    funding_max_abs_bps: 10,
    z_filter_enabled: false,
    z_lookback: 20,
    z_interval: "1h",
    z_entry_threshold: 1.0,
    updated_at: now(),
  };
}

function defaultUserStore(): LocalUserStore {
  return {
    cfg: {
      testnet: true,
      is_running: false,
      risk_profile: "standard",
      bot_capital_pct: 30,
      daily_profit_target_pct: 2,
      daily_loss_limit_pct: 3,
      max_open_trades: BTC_MAX_ENTRY_SLOTS,
      consecutive_loss_pause_count: 5,
      max_total_notional_usdt: 0,
      auto_select_enabled: false,
      auto_select_max_symbols: 1,
      drawdown_pause_pct: 5,
      entry_pause_until_iso: null,
      entry_pause_reason: null,
      news_pause_enabled: true,
      news_pause_window_min: 30,
      news_currencies: "USD",
      updated_at: now(),
    },
    symbols: [defaultSymbol(BTC_SYMBOL, true)],
    logs: [],
  };
}

function readStore(): LocalBotStore {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as LocalBotStore;
  } catch {
    return {};
  }
}

function writeStore(store: LocalBotStore) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

function withUser(userId: string) {
  const store = readStore();
  if (!store[userId]) {
    store[userId] = defaultUserStore();
  }
  normalizeUserStore(store[userId]!);
  writeStore(store);
  return { store, user: store[userId]! };
}

function normalizeUserStore(user: LocalUserStore) {
  const paperHighRisk = user.cfg.risk_profile === PAPER_HIGH_RISK_PROFILE;
  user.cfg.risk_profile = paperHighRisk ? PAPER_HIGH_RISK_PROFILE : "standard";
  user.cfg.bot_capital_pct = paperHighRisk
    ? 40
    : Math.max(20, Math.min(40, Number(user.cfg.bot_capital_pct ?? 30)));
  user.cfg.daily_profit_target_pct = paperHighRisk
    ? 4
    : Math.max(0, Number(user.cfg.daily_profit_target_pct ?? 2));
  user.cfg.daily_loss_limit_pct = paperHighRisk
    ? 2
    : Math.min(5, Math.max(0.1, Number(user.cfg.daily_loss_limit_pct ?? 3)));
  user.cfg.max_open_trades = paperHighRisk
    ? 2
    : Math.max(
        1,
        Math.min(
          BTC_MAX_ENTRY_SLOTS,
          Math.floor(Number(user.cfg.max_open_trades ?? BTC_MAX_ENTRY_SLOTS)),
        ),
      );
  user.cfg.consecutive_loss_pause_count = paperHighRisk
    ? 3
    : Math.max(1, Math.min(10, Math.floor(Number(user.cfg.consecutive_loss_pause_count ?? 5))));
  user.cfg.auto_select_enabled = false;
  user.cfg.auto_select_max_symbols = 1;
  user.cfg.drawdown_pause_pct = paperHighRisk
    ? 5
    : Math.max(0.1, Number(user.cfg.drawdown_pause_pct ?? 5));
  user.cfg.entry_pause_until_iso = user.cfg.entry_pause_until_iso ?? null;
  user.cfg.entry_pause_reason = user.cfg.entry_pause_reason ?? null;
    user.cfg.max_total_notional_usdt = Math.max(0, Number(user.cfg.max_total_notional_usdt ?? 0));
    if (!user.symbols.some((symbol) => symbol.symbol === BTC_SYMBOL)) {
      user.symbols.unshift(defaultSymbol(BTC_SYMBOL, true));
    }
    for (const symbol of user.symbols) {
      const testnet = Boolean(user.cfg.testnet ?? true);
      symbol.grid_levels = symbol.symbol === BTC_SYMBOL ? BTC_GRID_LEVELS : 1;
      symbol.enabled = symbol.symbol === BTC_SYMBOL ? Boolean(symbol.enabled ?? true) : false;
      const liveMinOrderUsdt = 5;
      symbol.order_size_usdt =
        symbol.symbol === BTC_SYMBOL && !testnet
          ? Math.max(liveMinOrderUsdt, Number(symbol.order_size_usdt ?? 0))
          : Math.max(75, Number(symbol.order_size_usdt ?? 0));
      symbol.min_order_size_usdt =
        symbol.symbol === BTC_SYMBOL && !testnet
          ? Math.max(liveMinOrderUsdt, Number(symbol.min_order_size_usdt ?? 0))
          : Math.max(50, Number(symbol.min_order_size_usdt ?? 0));
      symbol.max_order_size_usdt =
        symbol.symbol === BTC_SYMBOL && !testnet
          ? Math.max(liveMinOrderUsdt, Number(symbol.max_order_size_usdt ?? 0))
          : Math.max(150, Number(symbol.max_order_size_usdt ?? 0));
      const stopLossRoi = Number(symbol.stop_loss_roi_pct ?? -50);
      symbol.stop_loss_roi_pct = stopLossRoi < 0 ? stopLossRoi : -50;
      if (symbol.symbol === BTC_SYMBOL) {
        symbol.enabled = true;
        symbol.grid_levels = paperHighRisk ? 3 : testnet ? BTC_GRID_LEVELS : 1;
        symbol.single_grid_order = !paperHighRisk && !testnet;
        symbol.grid_spacing_pct = paperHighRisk ? 0.25 : testnet ? BTC_FAST_SPACING_PCT : 0.5;
        symbol.order_size_usdt = paperHighRisk
          ? Math.max(500, Number(symbol.order_size_usdt ?? 0))
          : Math.max(testnet ? BTC_MIN_ORDER_USDT : liveMinOrderUsdt, Number(symbol.order_size_usdt ?? 0));
        symbol.min_order_size_usdt = testnet ? BTC_MIN_ORDER_USDT : liveMinOrderUsdt;
        symbol.max_order_size_usdt = paperHighRisk
          ? Math.max(2000, Number(symbol.max_order_size_usdt ?? 0))
          : Math.max(testnet ? BTC_MIN_ORDER_USDT : liveMinOrderUsdt, Number(symbol.max_order_size_usdt ?? 0));
        symbol.leverage = paperHighRisk ? 8 : testnet ? BTC_LEVERAGE : 2;
      symbol.stop_loss_roi_pct = paperHighRisk
        ? Math.max(-10, Math.min(-6, Number(symbol.stop_loss_roi_pct ?? -8)))
        : testnet
          ? Math.max(-20, Math.min(-6, Number(symbol.stop_loss_roi_pct ?? -12)))
          : Math.max(-12, Math.min(-6, Number(symbol.stop_loss_roi_pct ?? -8)));
      symbol.trend_filter_enabled = true;
      symbol.funding_filter_enabled = true;
      symbol.funding_max_abs_bps = paperHighRisk ? 10 : testnet ? Number(symbol.funding_max_abs_bps ?? 10) : 8;
      symbol.z_filter_enabled = Boolean(symbol.z_filter_enabled ?? !testnet);
      symbol.z_entry_threshold = paperHighRisk
        ? Math.max(1, Math.min(2, Number(symbol.z_entry_threshold ?? 1.25)))
        : testnet
          ? Math.max(1, Math.min(2.5, Number(symbol.z_entry_threshold ?? 1.0)))
          : Math.max(1.2, Math.min(2.5, Number(symbol.z_entry_threshold ?? 1.4)));
    }
  }
}

export function applyPaperHighRiskProfile(userId: string) {
  updateLocalBotConfig(userId, {
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
  });
  updateLocalSymbol(userId, BTC_SYMBOL, {
    enabled: true,
    grid_levels: 3,
    grid_spacing_pct: 0.25,
    order_size_usdt: 500,
    min_order_size_usdt: BTC_MIN_ORDER_USDT,
    max_order_size_usdt: 2000,
    leverage: 8,
    stop_loss_roi_pct: -8,
    trend_filter_enabled: true,
    funding_filter_enabled: true,
    z_filter_enabled: false,
    z_entry_threshold: 1.25,
  });
}

export function getLocalBotState(userId: string) {
  return withUser(userId).user;
}

export function listLocalBotUserIds() {
  return Object.keys(readStore());
}

export function updateLocalBotConfig(userId: string, patch: Record<string, any>) {
  const { store, user } = withUser(userId);
  user.cfg = { ...user.cfg, ...patch, updated_at: now() };
  writeStore(store);
  return user.cfg;
}

export function updateLocalSymbol(userId: string, symbol: string, patch: Record<string, any>) {
  const { store, user } = withUser(userId);
  const idx = user.symbols.findIndex((s) => s.symbol === symbol);
  const next = {
    ...(idx >= 0 ? user.symbols[idx] : defaultSymbol(symbol, false)),
    ...patch,
    symbol,
    enabled: symbol === BTC_SYMBOL ? patch.enabled : false,
    grid_levels: symbol === BTC_SYMBOL ? BTC_GRID_LEVELS : 1,
    updated_at: now(),
  };
  if (idx >= 0) user.symbols[idx] = next;
  else user.symbols.push(next);
  user.symbols.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
  normalizeUserStore(user);
  writeStore(store);
  return next;
}

export function adjustTestnetRealizedToday(userId: string, rawRealizedToday: number) {
  const state = getLocalBotState(userId);
  if (!Boolean(state.cfg.testnet ?? true)) return rawRealizedToday;

  const baseline = Number(state.cfg.testnet_realized_baseline_usdt ?? Number.NaN);
  const nowIso = now();
  if (!Number.isFinite(baseline) || rawRealizedToday < baseline) {
    updateLocalBotConfig(userId, {
      testnet_realized_baseline_usdt: rawRealizedToday,
      testnet_realized_baseline_updated_at: nowIso,
    });
    return 0;
  }

  return Math.max(0, rawRealizedToday - baseline);
}

export function addLocalLog(
  userId: string,
  level: "info" | "warn" | "error",
  message: string,
  symbol?: string,
  options?: LocalLogOptions,
) {
  if (options?.dedupeKey) {
    const windowMs = Math.max(1, Number(options.dedupeWindowMs ?? 2 * 60 * 1000));
    const key = `${userId}:${symbol ?? "-"}:${level}:${options.dedupeKey}`;
    const recent = recentLocalLogKeys();
    const nowMs = Date.now();
    const lastSeen = recent.get(key) ?? 0;
    if (nowMs - lastSeen < windowMs) return;
    recent.set(key, nowMs);
    if (recent.size > 1000) {
      for (const [oldKey, ts] of recent.entries()) {
        if (nowMs - ts > windowMs) recent.delete(oldKey);
      }
    }
  }

  const { store, user } = withUser(userId);
  user.logs.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    level,
    message,
    symbol: symbol ?? null,
    created_at: now(),
  });
  user.logs = user.logs.slice(0, 200);
  writeStore(store);
}
