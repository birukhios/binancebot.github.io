import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { registerServiceWorker, subscribeToPush, isPushSupported } from "@/lib/push-notifications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar";
import { BarChart3, Coins, History, ScrollText, Settings } from "lucide-react";
import { toast } from "sonner";

import { DashboardHeader } from "./DashboardHeader";
import { OverviewPanel } from "./OverviewPanel";
import { SymbolsPanel } from "./SymbolsPanel";
import { TradesPanel } from "./TradesPanel";
import { LogsPanel } from "./LogsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { useDashboardData, useDashboardMutations } from "@/hooks/use-dashboard-data";

type ThemeMode = "light" | "dark";
type Page = "overview" | "symbols" | "trades" | "logs" | "settings";

type ClientSession = {
  user?: { id?: string; email?: string };
} | null;

async function fetchClientSession(): Promise<ClientSession> {
  const res = await fetch("/api/session", { credentials: "include" });
  if (!res.ok) throw new Error("Could not check sign-in status.");
  return res.json();
}

const NAV_ITEMS: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "symbols", label: "Symbols", icon: Coins },
  { id: "trades", label: "Trades", icon: History },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "settings", label: "Settings", icon: Settings },
];

export function DashboardShell() {
  const qc = useQueryClient();
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("kelay-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    window.localStorage.setItem("kelay-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!isPushSupported()) return;
    registerServiceWorker().then((reg) => {
      if (reg) subscribeToPush(reg).catch(() => {});
    });
  }, []);

  const session = useQuery({
    queryKey: ["auth-session"],
    queryFn: fetchClientSession,
    retry: false,
  });
  const sessionUserId = session.data?.user?.id ?? null;

  useEffect(() => {
    if (session.isSuccess && !sessionUserId) qc.clear();
  }, [qc, session.isSuccess, sessionUserId]);

  const { dash, news, logs, tradesFn, invalidate } = useDashboardData(sessionUserId);
  const mutations = useDashboardMutations(sessionUserId);

  const [activePage, setActivePage] = useState<Page>("overview");

  const cfg = dash.data?.cfg;
  const positions = dash.data?.positions ?? [];
  const openOrders = dash.data?.openOrders ?? [];
  const symbols = dash.data?.symbols ?? [];
  const credsStatus = dash.data?.credsStatus;
  const credsReady = cfg?.testnet ? !!credsStatus?.testnet : !!credsStatus?.mainnet;
  const isTestnet = cfg?.testnet ?? true;
  const entryPauseUntil = cfg?.entry_pause_until_iso ? Date.parse(String(cfg.entry_pause_until_iso)) : 0;
  const entryPauseActive = Number.isFinite(entryPauseUntil) && entryPauseUntil > Date.now();
  const isDashRefreshing = dash.isFetching && !!dash.data;

  // If creds not ready, default to settings
  useEffect(() => {
    if (dash.data && !credsReady && activePage === "overview") {
      setActivePage("settings");
    }
  }, [dash.data, credsReady, activePage]);

  if (session.isLoading || !sessionUserId) return null;

  if (dash.isError) {
    const message = dash.error instanceof Error ? dash.error.message : "Dashboard could not load.";
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-xl border-destructive">
          <CardHeader><CardTitle>Dashboard setup required</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{message}</pre>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => dash.refetch()}>Try again</Button>
              <Button variant="ghost" onClick={async () => {
                await qc.cancelQueries(); qc.clear();
                await authClient.signOut(); window.location.reload();
              }}>Sign out</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (dash.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-xl">
          <CardHeader><CardTitle>Connecting to Binance</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Waiting on Binance data. If blocked, enable VPN then reload.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader className="p-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
            BKbot
          </span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={activePage === item.id}
                      onClick={() => setActivePage(item.id)}
                      tooltip={item.label}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <DashboardHeader
          cfg={cfg}
          isTestnet={isTestnet}
          credsReady={credsReady}
          email={session.data?.user?.email}
          entryPauseActive={entryPauseActive}
          entryPauseUntil={entryPauseUntil}
          marketSession={dash.data?.marketSession}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          onStartStop={() => mutations.startStopMut.mutate(!cfg?.is_running)}
          startStopPending={mutations.startStopMut.isPending}
          onKill={() => {
            if (confirm("Stop bot AND cancel all open orders?")) mutations.killMut.mutate();
          }}
          onTestConnection={() => mutations.testConnMut.mutate()}
          testConnPending={mutations.testConnMut.isPending}
          onSignOut={async () => {
            await qc.cancelQueries(); qc.clear();
            await authClient.signOut(); window.location.reload();
          }}
        />

        <main className="flex-1 p-2 sm:p-4 md:p-6">
          <div className="mx-auto max-w-7xl">
            {!credsReady && (
              <div className="mb-4 rounded-md border border-orange-500/60 bg-orange-500/10 p-3 text-sm">
                <strong>Setup required:</strong> Add your Binance {isTestnet ? "testnet" : "mainnet"} API keys in Settings.
              </div>
            )}

            {dash.data?.error && (
              <div className="mb-4 rounded-md border border-orange-500/60 bg-orange-500/10 p-3 text-sm">
                <strong>Binance network blocked:</strong> {dash.data.error}
              </div>
            )}

            {activePage === "overview" && (
              <OverviewPanel
                dash={dash.data}
                isDashRefreshing={isDashRefreshing}
                positions={positions}
                openOrders={openOrders}
                onClosePosition={async (symbol) => {
                  try {
                    await mutations.closePos({ data: { symbol } });
                    toast.success("Closed");
                    invalidate();
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              />
            )}

            {activePage === "symbols" && (
              <SymbolsPanel
                symbols={symbols}
                trendBias={dash.data?.trendBias ?? {}}
                cfg={cfg}
                credsReady={credsReady}
                startPending={mutations.startStopMut.isPending}
                updSym={mutations.updSym}
                startStop={mutations.startStop}
                optimizeFn={mutations.optimizeFn}
                cancelOrders={mutations.cancelOrders}
                autoConfigFn={mutations.autoConfigFn}
                learnFn={mutations.learnFn}
                invalidate={invalidate}
              />
            )}

            {activePage === "trades" && (
              <TradesPanel
                sessionUserId={sessionUserId}
                symbols={symbols}
                tradesFn={tradesFn}
              />
            )}

            {activePage === "logs" && (
              <LogsPanel logs={logs.data ?? []} />
            )}

            {activePage === "settings" && (
              <SettingsPanel
                cfg={cfg}
                dash={dash.data}
                news={news.data}
                mutations={{
                  toggleEnvironment: mutations.toggleEnvironment,
                  applyHighRiskFn: mutations.applyHighRiskFn,
                  setIntelligenceFn: mutations.setIntelligenceFn,
                  maxExp: mutations.maxExp,
                  runAutoSelectFn: mutations.runAutoSelectFn,
                  saveCredsFn: mutations.saveCredsFn,
                  invalidate,
                  qc: mutations.qc,
                }}
              />
            )}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
