import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BinanceKeysCard } from "./BinanceKeysCard";
import { BinanceNetworkCard } from "./BinanceNetworkCard";

export function SettingsPanel({
  cfg,
  dash,
  news,
  mutations,
}: {
  cfg: any;
  dash: any;
  news: any;
  mutations: {
    toggleEnvironment: (checked: boolean) => void;
    applyHighRiskFn: any;
    setIntelligenceFn: any;
    maxExp: any;
    runAutoSelectFn: any;
    saveCredsFn: any;
    invalidate: () => void;
    qc: any;
  };
}) {
  const isTestnet = cfg?.testnet ?? true;
  const environmentLabel = isTestnet ? "TESTNET" : "LIVE";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Global Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label>Trading mode</Label>
              <p className="text-xs text-muted-foreground">
                Currently {environmentLabel}. Switching stops the bot.
              </p>
            </div>
            <Switch
              checked={cfg?.testnet ?? true}
              onCheckedChange={mutations.toggleEnvironment}
            />
          </div>

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
            <Label className="text-sm">Paper high-risk profile</Label>
            <p className="text-xs text-muted-foreground">
              TESTNET only, higher leverage, tighter grids, hard kill switches.
            </p>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                await mutations.applyHighRiskFn();
                toast.success("Paper high-risk profile applied");
                mutations.invalidate();
              }}
            >
              Apply profile
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Max open trades</Label>
              <Input
                type="number" min={1} max={4}
                defaultValue={cfg?.max_open_trades ?? (cfg?.testnet ? 4 : 1)}
                onBlur={async (e) => {
                  const v = parseInt(e.target.value);
                  if (v >= 1 && v <= 4) {
                    await mutations.setIntelligenceFn({ data: { max_open_trades: v } });
                    toast.success("Saved");
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max total notional (USDT)</Label>
              <Input
                type="number"
                defaultValue={cfg?.max_total_notional_usdt}
                onBlur={async (e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) {
                    await mutations.maxExp({ data: { max: v } });
                    toast.success("Saved");
                  }
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Intelligence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Auto-select symbols</Label>
            <Switch
              checked={(cfg as any)?.auto_select_enabled ?? false}
              onCheckedChange={async (c) => {
                await mutations.setIntelligenceFn({ data: { auto_select_enabled: c } });
                mutations.invalidate();
              }}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Max auto symbols</Label>
              <Input
                type="number" min={1} max={15}
                defaultValue={(cfg as any)?.auto_select_max_symbols ?? 4}
                onBlur={async (e) => {
                  const v = parseInt(e.target.value);
                  if (v >= 1 && v <= 15) {
                    await mutations.setIntelligenceFn({ data: { auto_select_max_symbols: v } });
                    toast.success("Saved");
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Drawdown pause % (24h)</Label>
              <Input
                type="number" min={0} max={50} step={0.5}
                defaultValue={(cfg as any)?.drawdown_pause_pct ?? 3}
                onBlur={async (e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) {
                    await mutations.setIntelligenceFn({ data: { drawdown_pause_pct: v } });
                    toast.success("Saved");
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Auto-stops if 24h P&L drops below -this % of wallet.
              </p>
            </div>
          </div>
          <Button
            variant="outline" size="sm"
            onClick={async () => {
              const r = await mutations.runAutoSelectFn({ data: undefined as any });
              toast.success(`Picked: ${(r as any).top?.map((t: any) => t.symbol).join(", ") ?? "n/a"}`);
              mutations.invalidate();
            }}
          >
            Run ranking now
          </Button>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">News-aware pause</Label>
                <p className="text-xs text-muted-foreground">
                  Skip entries around high-impact events.
                </p>
              </div>
              <Switch
                checked={(cfg as any)?.news_pause_enabled ?? true}
                onCheckedChange={async (c) => {
                  await mutations.setIntelligenceFn({ data: { news_pause_enabled: c } });
                  mutations.invalidate();
                  mutations.qc.invalidateQueries({ queryKey: ["news"] });
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Window (min)</Label>
                <Input
                  type="number" min={0} max={240} step={5}
                  defaultValue={(cfg as any)?.news_pause_window_min ?? 30}
                  onBlur={async (e) => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v >= 0 && v <= 240) {
                      await mutations.setIntelligenceFn({ data: { news_pause_window_min: v } });
                      toast.success("Saved");
                      mutations.qc.invalidateQueries({ queryKey: ["news"] });
                    }
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Currencies</Label>
                <Input
                  placeholder="USD,EUR"
                  defaultValue={(cfg as any)?.news_currencies ?? "USD"}
                  onBlur={async (e) => {
                    const v = e.target.value.trim();
                    if (v) {
                      await mutations.setIntelligenceFn({ data: { news_currencies: v } });
                      toast.success("Saved");
                      mutations.qc.invalidateQueries({ queryKey: ["news"] });
                    }
                  }}
                />
              </div>
            </div>
            {news?.enabled &&
              (news.active && news.event ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <Badge variant="destructive" className="mb-1">News blackout</Badge>
                  <div>{news.event.country} · {news.event.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {news.event.minutesUntil > 0
                      ? `in ${news.event.minutesUntil} min`
                      : `${Math.abs(news.event.minutesUntil)} min ago`}
                  </div>
                </div>
              ) : news.next ? (
                <div className="text-xs text-muted-foreground">
                  Next: {news.next.country} {news.next.title} in {news.next.minutesUntil} min
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No upcoming events.</div>
              ))}
          </div>
        </CardContent>
      </Card>

      <BinanceKeysCard
        credsStatus={dash?.credsStatus}
        onSave={async (vals) => {
          await mutations.saveCredsFn({ data: vals });
          toast.success("API keys saved");
          mutations.invalidate();
        }}
      />
      <BinanceNetworkCard
        proxyConfigured={!!dash?.binanceNetworkRoute?.proxyConfigured}
        proxySource={dash?.binanceNetworkRoute?.proxySource}
        serverPublicIp={dash?.binanceNetworkRoute?.serverPublicIp}
        vpnhoodRepoUrl={dash?.binanceNetworkRoute?.vpnhoodRepoUrl}
      />
      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        Keys are stored on the server and never sent to the browser.
      </div>
    </div>
  );
}
