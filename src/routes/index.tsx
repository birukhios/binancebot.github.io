import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { AuthPage } from "@/routes/auth";
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
} from "@/lib/bot/bot.functions";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { AlertTriangle, LogOut, Moon, Power, RefreshCw, SunMedium } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Grid Bot Dashboard" }] }),
  component: Dashboard,
});

type ClientSession = {
  user?: {
    id?: string;
    email?: string;
  };
} | null;

type ThemeMode = "light" | "dark";
type TradeSide = "all" | "BUY" | "SELL";
type TradesPage = {
  items: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

async function fetchClientSession(): Promise<ClientSession> {
  const res = await fetch("/api/session", { credentials: "include" });
  if (!res.ok) throw new Error("Could not check sign-in status.");
  return res.json();
}

function Dashboard() {
  const router = useRouter();
  const qc = useQueryClient();
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("kelay-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [tradeSymbol, setTradeSymbol] = useState("all");
  const [tradeSide, setTradeSide] = useState<TradeSide>("all");
  const [tradePage, setTradePage] = useState(1);
  const [tradePageSize, setTradePageSize] = useState(20);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    window.localStorage.setItem("kelay-theme", theme);
  }, [theme]);

  const session = useQuery({
    queryKey: ["auth-session"],
    queryFn: fetchClientSession,
    retry: false,
  });
  const sessionUserId = session.data?.user?.id ?? null;

  useEffect(() => {
    if (session.isSuccess && !sessionUserId) qc.clear();
  }, [qc, session.isSuccess, sessionUserId]);

  useEffect(() => {
    setTradePage(1);
  }, [tradeSymbol, tradeSide, tradePageSize]);

  const dashFn = useServerFn(getDashboard);
  const tradesFn = useServerFn(getTrades);
  const logsFn = useServerFn(getLogs);

  const dash = useQuery({
    queryKey: ["dashboard", sessionUserId],
    queryFn: () => dashFn(),
    enabled: !!sessionUserId,
    retry: false,
    placeholderData: (previous) => previous,
    staleTime: 0,
    refetchInterval: (query) => (query.state.error ? false : 1500),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    refetchOnReconnect: true,
  });
  const trades = useQuery<TradesPage>({
    queryKey: ["trades", sessionUserId, tradeSymbol, tradeSide, tradePage, tradePageSize],
    queryFn: () =>
      tradesFn({
        data: {
          page: tradePage,
          pageSize: tradePageSize,
          symbol: tradeSymbol,
          side: tradeSide,
        },
      }),
    enabled: !!sessionUserId,
    retry: false,
    placeholderData: (previous) => previous,
  });
  const logs = useQuery({
    queryKey: ["logs", sessionUserId],
    queryFn: () => logsFn(),
    enabled: !!sessionUserId,
    retry: false,
    refetchInterval: (query) => (query.state.error ? false : 10000),
  });
  const newsFn = useServerFn(getNewsStatus);
  const news = useQuery({
    queryKey: ["news", sessionUserId],
    queryFn: () => newsFn(),
    enabled: !!sessionUserId,
    retry: false,
    refetchInterval: (query) => (query.state.error ? false : 60000),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["trades"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
  };

  const startStop = useServerFn(setBotRunning);
  const toggleTestnet = useServerFn(setTestnet);
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
  const toggleEnvironment = async (checked: boolean) => {
    if (!checked && !confirm("Switch to LIVE trading? The bot will stop.")) return;
    await toggleTestnet({ data: { testnet: checked } });
    invalidate();
  };

  const startStopMut = useMutation({
    mutationFn: (running: boolean) => startStop({ data: { running } }),
    onSuccess: () => {
      toast.success("Bot state updated");
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
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

  if (session.isLoading) return <AuthPage />;
  if (!sessionUserId) return <AuthPage />;
  if (dash.isError) {
    const message =
      dash.error instanceof Error ? dash.error.message : "The dashboard could not load.";

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-xl border-destructive">
          <CardHeader>
            <CardTitle>Dashboard setup required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">The dashboard server request failed.</p>
            <pre className="overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {message}
            </pre>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => dash.refetch()}>
                Try again
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  await qc.cancelQueries();
                  qc.clear();
                  await authClient.signOut();
                  window.location.reload();
                }}
              >
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (dash.isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Connecting to Binance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The app is signed in, and it is now waiting on Binance data. If your Binance network
              is blocked on this machine, turn on the VPN or set your proxy, then reload.
            </p>
            <p className="text-xs text-muted-foreground">
              You do not need the VPN to reach the login screen. You only need it for Binance API
              calls after sign-in.
            </p>
          </CardContent>
        </Card>
      </div>
    );

  const cfg = dash.data?.cfg;
  const account = dash.data?.account;
  const positions = dash.data?.positions ?? [];
  const openOrders = dash.data?.openOrders ?? [];
  const symbols = dash.data?.symbols ?? [];
  const dashboardSnapshotAt = dash.data?.snapshotAt ?? null;
  const credsStatus = dash.data?.credsStatus;
  const credsReady = cfg?.testnet ? !!credsStatus?.testnet : !!credsStatus?.mainnet;
  const isTestnet = cfg?.testnet ?? true;
  const environmentLabel = isTestnet ? "TESTNET" : "LIVE";
  const environmentDescription = isTestnet
    ? "Use paper/testnet trading"
    : "Use live/mainnet trading";
  const isDashRefreshing = dash.isFetching && !!dash.data;
  const tradeRows = trades.data?.items ?? [];
  const tradeMeta = trades.data ?? null;
  const tradeStart = tradeMeta && tradeMeta.total > 0 ? (tradeMeta.page - 1) * tradeMeta.pageSize + 1 : 0;
  const tradeEnd = tradeMeta ? tradeStart + tradeRows.length - 1 : 0;
  const grossUnrealized = positions.reduce(
    (sum: number, p: any) => sum + Number(p.unrealizedProfit ?? 0),
    0,
  );
  const netUnrealized = positions.reduce(
    (sum: number, p: any) => sum + Number(p.netUnrealizedAfterCloseFee ?? p.unrealizedProfit ?? 0),
    0,
  );
  const estCloseFees = positions.reduce(
    (sum: number, p: any) => sum + Number(p.estCloseFeeUsdt ?? 0),
    0,
  );
  const estOpenOrderFees = openOrders.reduce(
    (sum: number, o: any) => sum + Number(o.estMakerFeeUsdt ?? 0),
    0,
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Grid Trading Bot</h1>
            <p className="text-sm text-muted-foreground">
              {session.data?.user?.email ?? "Signed in"} · {environmentLabel} ·{" "}
              {cfg?.is_running ? (
                <span className="text-green-600">RUNNING</span>
              ) : (
                <span className="text-orange-600">STOPPED</span>
              )}
              {dash.data?.marketSession && (
                <>
                  {" · "}
                  <span
                    title={`Trend-gate flat band: ±${dash.data.marketSession.flatThresholdPct}%`}
                  >
                    Session:{" "}
                    <span className="font-medium uppercase">
                      {dash.data.marketSession.name.replace(/_/g, " ")}
                    </span>
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
              <div className="leading-tight">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Trading mode
                </Label>
                <div className="text-sm font-medium">{environmentLabel}</div>
              </div>
              <Switch
                checked={cfg?.testnet ?? true}
                onCheckedChange={toggleEnvironment}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? (
                <SunMedium className="mr-2 h-4 w-4" />
              ) : (
                <Moon className="mr-2 h-4 w-4" />
              )}
              {theme === "dark" ? "Light" : "Dark"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => testConnMut.mutate()}
              disabled={testConnMut.isPending}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Test API
            </Button>
            <Button
              variant={cfg?.is_running ? "destructive" : "default"}
              size="sm"
              onClick={() => startStopMut.mutate(!cfg?.is_running)}
              disabled={startStopMut.isPending || (!cfg?.is_running && !credsReady)}
              title={!credsReady ? "Save your Binance API keys first" : undefined}
            >
              <Power className="mr-2 h-4 w-4" />
              {cfg?.is_running ? "Stop bot" : "Start bot"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirm("Stop bot AND cancel all open orders on Binance. Continue?"))
                  killMut.mutate();
              }}
            >
              <AlertTriangle className="mr-2 h-4 w-4" /> Kill
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await qc.cancelQueries();
                qc.clear();
                await authClient.signOut();
                window.location.reload();
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!credsReady && (
          <Card className="border-orange-500/60 bg-orange-500/10">
            <CardContent className="pt-6">
              <p className="text-sm">
                <strong>Set up required:</strong> Add your Binance{" "}
                {cfg?.testnet ? "testnet" : "mainnet"} API key and secret in the{" "}
                <strong>Settings</strong> tab below before you can start the bot.
              </p>
            </CardContent>
          </Card>
        )}

        {dash.data?.error && (
          <Card className="border-orange-500/60 bg-orange-500/10">
            <CardContent className="pt-6">
              <p className="text-sm">
                <strong>Binance network blocked:</strong> {dash.data.error}
              </p>
              {!dash.data?.binanceNetworkRoute?.proxyConfigured && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Connect Cloudflare WARP/VpnHood on this machine, or set{" "}
                  <code>BINANCE_PROXY_URL</code> in <code>.env.local</code>, then restart the
                  server.
                </p>
              )}
              {dash.data?.binanceNetworkRoute?.proxyConfigured && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Proxy is set via <code>{dash.data.binanceNetworkRoute.proxySource}</code>. If
                  Binance says the key/IP is invalid, allow-list the server/VPN public IP shown in
                  Settings.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat
            label="Wallet balance"
            value={account?.totalWalletBalance ? `${num(account.totalWalletBalance)} USDT` : "—"}
          />
          <Stat label="Gross P&L" value={`${num(grossUnrealized)} USDT`} />
          <Stat label="Net if closed" value={`${num(netUnrealized)} USDT`} />
          <Stat label="Realized today" value={`${dash.data?.realizedToday.toFixed(4)} USDT`} />
          <Stat label="Est. fees" value={`${num(estCloseFees + estOpenOrderFees)} USDT`} />
        </div>

        <Tabs
          defaultValue={credsReady ? "overview" : "settings"}
          key={credsReady ? "ready" : "setup"}
          className="w-full"
        >
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="symbols">Symbols</TabsTrigger>
            <TabsTrigger value="trades">Trades</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Open positions</CardTitle>
                  {isDashRefreshing && (
                    <Badge variant="outline" className="text-xs">
                      Refreshing live state
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {positions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {openOrders.length > 0
                      ? "No filled positions yet. Open grid orders are shown below."
                      : "No open positions."}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Entry Price</TableHead>
                        <TableHead>Break Even Price</TableHead>
                        <TableHead>Mark Price</TableHead>
                        <TableHead>TP Target</TableHead>
                        <TableHead>Liq. Price</TableHead>
                        <TableHead>Margin Ratio</TableHead>
                        <TableHead>Margin</TableHead>
                        <TableHead>Gross PnL / ROI</TableHead>
                        <TableHead>Net PnL / ROI</TableHead>
                        <TableHead>Close Fee</TableHead>
                        <TableHead>Est. Funding Fee</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {positions.map((p: any) => {
                        const upnl = parseFloat(p.unrealizedProfit);
                        const roi = Number(p.roiPct ?? 0);
                        const liq = parseFloat(p.liquidationPrice);
                        const mr = Number(p.marginRatioPct ?? 0);
                        const isolated = p.marginType === "isolated";
                        const marginVal = isolated
                          ? parseFloat(p.isolatedMargin ?? "0")
                          : Number(p.initialMargin ?? 0);
                        const fee = Number(p.estFundingFee ?? 0);
                        const closeFee = Number(p.estCloseFeeUsdt ?? 0);
                        const netPnl = Number(p.netUnrealizedAfterCloseFee ?? upnl);
                        const netRoi = Number(p.netRoiPct ?? roi);
                        return (
                          <TableRow key={p.symbol}>
                            <TableCell className="font-mono">
                              {p.symbol}
                              <span className="ml-2 text-xs text-muted-foreground">
                                {p.leverage}x {isolated ? "ISO" : "CROSS"}
                              </span>
                            </TableCell>
                            <TableCell
                              className={
                                parseFloat(p.positionAmt) >= 0
                                  ? "text-green-600"
                                  : "text-destructive"
                              }
                            >
                              {p.positionAmt}
                            </TableCell>
                            <TableCell>{num(p.entryPrice)}</TableCell>
                            <TableCell>{p.breakEvenPrice ? num(p.breakEvenPrice) : "—"}</TableCell>
                            <TableCell>{num(p.markPrice)}</TableCell>
                            <TableCell>
                              {p.tpTargetPrice ? (
                                <div>
                                  <div className="font-medium">{num(p.tpTargetPrice)}</div>
                                  <div className="text-xs text-muted-foreground">
                                    ≥ {Number(p.tpTargetUsdt).toFixed(2)} USDT
                                  </div>
                                </div>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="text-destructive">
                              {liq > 0 ? num(liq) : "—"}
                            </TableCell>
                            <TableCell
                              className={
                                mr >= 80 ? "text-destructive" : mr >= 50 ? "text-yellow-600" : ""
                              }
                            >
                              {mr.toFixed(2)}%
                            </TableCell>
                            <TableCell>{marginVal.toFixed(2)} USDT</TableCell>
                            <TableCell
                              className={upnl >= 0 ? "text-green-600" : "text-destructive"}
                            >
                              {num(upnl)} ({roi >= 0 ? "+" : ""}
                              {roi.toFixed(2)}%)
                            </TableCell>
                            <TableCell
                              className={netPnl >= 0 ? "text-green-600" : "text-destructive"}
                            >
                              {num(netPnl)} ({netRoi >= 0 ? "+" : ""}
                              {netRoi.toFixed(2)}%)
                            </TableCell>
                            <TableCell className="text-muted-foreground">{num(closeFee)}</TableCell>
                            <TableCell className={fee >= 0 ? "text-green-600" : "text-destructive"}>
                              {fee >= 0 ? "+" : ""}
                              {fee.toFixed(4)}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                  if (!confirm(`Market-close ${p.symbol}?`)) return;
                                  try {
                                    await closePos({ data: { symbol: p.symbol } });
                                    toast.success("Closed");
                                    invalidate();
                                  } catch (e) {
                                    toast.error((e as Error).message);
                                  }
                                }}
                              >
                                Close
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Open grid orders</CardTitle>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{openOrders.length} live order{openOrders.length === 1 ? "" : "s"}</div>
                    <div>
                      Sync:{" "}
                      {dashboardSnapshotAt
                        ? new Date(dashboardSnapshotAt).toLocaleTimeString()
                        : "—"}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {openOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open grid orders.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Filled</TableHead>
                        <TableHead>Notional</TableHead>
                        <TableHead>Est. Maker Fee</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {openOrders.map((o: any) => (
                        <TableRow key={`${o.symbol}-${o.orderId}`}>
                          <TableCell className="font-mono">{o.symbol}</TableCell>
                          <TableCell
                            className={o.side === "BUY" ? "text-green-600" : "text-destructive"}
                          >
                            {o.side}
                          </TableCell>
                          <TableCell>{num(o.price)}</TableCell>
                          <TableCell>{num(o.origQty)}</TableCell>
                          <TableCell>{num(o.executedQty)}</TableCell>
                          <TableCell>{num(o.notional)} USDT</TableCell>
                          <TableCell className="text-muted-foreground">
                            {num(o.estMakerFeeUsdt ?? 0)} USDT
                          </TableCell>
                          <TableCell>{o.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="symbols" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Enabled symbols:</span>
              {symbols.map((s: any) => (
                <Button
                  key={s.symbol}
                  variant={s.enabled ? "default" : "outline"}
                  size="sm"
                  onClick={async () => {
                    await updSym({ data: { ...s, enabled: !s.enabled, grid_levels: 1 } });
                    toast.success(`${s.symbol} ${s.enabled ? "disabled" : "enabled"}`);
                    invalidate();
                  }}
                >
                  {s.symbol}
                </Button>
              ))}
            </div>
            {symbols.map((s: any) => (
              <SymbolCard
                key={`${s.symbol}-${s.updated_at}`}
                s={s}
                bias={dash.data?.trendBias?.[s.symbol] ?? null}
                onSave={async (next) => {
                  await updSym({ data: next });
                  toast.success(`${s.symbol} updated`);
                  invalidate();
                }}
                botRunning={!!cfg?.is_running}
                credsReady={credsReady}
                startPending={startStopMut.isPending}
                onTrade={async (next) => {
                  toast.info(`Studying ${s.symbol} and optimizing the grid setup...`);
                  try {
                    await optimizeFn({ data: { symbol: s.symbol, days: 30 } });
                  } catch (e) {
                    toast.warning(`Optimizer skipped: ${(e as Error).message}`);
                  }
                  await updSym({
                    data: { ...next, enabled: true, grid_levels: s.symbol === "BTCUSDT" ? 2 : 1 },
                  });
                  if (!cfg?.is_running) {
                    await startStop({ data: { running: true } });
                  }
                  toast.success(`${s.symbol} grid enabled`);
                  invalidate();
                }}
                onCancel={async () => {
                  if (!confirm(`Cancel all open orders for ${s.symbol}?`)) return;
                  try {
                    await cancelOrders({ data: { symbol: s.symbol } });
                    toast.success("Canceled");
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
                onAutoConfigure={async () => {
                  try {
                    const r = await autoConfigFn({ data: { symbol: s.symbol } });
                    toast.success(
                      `Auto-configured: ${r.config.grid_levels} levels × ${r.config.grid_spacing_pct.toFixed(2)}% (vol ${r.analysis.avgHourlyRangePct}%/h)`,
                    );
                    invalidate();
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
                onOptimize={async () => {
                  try {
                    const r = await optimizeFn({ data: { symbol: s.symbol, days: 60 } });
                    const b = r.best;
                    toast.success(
                      `Optimized (${r.daysAnalyzed}d, ${r.trialsTested} trials): ${b.gridLevels}×${b.spacingPct}% ${b.leverage}x → backtest PnL ${b.realizedPnl} USDT, ${b.fills} fills, DD ${b.maxDrawdown}`,
                      { duration: 8000 },
                    );
                    invalidate();
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
                onLearn={async () => {
                  try {
                    const r = await learnFn({ data: { symbol: s.symbol } });
                    toast.success(`${s.symbol}: ${r.note}`, { duration: 8000 });
                    invalidate();
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              />
            ))}
          </TabsContent>

          <TabsContent value="trades">
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Symbol</Label>
                    <Select value={tradeSymbol} onValueChange={setTradeSymbol}>
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="All symbols" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All symbols</SelectItem>
                        {symbols.map((s: any) => (
                          <SelectItem key={s.symbol} value={s.symbol}>
                            {s.symbol}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Side</Label>
                    <Select
                      value={tradeSide}
                      onValueChange={(value) => setTradeSide(value as TradeSide)}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue placeholder="All sides" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All sides</SelectItem>
                        <SelectItem value="BUY">BUY</SelectItem>
                        <SelectItem value="SELL">SELL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Per page</Label>
                    <Select
                      value={String(tradePageSize)}
                      onValueChange={(value) => setTradePageSize(Number(value))}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="ml-auto text-right text-xs text-muted-foreground">
                    <div>
                      {tradeMeta?.total ?? 0} trade{(tradeMeta?.total ?? 0) === 1 ? "" : "s"}
                    </div>
                    <div>
                      {tradeMeta?.total ? `${tradeStart}-${tradeEnd}` : "0"} of{" "}
                      {tradeMeta?.total ?? 0}
                    </div>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Gross Realized P&L</TableHead>
                      <TableHead>Fee Paid</TableHead>
                      <TableHead>Net P&L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tradeRows.map((t: any) => {
                      const gross = Number(t.realized_pnl ?? 0);
                      const commission = Number(t.commission ?? 0);
                      const net = gross - commission;
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="font-mono text-xs">
                            {new Date(t.filled_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="font-mono">{t.symbol}</TableCell>
                          <TableCell>
                            <Badge variant={t.side === "BUY" ? "default" : "secondary"}>
                              {t.side}
                            </Badge>
                          </TableCell>
                          <TableCell>{num(t.price)}</TableCell>
                          <TableCell>{num(t.qty)}</TableCell>
                          <TableCell className={gross >= 0 ? "text-green-600" : "text-destructive"}>
                            {num(gross)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{num(commission)}</TableCell>
                          <TableCell className={net >= 0 ? "text-green-600" : "text-destructive"}>
                            {num(net)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {tradeRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground">
                          No trades match the current filters
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Page {tradeMeta?.page ?? 1} of {tradeMeta?.totalPages ?? 1}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(tradeMeta?.page ?? 1) <= 1 || trades.isFetching}
                      onClick={() => setTradePage((page) => Math.max(1, page - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(tradeMeta?.page ?? 1) >= (tradeMeta?.totalPages ?? 1) || trades.isFetching}
                      onClick={() =>
                        setTradePage((page) => Math.min(tradeMeta?.totalPages ?? 1, page + 1))
                      }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs">
            <Card>
              <CardContent className="pt-6 space-y-1 font-mono text-xs">
                {(logs.data ?? []).map((l: any) => (
                  <div key={l.id} className="flex gap-2">
                    <span className="text-muted-foreground">
                      {new Date(l.created_at).toLocaleTimeString()}
                    </span>
                    <span
                      className={
                        l.level === "error"
                          ? "text-destructive"
                          : l.level === "warn"
                            ? "text-orange-600"
                            : "text-muted-foreground"
                      }
                    >
                      [{l.level}]
                    </span>
                    {l.symbol && <span className="text-primary">{l.symbol}</span>}
                    <span>{l.message}</span>
                  </div>
                ))}
                {(logs.data ?? []).length === 0 && (
                  <p className="text-muted-foreground">No logs yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>Global settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Trading mode</Label>
                    <p className="text-sm text-muted-foreground">
                      {environmentDescription}. Switching environments stops the bot and requires
                      the matching API keys.
                    </p>
                  </div>
                  <Switch
                    checked={cfg?.testnet ?? true}
                    onCheckedChange={toggleEnvironment}
                  />
                </div>
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                  <div>
                    <Label className="text-base">Paper high-risk profile</Label>
                    <p className="text-xs text-muted-foreground">
                      Forces TESTNET, increases BTC leverage, widens order sizing, and arms hard
                      kill switches for daily loss, drawdown, loss streaks, and repeated API
                      failures.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={async () => {
                      await applyHighRiskFn();
                      toast.success("Paper high-risk profile applied");
                      invalidate();
                    }}
                  >
                    Apply paper high-risk profile
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxexp">Max total notional (USDT)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="maxexp"
                      type="number"
                      defaultValue={cfg?.max_total_notional_usdt}
                      onBlur={async (e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) {
                          await maxExp({ data: { max: v } });
                          toast.success("Saved");
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-4 rounded-md border p-4">
                    <div>
                      <Label className="text-base">Intelligence</Label>
                      <p className="text-xs text-muted-foreground">
                        Auto-select symbols, drawdown circuit-breaker, news-aware pause.
                      </p>
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="autosel">Auto-select symbols</Label>
                      <Switch
                        id="autosel"
                        checked={(cfg as any)?.auto_select_enabled ?? false}
                        onCheckedChange={async (c) => {
                          await setIntelligence({ data: { auto_select_enabled: c } });
                          invalidate();
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="maxsym">Max auto-managed symbols</Label>
                      <Input
                        id="maxsym"
                        type="number"
                        min={1}
                        max={15}
                        defaultValue={(cfg as any)?.auto_select_max_symbols ?? 4}
                        onBlur={async (e) => {
                          const v = parseInt(e.target.value);
                          if (v >= 1 && v <= 15) {
                            await setIntelligence({ data: { auto_select_max_symbols: v } });
                            toast.success("Saved");
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ddpct">Drawdown pause % (24h)</Label>
                      <Input
                        id="ddpct"
                        type="number"
                        min={0}
                        max={50}
                        step={0.5}
                        defaultValue={(cfg as any)?.drawdown_pause_pct ?? 3}
                        onBlur={async (e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) {
                            await setIntelligence({ data: { drawdown_pause_pct: v } });
                            toast.success("Saved");
                          }
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Bot auto-stops if 24h P&L drops below -this % of wallet.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const r = await runAutoSelect({ data: undefined as any });
                        toast.success(
                          `Picked: ${(r as any).top?.map((t: any) => t.symbol).join(", ") ?? "n/a"}`,
                        );
                        invalidate();
                      }}
                    >
                      Run ranking now
                    </Button>

                    <div className="border-t pt-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label htmlFor="newspause" className="text-base">
                            News-aware pause
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Skip new grid entries around high-impact events.
                          </p>
                        </div>
                        <Switch
                          id="newspause"
                          checked={(cfg as any)?.news_pause_enabled ?? true}
                          onCheckedChange={async (c) => {
                            await setIntelligence({ data: { news_pause_enabled: c } });
                            invalidate();
                            qc.invalidateQueries({ queryKey: ["news"] });
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="newswin">Window (min)</Label>
                          <Input
                            id="newswin"
                            type="number"
                            min={0}
                            max={240}
                            step={5}
                            defaultValue={(cfg as any)?.news_pause_window_min ?? 30}
                            onBlur={async (e) => {
                              const v = parseInt(e.target.value);
                              if (!isNaN(v) && v >= 0 && v <= 240) {
                                await setIntelligence({ data: { news_pause_window_min: v } });
                                toast.success("Saved");
                                qc.invalidateQueries({ queryKey: ["news"] });
                              }
                            }}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="newsccy">Currencies</Label>
                          <Input
                            id="newsccy"
                            placeholder="USD,EUR"
                            defaultValue={(cfg as any)?.news_currencies ?? "USD"}
                            onBlur={async (e) => {
                              const v = e.target.value.trim();
                              if (v) {
                                await setIntelligence({ data: { news_currencies: v } });
                                toast.success("Saved");
                                qc.invalidateQueries({ queryKey: ["news"] });
                              }
                            }}
                          />
                        </div>
                      </div>
                      {news.data?.enabled &&
                        (news.data.active && news.data.event ? (
                          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                            <Badge variant="destructive" className="mb-1">
                              News blackout
                            </Badge>
                            <div>
                              {news.data.event.country} · {news.data.event.title}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {news.data.event.minutesUntil > 0
                                ? `in ${news.data.event.minutesUntil} min`
                                : `${Math.abs(news.data.event.minutesUntil)} min ago`}
                            </div>
                          </div>
                        ) : news.data.next ? (
                          <div className="text-xs text-muted-foreground">
                            Next high-impact: {news.data.next.country} {news.data.next.title} in{" "}
                            {news.data.next.minutesUntil} min
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            No upcoming high-impact events this week.
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
                <BinanceKeysCard
                  credsStatus={dash.data?.credsStatus}
                  onSave={async (vals) => {
                    await saveCredsFn({ data: vals });
                    toast.success("API keys saved");
                    invalidate();
                  }}
                />
                <BinanceNetworkRouteCard
                  proxyConfigured={!!dash.data?.binanceNetworkRoute?.proxyConfigured}
                  proxySource={dash.data?.binanceNetworkRoute?.proxySource}
                  serverPublicIp={dash.data?.binanceNetworkRoute?.serverPublicIp}
                  vpnhoodRepoUrl={dash.data?.binanceNetworkRoute?.vpnhoodRepoUrl}
                />
                <div className="rounded-md border border-muted bg-muted/30 p-4 text-xs text-muted-foreground">
                  Your keys are stored on the server and are only used when this bot runs. They are
                  never sent back to the browser.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function SymbolCard({
  s,
  bias,
  onSave,
  onTrade,
  botRunning,
  credsReady,
  startPending,
  onCancel,
  onAutoConfigure,
  onOptimize,
  onLearn,
}: {
  s: any;
  bias?: "up" | "down" | "flat" | null;
  onSave: (next: any) => Promise<void>;
  onTrade: (next: any) => Promise<void>;
  botRunning: boolean;
  credsReady: boolean;
  startPending: boolean;
  onCancel: () => Promise<void>;
  onAutoConfigure: () => Promise<void>;
  onOptimize: () => Promise<void>;
  onLearn: () => Promise<void>;
}) {
  const [autoLoading, setAutoLoading] = useState(false);
  const [optLoading, setOptLoading] = useState(false);
  const [learnLoading, setLearnLoading] = useState(false);
  const [form, setForm] = useState({
    symbol: s.symbol,
    enabled: s.enabled,
    grid_levels: s.grid_levels,
    grid_spacing_pct: Number(s.grid_spacing_pct),
    order_size_usdt: Number(s.order_size_usdt),
    leverage: s.leverage,
    upper_bound: s.upper_bound !== null ? Number(s.upper_bound) : null,
    lower_bound: s.lower_bound !== null ? Number(s.lower_bound) : null,
    auto_tune: !!s.auto_tune,
    min_order_size_usdt: Number(s.min_order_size_usdt ?? 50),
    max_order_size_usdt: Number(s.max_order_size_usdt ?? 150),
    min_spacing_pct: Number(s.min_spacing_pct ?? 0.2),
    max_spacing_pct: Number(s.max_spacing_pct ?? 3.0),
    stop_loss_roi_pct: Number(s.stop_loss_roi_pct ?? -50),
    max_position_age_minutes: Number(s.max_position_age_minutes ?? 0),
    extreme_loss_threshold_usdt: Number(s.extreme_loss_threshold_usdt ?? -10),
    extreme_loss_cooldown_min: Number(s.extreme_loss_cooldown_min ?? 60),
    trend_filter_enabled: s.trend_filter_enabled ?? true,
    trend_ema_period: Number(s.trend_ema_period ?? 50),
    trend_interval: (s.trend_interval ?? "1h") as "15m" | "30m" | "1h" | "2h" | "4h" | "1d",
    funding_filter_enabled: !!s.funding_filter_enabled,
    funding_max_abs_bps: Number(s.funding_max_abs_bps ?? 10),
    z_filter_enabled: !!s.z_filter_enabled,
    z_lookback: Number(s.z_lookback ?? 20),
    z_interval: (s.z_interval ?? "1h") as "15m" | "30m" | "1h" | "2h" | "4h" | "1d",
    z_entry_threshold: Number(s.z_entry_threshold ?? 1.5),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle className="font-mono">{s.symbol}</CardTitle>
          {bias && (
            <Badge
              variant="outline"
              className={
                bias === "up"
                  ? "border-green-500/40 text-green-600 dark:text-green-400"
                  : bias === "down"
                    ? "border-red-500/40 text-red-600 dark:text-red-400"
                    : "text-muted-foreground"
              }
              title={`Trend filter bias on ${s.trend_interval ?? "1h"} EMA${s.trend_ema_period ?? 50}`}
            >
              {bias === "up"
                ? "↑ Uptrend (no shorts)"
                : bias === "down"
                  ? "↓ Downtrend (no longs)"
                  : "↔ Flat"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor={`en-${s.symbol}`} className="text-sm">
            Enabled
          </Label>
          <Switch
            id={`en-${s.symbol}`}
            checked={form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          />
        </div>
      </CardHeader>
      <CardContent>
        {s.backtest_at && (
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="font-mono">
              Backtest PnL: {Number(s.backtest_pnl).toFixed(2)} USDT
            </Badge>
            <Badge variant="outline" className="font-mono">
              Return: {Number(s.backtest_return_pct).toFixed(2)}%
            </Badge>
            <Badge variant="outline" className="font-mono">
              Max DD: {Number(s.backtest_max_drawdown).toFixed(2)} USDT
            </Badge>
            <Badge variant="outline" className="font-mono">
              Fills: {s.backtest_fills}
            </Badge>
            <span className="text-muted-foreground self-center">
              {Math.round((Date.now() - new Date(s.backtest_at).getTime()) / 3600000)}h ago
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field
            label="Levels (each side)"
            value={form.grid_levels}
            onChange={(v) => setForm({ ...form, grid_levels: parseInt(v) || 1 })}
          />
          <Field
            label="Spacing %"
            value={form.grid_spacing_pct}
            onChange={(v) => setForm({ ...form, grid_spacing_pct: parseFloat(v) || 0.1 })}
          />
          <Field
            label="Order size (USDT)"
            value={form.order_size_usdt}
            onChange={(v) => setForm({ ...form, order_size_usdt: parseFloat(v) || 5 })}
          />
          <Field
            label="Leverage"
            value={form.leverage}
            onChange={(v) => setForm({ ...form, leverage: parseInt(v) || 1 })}
          />
          <Field
            label="Lower bound (opt)"
            value={form.lower_bound ?? ""}
            onChange={(v) => setForm({ ...form, lower_bound: v === "" ? null : parseFloat(v) })}
          />
          <Field
            label="Upper bound (opt)"
            value={form.upper_bound ?? ""}
            onChange={(v) => setForm({ ...form, upper_bound: v === "" ? null : parseFloat(v) })}
          />
        </div>

        <div className="bg-muted/30 mt-4 rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <Label htmlFor={`auto-${s.symbol}`} className="text-sm font-medium">
                Auto-tune from trades
              </Label>
              <p className="text-muted-foreground text-xs">
                Each hour, adjust spacing & order size from the last 50 fills (bounded).
              </p>
            </div>
            <Switch
              id={`auto-${s.symbol}`}
              checked={form.auto_tune}
              onCheckedChange={(v) => setForm({ ...form, auto_tune: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field
              label="Min spacing %"
              value={form.min_spacing_pct}
              onChange={(v) => setForm({ ...form, min_spacing_pct: parseFloat(v) || 0.1 })}
            />
            <Field
              label="Max spacing %"
              value={form.max_spacing_pct}
              onChange={(v) => setForm({ ...form, max_spacing_pct: parseFloat(v) || 5 })}
            />
            <Field
              label="Min size (USDT)"
              value={form.min_order_size_usdt}
              onChange={(v) => setForm({ ...form, min_order_size_usdt: parseFloat(v) || 5 })}
            />
            <Field
              label="Max size (USDT)"
              value={form.max_order_size_usdt}
              onChange={(v) => setForm({ ...form, max_order_size_usdt: parseFloat(v) || 500 })}
            />
          </div>
          {s.learning_notes && (
            <p className="text-muted-foreground mt-2 font-mono text-xs">
              Last learn
              {s.last_learned_at ? ` (${new Date(s.last_learned_at).toLocaleString()})` : ""}:{" "}
              {s.learning_notes}
            </p>
          )}
        </div>

        <div className="bg-muted/30 mt-4 rounded-md border p-3">
          <div className="mb-2">
            <Label className="text-sm font-medium">Position monitoring</Label>
            <p className="text-muted-foreground text-xs">
              Each tick the bot checks open positions. Take-profit and liquidation guards always
              run; these add a stop-loss and a max age.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field
              label="Stop-loss ROI % (≤ 0)"
              value={form.stop_loss_roi_pct}
              onChange={(v) =>
                setForm({ ...form, stop_loss_roi_pct: Math.min(0, parseFloat(v) || 0) })
              }
            />
            <Field
              label="Max position age (min, 0=off)"
              value={form.max_position_age_minutes}
              onChange={(v) =>
                setForm({ ...form, max_position_age_minutes: Math.max(0, parseInt(v) || 0) })
              }
            />
            <Field
              label="Extreme-loss threshold (USDT, ≤ 0)"
              value={form.extreme_loss_threshold_usdt}
              onChange={(v) =>
                setForm({ ...form, extreme_loss_threshold_usdt: Math.min(0, parseFloat(v) || 0) })
              }
            />
            <Field
              label="Cooldown after extreme loss (min, 0=off)"
              value={form.extreme_loss_cooldown_min}
              onChange={(v) =>
                setForm({ ...form, extreme_loss_cooldown_min: Math.max(0, parseInt(v) || 0) })
              }
            />
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            After any single fill realizes a loss at or below the threshold, new grid entries for
            this symbol pause for the cooldown window. Existing positions still exit normally.
          </p>
        </div>

        <div className="bg-muted/30 mt-4 rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <Label htmlFor={`trend-${s.symbol}`} className="text-sm font-medium">
                Trend filter (don't fight the trend)
              </Label>
              <p className="text-muted-foreground text-xs">
                Skips SELL entries in uptrends and BUY entries in downtrends, based on EMA over
                higher-TF candles. Exits for existing positions still run.
              </p>
            </div>
            <Switch
              id={`trend-${s.symbol}`}
              checked={form.trend_filter_enabled}
              onCheckedChange={(v) => setForm({ ...form, trend_filter_enabled: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field
              label="EMA period"
              value={form.trend_ema_period}
              onChange={(v) =>
                setForm({
                  ...form,
                  trend_ema_period: Math.max(5, Math.min(500, parseInt(v) || 50)),
                })
              }
            />
            <div>
              <Label className="text-xs">Interval</Label>
              <select
                className="border-input bg-background mt-1 h-9 w-full rounded-md border px-2 text-sm"
                value={form.trend_interval}
                onChange={(e) =>
                  setForm({ ...form, trend_interval: e.target.value as typeof form.trend_interval })
                }
              >
                {["15m", "30m", "1h", "2h", "4h", "1d"].map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-muted/30 mt-4 rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <Label htmlFor={`fund-${s.symbol}`} className="text-sm font-medium">
                Funding-rate filter
              </Label>
              <p className="text-muted-foreground text-xs">
                Pauses new entries on the side that pays funding when the perpetual funding rate
                exceeds the threshold (1 bp = 0.01% per 8h). Existing positions and exits aren't
                affected.
              </p>
            </div>
            <Switch
              id={`fund-${s.symbol}`}
              checked={form.funding_filter_enabled}
              onCheckedChange={(v) => setForm({ ...form, funding_filter_enabled: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field
              label="Max |funding| (bps / 8h)"
              value={form.funding_max_abs_bps}
              onChange={(v) =>
                setForm({ ...form, funding_max_abs_bps: Math.max(0, parseFloat(v) || 0) })
              }
            />
          </div>
        </div>

        <div className="bg-muted/30 mt-4 rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <Label htmlFor={`zf-${s.symbol}`} className="text-sm font-medium">
                Z-score mean-reversion filter
              </Label>
              <p className="text-muted-foreground text-xs">
                Pauses new entries unless price is stretched ≥ threshold std-devs from its rolling
                mean. Overbought (z &gt; +T) blocks new BUYs, oversold (z &lt; −T) blocks new SELLs,
                and |z| inside ±T blocks both (no edge).
              </p>
            </div>
            <Switch
              id={`zf-${s.symbol}`}
              checked={form.z_filter_enabled}
              onCheckedChange={(v) => setForm({ ...form, z_filter_enabled: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field
              label="Lookback (candles)"
              value={form.z_lookback}
              onChange={(v) =>
                setForm({ ...form, z_lookback: Math.max(5, Math.min(500, parseInt(v) || 20)) })
              }
            />
            <div>
              <Label className="text-xs">Interval</Label>
              <select
                className="border-input bg-background mt-1 h-9 w-full rounded-md border px-2 text-sm"
                value={form.z_interval}
                onChange={(e) =>
                  setForm({ ...form, z_interval: e.target.value as typeof form.z_interval })
                }
              >
                {["15m", "30m", "1h", "2h", "4h", "1d"].map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="Entry |z| threshold"
              value={form.z_entry_threshold}
              onChange={(v) =>
                setForm({ ...form, z_entry_threshold: Math.max(0, parseFloat(v) || 0) })
              }
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => onSave(form)}>Save</Button>
          <Button
            variant={botRunning && form.enabled ? "secondary" : "default"}
            disabled={!credsReady || startPending || (botRunning && form.enabled)}
            title={!credsReady ? "Save your Binance testnet API keys first" : undefined}
            onClick={() => onTrade(form)}
          >
            <Power className="mr-2 h-4 w-4" />
            {botRunning && form.enabled
              ? "Trading"
              : botRunning
                ? "Enable & trade"
                : "Start this symbol"}
          </Button>

          <Button
            variant="secondary"
            disabled={autoLoading}
            onClick={async () => {
              setAutoLoading(true);
              try {
                await onAutoConfigure();
              } finally {
                setAutoLoading(false);
              }
            }}
          >
            {autoLoading ? "Analyzing market…" : "Auto-configure from market"}
          </Button>
          <Button
            variant="secondary"
            disabled={optLoading}
            onClick={async () => {
              setOptLoading(true);
              try {
                await onOptimize();
              } finally {
                setOptLoading(false);
              }
            }}
          >
            {optLoading ? "Backtesting 60d…" : "Optimize (backtest)"}
          </Button>
          <Button
            variant="secondary"
            disabled={learnLoading}
            onClick={async () => {
              setLearnLoading(true);
              try {
                await onLearn();
              } finally {
                setLearnLoading(false);
              }
            }}
          >
            {learnLoading ? "Learning…" : "Learn from trades now"}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Cancel open orders
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={value as any} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

interface CredsStatus {
  mainnet: boolean;
  testnet: boolean;
}
interface CredsInput {
  api_key?: string;
  api_secret?: string;
  testnet_api_key?: string;
  testnet_api_secret?: string;
}

function BinanceKeysCard({
  credsStatus,
  onSave,
}: {
  credsStatus?: CredsStatus;
  onSave: (vals: CredsInput) => Promise<void>;
}) {
  const [vals, setVals] = useState<CredsInput>({});
  const [saving, setSaving] = useState(false);
  const mainnetSet = credsStatus?.mainnet;
  const testnetSet = credsStatus?.testnet;
  const hasMainnetPair = !!vals.api_key?.trim() && !!vals.api_secret?.trim();
  const hasTestnetPair = !!vals.testnet_api_key?.trim() && !!vals.testnet_api_secret?.trim();
  const hasPartialPair =
    !!vals.api_key?.trim() !== !!vals.api_secret?.trim() ||
    !!vals.testnet_api_key?.trim() !== !!vals.testnet_api_secret?.trim();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Binance API keys</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">
              Testnet API key {testnetSet && <span className="text-green-600">• saved</span>}
            </Label>
            <Input
              placeholder={testnetSet ? "•••••••• (leave blank to keep)" : "Paste testnet API key"}
              value={vals.testnet_api_key ?? ""}
              onChange={(e) => setVals({ ...vals, testnet_api_key: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Testnet API secret</Label>
            <Input
              type="password"
              placeholder={
                testnetSet ? "•••••••• (leave blank to keep)" : "Paste testnet API secret"
              }
              value={vals.testnet_api_secret ?? ""}
              onChange={(e) => setVals({ ...vals, testnet_api_secret: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              Mainnet API key {mainnetSet && <span className="text-green-600">• saved</span>}
            </Label>
            <Input
              placeholder={mainnetSet ? "•••••••• (leave blank to keep)" : "Paste mainnet API key"}
              value={vals.api_key ?? ""}
              onChange={(e) => setVals({ ...vals, api_key: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mainnet API secret</Label>
            <Input
              type="password"
              placeholder={
                mainnetSet ? "•••••••• (leave blank to keep)" : "Paste mainnet API secret"
              }
              value={vals.api_secret ?? ""}
              onChange={(e) => setVals({ ...vals, api_secret: e.target.value })}
            />
          </div>
        </div>
        {hasPartialPair && (
          <p className="text-xs text-destructive">
            Enter both the API key and secret for the same network before saving.
          </p>
        )}
        <Button
          disabled={saving || hasPartialPair || !(hasMainnetPair || hasTestnetPair)}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(vals);
              setVals({});
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save API keys"}
        </Button>
      </CardContent>
    </Card>
  );
}

function BinanceNetworkRouteCard({
  proxyConfigured,
  proxySource,
  serverPublicIp,
  vpnhoodRepoUrl = "https://github.com/vpnhood/vpnhood",
}: {
  proxyConfigured: boolean;
  proxySource?: string | null;
  serverPublicIp?: string | null;
  vpnhoodRepoUrl?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Binance network route</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>VPN/proxy status</Label>
            <p className="text-xs text-muted-foreground">
              Use this when Binance is blocked by the local provider. The bot reads{" "}
              <code>BINANCE_PROXY_URL</code>, then standard <code>HTTPS_PROXY</code>/
              <code>HTTP_PROXY</code>, from the server environment.
            </p>
          </div>
          <Badge variant={proxyConfigured ? "default" : "secondary"}>
            {proxyConfigured ? `Proxy set${proxySource ? ` (${proxySource})` : ""}` : "No proxy"}
          </Badge>
        </div>
        <div className="grid gap-1 rounded-md border bg-muted/20 p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Server/VPN public IP</span>
            <code>{serverPublicIp ?? "unknown"}</code>
          </div>
          <p className="text-muted-foreground">
            If your Binance key has IP restrictions, this is the IP Binance must allow while the VPN
            is on.
          </p>
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          For a VPN route, the VPN must run on the same machine that runs this bot server.
          Browser-only VPN extensions do not affect server-side Binance requests. After turning the
          VPN on or changing proxy variables, restart the server.
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={vpnhoodRepoUrl} target="_blank" rel="noreferrer">
            Open VpnHood GitHub
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function num(v: string | number) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toFixed(6);
}
