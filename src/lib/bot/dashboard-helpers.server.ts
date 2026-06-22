import { binanceProxySource, type BinanceCreds } from "@/lib/binance/client.server";
import { binance } from "@/lib/binance/client.server";
import {
  adjustTestnetRealizedToday,
  getLocalBotState,
  PAPER_HIGH_RISK_PROFILE,
} from "@/lib/bot/local-bot-store.server";

const VPNHOOD_REPO_URL = "https://github.com/vpnhood/vpnhood";
const LOSS_STREAK_MIN_LOSS_USDT = 1;

let publicIpCache: { ip: string | null; expiresAt: number } | null = null;

export type LocalDashboardSnapshot = {
  account: any;
  positions: any[];
  openOrders: any[];
  realizedToday: number;
  trendBias: Record<string, "up" | "down" | "flat" | null>;
  updatedAt: number;
};

function localDashboardSnapshots() {
  const g = globalThis as typeof globalThis & {
    __localDashboardSnapshots?: Map<string, LocalDashboardSnapshot>;
  };
  g.__localDashboardSnapshots ??= new Map();
  return g.__localDashboardSnapshots;
}

function dashboardSnapshotKey(userId: string, testnet: boolean) {
  return `${userId}:${testnet ? "testnet" : "mainnet"}`;
}

export function setLocalDashboardSnapshot(
  userId: string,
  testnet: boolean,
  snapshot: Omit<LocalDashboardSnapshot, "updatedAt">,
) {
  localDashboardSnapshots().set(dashboardSnapshotKey(userId, testnet), {
    ...snapshot,
    updatedAt: Date.now(),
  });
}

export function getLocalDashboardSnapshot(userId: string, testnet: boolean) {
  return localDashboardSnapshots().get(dashboardSnapshotKey(userId, testnet)) ?? null;
}

export async function serverPublicIp() {
  if (publicIpCache && publicIpCache.expiresAt > Date.now()) return publicIpCache.ip;
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(2_000),
      headers: { "user-agent": "crypto-caddie-demo/1.0" },
    });
    const json = (await res.json()) as { ip?: string };
    const ip = typeof json.ip === "string" && json.ip.trim() ? json.ip.trim() : null;
    publicIpCache = { ip, expiresAt: Date.now() + 60_000 };
    return ip;
  } catch {
    publicIpCache = { ip: null, expiresAt: Date.now() + 30_000 };
    return null;
  }
}

export async function binanceNetworkRouteStatus() {
  const proxySource = binanceProxySource();
  return {
    proxyConfigured: Boolean(proxySource),
    proxySource,
    serverPublicIp: await serverPublicIp(),
    vpnhoodRepoUrl: VPNHOOD_REPO_URL,
  };
}

export function botDayStartMs(now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 0, 0, 0);
  return now.getTime() >= start ? start : start - 24 * 60 * 60 * 1000;
}

export function nextBotDayStartIso(now = new Date()) {
  return new Date(botDayStartMs(now) + 24 * 60 * 60 * 1000).toISOString();
}

export async function realizedTodayFromTradeHistory(
  creds: BinanceCreds,
  symbols: string[],
  sinceMs: number,
) {
  const tradeSets = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return await binance.userTrades(creds, symbol, undefined, 500);
      } catch {
        return [] as any[];
      }
    }),
  );

  return tradeSets
    .flat()
    .filter((t: any) => Number(t.time ?? 0) >= sinceMs)
    .reduce(
      (sum: number, t: any) => sum + Number(t.realizedPnl ?? 0) - Number(t.commission ?? 0),
      0,
    );
}

export async function localStartRiskBlock(userId: string, creds: BinanceCreds) {
  const state = getLocalBotState(userId);
  if (
    state.cfg.risk_profile === PAPER_HIGH_RISK_PROFILE &&
    state.cfg.paper_kill_switch_triggered_at &&
    state.cfg.paper_kill_switch_reason
  ) {
    return `Paper high-risk profile is locked by a kill switch: ${state.cfg.paper_kill_switch_reason}. Re-apply the profile to reset it.`;
  }
  const [account, positions, income] = await Promise.all([
    binance.account(creds),
    binance.positionRisk(creds).catch(() => [] as any[]),
    binance.income(creds, { startTime: botDayStartMs(), limit: 1000 }).catch(() => [] as any[]),
  ]);

  const walletBalance = Math.max(0, Number(account.totalWalletBalance ?? 0));
  const botCapitalPct = Math.max(20, Math.min(40, Number(state.cfg.bot_capital_pct ?? 30)));
  const configuredCap = Number(state.cfg.max_total_notional_usdt ?? 0);
  const botCapital = walletBalance * (botCapitalPct / 100);
  const effectiveCapital = configuredCap > 0 ? Math.min(configuredCap, botCapital) : botCapital;
  const realized = income.reduce((sum: number, row: any) => {
    const type = String(row.incomeType ?? "");
    if (!["REALIZED_PNL", "COMMISSION", "FUNDING_FEE"].includes(type)) return sum;
    return sum + Number(row.income ?? 0);
  }, 0);
  const adjustedRealized = adjustTestnetRealizedToday(userId, realized);
  const unrealized = positions.reduce((sum: number, p: any) => {
    if (Number(p.positionAmt) === 0) return sum;
    return sum + Number(p.unRealizedProfit ?? p.unrealizedProfit ?? 0);
  }, 0);
  const pnl = adjustedRealized + unrealized;
  if (state.cfg.risk_profile !== PAPER_HIGH_RISK_PROFILE) {
    return null;
  }
  const dailyLossLimit =
    effectiveCapital * (Math.max(0.1, Number(state.cfg.daily_loss_limit_pct ?? 1)) / 100);
  if (dailyLossLimit > 0 && pnl <= -dailyLossLimit) {
    return `Daily loss rule is active: today's PnL is ${pnl.toFixed(2)} USDT, below the -${dailyLossLimit.toFixed(2)} USDT limit. The bot can start again after ${nextBotDayStartIso()} UTC, or after you deliberately change the daily loss rule.`;
  }

  const realizedLosses = income
    .filter((row: any) => String(row.incomeType ?? "") === "REALIZED_PNL")
    .sort((a: any, b: any) => Number(b.time ?? 0) - Number(a.time ?? 0));
  let consecutiveLosses = 0;
  for (const row of realizedLosses) {
    const value = Number(row.income ?? 0);
    if (value <= -LOSS_STREAK_MIN_LOSS_USDT) consecutiveLosses++;
    else if (value > 0) break;
  }
  const pauseCount = Math.max(1, Math.floor(Number(state.cfg.consecutive_loss_pause_count ?? 3)));
  if (pnl < 0 && consecutiveLosses >= pauseCount) {
    return `Loss-streak rule is active: ${consecutiveLosses} realized losses of at least ${LOSS_STREAK_MIN_LOSS_USDT.toFixed(2)} USDT in a row today while daily PnL is ${pnl.toFixed(2)} USDT. The bot is paused until the next bot day (${nextBotDayStartIso()} UTC).`;
  }

  return null;
}
