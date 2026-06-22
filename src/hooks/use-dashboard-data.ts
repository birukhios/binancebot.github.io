import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getDashboard,
  getTrades,
  getLogs,
  setBotRunning,
  setTestnet,
  setMaxExposure,
  updateSymbol,
  killSwitch,
  closePosition,
  cancelSymbolOrders,
  testConnection,
  autoConfigureSymbol,
  optimizeSymbol,
  saveBinanceCreds,
  learnSymbol,
  setIntelligence,
  applyPaperHighRiskProfile,
  runAutoSelect,
  getNewsStatus,
  getRealizedPnlHistory,
} from "@/lib/bot/bot.functions";

type TradeSide = "all" | "BUY" | "SELL";

export function useDashboardData(sessionUserId: string | null) {
  const qc = useQueryClient();

  const dashFn = useServerFn(getDashboard);
  const tradesFn = useServerFn(getTrades);
  const logsFn = useServerFn(getLogs);
  const newsFn = useServerFn(getNewsStatus);

  const dash = useQuery({
    queryKey: ["dashboard", sessionUserId],
    queryFn: () => dashFn(),
    enabled: !!sessionUserId,
    retry: false,
    placeholderData: (previous) => previous,
    staleTime: 4_000,
    refetchInterval: (query) => (query.state.error ? false : 5_000),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: true,
  });

  const news = useQuery({
    queryKey: ["news", sessionUserId],
    queryFn: () => newsFn(),
    enabled: !!sessionUserId,
    retry: false,
    refetchInterval: (query) => (query.state.error ? false : 60000),
  });

  const logs = useQuery({
    queryKey: ["logs", sessionUserId],
    queryFn: () => logsFn(),
    enabled: !!sessionUserId,
    retry: false,
    refetchInterval: (query) => (query.state.error ? false : 10000),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["trades"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
  };

  const realizedPnlFn = useServerFn(getRealizedPnlHistory);

  return { qc, dash, news, logs, tradesFn, realizedPnlFn, invalidate };
}

export function useDashboardMutations(sessionUserId: string | null) {
  const qc = useQueryClient();
  const startStop = useServerFn(setBotRunning);
  const toggleTestnetFn = useServerFn(setTestnet);
  const maxExp = useServerFn(setMaxExposure);
  const updSym = useServerFn(updateSymbol);
  const kill = useServerFn(killSwitch);
  const closePos = useServerFn(closePosition);
  const cancelOrders = useServerFn(cancelSymbolOrders);
  const testConn = useServerFn(testConnection);
  const autoConfigFn = useServerFn(autoConfigureSymbol);
  const optimizeFn = useServerFn(optimizeSymbol);
  const saveCredsFn = useServerFn(saveBinanceCreds);
  const learnFn = useServerFn(learnSymbol);
  const applyHighRiskFn = useServerFn(applyPaperHighRiskProfile);
  const setIntelligenceFn = useServerFn(setIntelligence);
  const runAutoSelectFn = useServerFn(runAutoSelect);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["trades"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
  };

  const isPaperKillSwitchLockError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return /Paper high-risk profile is locked by a kill switch:/i.test(message);
  };

  const startStopMut = useMutation({
    mutationFn: async (running: boolean) => {
      try {
        return await startStop({ data: { running } });
      } catch (error) {
        if (!running || !isPaperKillSwitchLockError(error)) throw error;
        await applyHighRiskFn();
        return await startStop({ data: { running } });
      }
    },
    onSuccess: (_, running) => {
      toast.success(running ? "Bot started" : "Bot stopped");
      invalidate();
    },
    onError: (e, running) => {
      const message = e instanceof Error ? e.message : String(e);
      if (running && isPaperKillSwitchLockError(e)) {
        toast.error(`Could not unlock the paper profile automatically: ${message}`);
        return;
      }
      toast.error(message);
    },
  });

  const killMut = useMutation({
    mutationFn: () => kill(),
    onSuccess: () => {
      toast.success("Kill switch activated");
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const testConnMut = useMutation({
    mutationFn: () => testConn(),
    onSuccess: (r) => {
      if (r.ok)
        toast.success(
          `Connected to ${r.testnet ? "TESTNET" : "MAINNET"} — balance ${r.balance} USDT`,
        );
      else toast.error(r.error ?? "Failed");
    },
  });

  const toggleEnvironment = async (checked: boolean) => {
    if (!checked && !confirm("Switch to LIVE trading? The bot will stop.")) return;
    await toggleTestnetFn({ data: { testnet: checked } });
    invalidate();
  };

  return {
    qc,
    invalidate,
    startStopMut,
    killMut,
    testConnMut,
    toggleEnvironment,
    maxExp,
    updSym,
    closePos,
    cancelOrders,
    autoConfigFn,
    optimizeFn,
    saveCredsFn,
    learnFn,
    applyHighRiskFn,
    setIntelligenceFn,
    runAutoSelectFn,
    startStop,
  };
}

export function useTradesQuery(
  sessionUserId: string | null,
  tradesFn: ReturnType<typeof useServerFn<typeof getTrades>>,
  filters: { symbol: string; side: TradeSide; page: number; pageSize: number },
) {
  return useQuery({
    queryKey: ["trades", sessionUserId, filters.symbol, filters.side, filters.page, filters.pageSize],
    queryFn: () =>
      tradesFn({
        data: {
          page: filters.page,
          pageSize: filters.pageSize,
          symbol: filters.symbol,
          side: filters.side,
        },
      }),
    enabled: !!sessionUserId,
    retry: false,
    placeholderData: (previous) => previous,
  });
}
