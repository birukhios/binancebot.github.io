import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Power } from "lucide-react";

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

function FilterSection({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="mt-3 rounded-md border bg-muted/30 p-3">
        <CollapsibleTrigger className="flex w-full items-center justify-between">
          <div className="text-left">
            <span className="text-sm font-medium">{title}</span>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">{children}</CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function SymbolCard({
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
    min_order_size_usdt: Number(s.min_order_size_usdt ?? (s.symbol === "BTCUSDT" ? 5 : 50)),
    max_order_size_usdt: Number(s.max_order_size_usdt ?? (s.symbol === "BTCUSDT" ? 10 : 150)),
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
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="font-mono text-base">{s.symbol}</CardTitle>
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
            >
              {bias === "up" ? "↑ Long only" : bias === "down" ? "↓ Short only" : "↔ Flat"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`en-${s.symbol}`} className="text-sm">Enabled</Label>
          <Switch
            id={`en-${s.symbol}`}
            checked={form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-0">
        {s.backtest_at && (
          <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
            <Badge variant="outline" className="font-mono">PnL: {Number(s.backtest_pnl).toFixed(2)}</Badge>
            <Badge variant="outline" className="font-mono">Return: {Number(s.backtest_return_pct).toFixed(1)}%</Badge>
            <Badge variant="outline" className="font-mono">DD: {Number(s.backtest_max_drawdown).toFixed(2)}</Badge>
            <Badge variant="outline" className="font-mono">Fills: {s.backtest_fills}</Badge>
            <span className="self-center text-muted-foreground">
              {Math.round((Date.now() - new Date(s.backtest_at).getTime()) / 3600000)}h ago
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Field label="Levels" value={form.grid_levels} onChange={(v) => setForm({ ...form, grid_levels: parseInt(v) || 1 })} />
          <Field label="Spacing %" value={form.grid_spacing_pct} onChange={(v) => setForm({ ...form, grid_spacing_pct: parseFloat(v) || 0.1 })} />
          <Field label="Size (USDT)" value={form.order_size_usdt} onChange={(v) => setForm({ ...form, order_size_usdt: parseFloat(v) || 5 })} />
          <Field label="Leverage" value={form.leverage} onChange={(v) => setForm({ ...form, leverage: parseInt(v) || 1 })} />
          <Field label="Lower bound" value={form.lower_bound ?? ""} onChange={(v) => setForm({ ...form, lower_bound: v === "" ? null : parseFloat(v) })} />
          <Field label="Upper bound" value={form.upper_bound ?? ""} onChange={(v) => setForm({ ...form, upper_bound: v === "" ? null : parseFloat(v) })} />
        </div>

        <FilterSection title="Auto-tune" description="Adjust spacing & size from recent fills">
          <div className="flex items-center justify-end mb-2">
            <Switch
              id={`auto-${s.symbol}`}
              checked={form.auto_tune}
              onCheckedChange={(v) => setForm({ ...form, auto_tune: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Min spacing %" value={form.min_spacing_pct} onChange={(v) => setForm({ ...form, min_spacing_pct: parseFloat(v) || 0.1 })} />
            <Field label="Max spacing %" value={form.max_spacing_pct} onChange={(v) => setForm({ ...form, max_spacing_pct: parseFloat(v) || 5 })} />
            <Field label="Min size" value={form.min_order_size_usdt} onChange={(v) => setForm({ ...form, min_order_size_usdt: parseFloat(v) || 5 })} />
            <Field label="Max size" value={form.max_order_size_usdt} onChange={(v) => setForm({ ...form, max_order_size_usdt: parseFloat(v) || 500 })} />
          </div>
          {s.learning_notes && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              Last learn{s.last_learned_at ? ` (${new Date(s.last_learned_at).toLocaleString()})` : ""}: {s.learning_notes}
            </p>
          )}
        </FilterSection>

        <FilterSection title="Position monitoring" description="Stop-loss, max age, extreme loss cooldown">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Stop-loss ROI %" value={form.stop_loss_roi_pct} onChange={(v) => setForm({ ...form, stop_loss_roi_pct: Math.min(0, parseFloat(v) || 0) })} />
            <Field label="Max age (min)" value={form.max_position_age_minutes} onChange={(v) => setForm({ ...form, max_position_age_minutes: Math.max(0, parseInt(v) || 0) })} />
            <Field label="Extreme loss (USDT)" value={form.extreme_loss_threshold_usdt} onChange={(v) => setForm({ ...form, extreme_loss_threshold_usdt: Math.min(0, parseFloat(v) || 0) })} />
            <Field label="Cooldown (min)" value={form.extreme_loss_cooldown_min} onChange={(v) => setForm({ ...form, extreme_loss_cooldown_min: Math.max(0, parseInt(v) || 0) })} />
          </div>
        </FilterSection>

        <FilterSection title="Trend filter" description="Skip entries against the trend">
          <div className="flex items-center justify-end mb-2">
            <Switch
              id={`trend-${s.symbol}`}
              checked={form.trend_filter_enabled}
              onCheckedChange={(v) => setForm({ ...form, trend_filter_enabled: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="EMA period" value={form.trend_ema_period} onChange={(v) => setForm({ ...form, trend_ema_period: Math.max(5, Math.min(500, parseInt(v) || 50)) })} />
            <div>
              <Label className="text-xs">Interval</Label>
              <select
                className="border-input bg-background mt-1 h-9 w-full rounded-md border px-2 text-sm"
                value={form.trend_interval}
                onChange={(e) => setForm({ ...form, trend_interval: e.target.value as typeof form.trend_interval })}
              >
                {["15m", "30m", "1h", "2h", "4h", "1d"].map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
          </div>
        </FilterSection>

        <FilterSection title="Funding-rate filter" description="Pause entries when funding is expensive">
          <div className="flex items-center justify-end mb-2">
            <Switch
              id={`fund-${s.symbol}`}
              checked={form.funding_filter_enabled}
              onCheckedChange={(v) => setForm({ ...form, funding_filter_enabled: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max |funding| (bps/8h)" value={form.funding_max_abs_bps} onChange={(v) => setForm({ ...form, funding_max_abs_bps: Math.max(0, parseFloat(v) || 0) })} />
          </div>
        </FilterSection>

        <FilterSection title="Z-score filter" description="Pause entries unless price is stretched from its mean">
          <div className="flex items-center justify-end mb-2">
            <Switch
              id={`zf-${s.symbol}`}
              checked={form.z_filter_enabled}
              onCheckedChange={(v) => setForm({ ...form, z_filter_enabled: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Lookback" value={form.z_lookback} onChange={(v) => setForm({ ...form, z_lookback: Math.max(5, Math.min(500, parseInt(v) || 20)) })} />
            <div>
              <Label className="text-xs">Interval</Label>
              <select
                className="border-input bg-background mt-1 h-9 w-full rounded-md border px-2 text-sm"
                value={form.z_interval}
                onChange={(e) => setForm({ ...form, z_interval: e.target.value as typeof form.z_interval })}
              >
                {["15m", "30m", "1h", "2h", "4h", "1d"].map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
            <Field label="|z| threshold" value={form.z_entry_threshold} onChange={(v) => setForm({ ...form, z_entry_threshold: Math.max(0, parseFloat(v) || 0) })} />
          </div>
        </FilterSection>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onSave(form)}>Save</Button>
          <Button
            size="sm"
            variant={botRunning && form.enabled ? "secondary" : "default"}
            disabled={!credsReady || startPending || (botRunning && form.enabled)}
            onClick={() => onTrade(form)}
          >
            <Power className="mr-1.5 h-3.5 w-3.5" />
            {botRunning && form.enabled ? "Trading" : botRunning ? "Enable" : "Start"}
          </Button>
          <Button size="sm" variant="secondary" disabled={autoLoading} onClick={async () => { setAutoLoading(true); try { await onAutoConfigure(); } finally { setAutoLoading(false); } }}>
            {autoLoading ? "Analyzing…" : "Auto-config"}
          </Button>
          <Button size="sm" variant="secondary" disabled={optLoading} onClick={async () => { setOptLoading(true); try { await onOptimize(); } finally { setOptLoading(false); } }}>
            {optLoading ? "Backtesting…" : "Optimize"}
          </Button>
          <Button size="sm" variant="secondary" disabled={learnLoading} onClick={async () => { setLearnLoading(true); try { await onLearn(); } finally { setLearnLoading(false); } }}>
            {learnLoading ? "Learning…" : "Learn"}
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>Cancel orders</Button>
        </div>
      </CardContent>
    </Card>
  );
}
