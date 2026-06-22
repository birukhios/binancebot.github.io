import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { SymbolCard } from "./SymbolCard";

export function SymbolsPanel({
  symbols,
  trendBias,
  cfg,
  credsReady,
  startPending,
  updSym,
  startStop,
  optimizeFn,
  cancelOrders,
  autoConfigFn,
  learnFn,
  invalidate,
}: {
  symbols: any[];
  trendBias: Record<string, "up" | "down" | "flat" | null>;
  cfg: any;
  credsReady: boolean;
  startPending: boolean;
  updSym: any;
  startStop: any;
  optimizeFn: any;
  cancelOrders: any;
  autoConfigFn: any;
  learnFn: any;
  invalidate: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Symbols:</span>
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
          bias={trendBias[s.symbol] ?? null}
          botRunning={!!cfg?.is_running}
          credsReady={credsReady}
          startPending={startPending}
          onSave={async (next) => {
            await updSym({ data: next });
            toast.success(`${s.symbol} updated`);
            invalidate();
          }}
          onTrade={async (next) => {
            toast.info(`Studying ${s.symbol}…`);
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
                `Optimized (${r.daysAnalyzed}d): ${b.gridLevels}×${b.spacingPct}% ${b.leverage}x → ${b.realizedPnl} USDT, ${b.fills} fills`,
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
    </div>
  );
}
