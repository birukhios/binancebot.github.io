import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRealizedPnlHistory } from "@/lib/bot/bot.functions";

function num(v: string | number) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toFixed(6);
}

export { num };

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

type DatePreset = "today" | "yesterday" | "7d" | "30d" | "custom";

function getPresetRange(preset: DatePreset): { start: number; end: number } {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  switch (preset) {
    case "today":
      return { start: todayStart.getTime(), end: now.getTime() };
    case "yesterday": {
      const ydStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
      return { start: ydStart.getTime(), end: todayStart.getTime() };
    }
    case "7d":
      return { start: now.getTime() - 7 * 24 * 60 * 60 * 1000, end: now.getTime() };
    case "30d":
      return { start: now.getTime() - 30 * 24 * 60 * 60 * 1000, end: now.getTime() };
    default:
      return { start: todayStart.getTime(), end: now.getTime() };
  }
}

function toDateInputValue(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function RealizedPnlCard({ realizedToday }: { realizedToday: number }) {
  const [expanded, setExpanded] = useState(false);
  const [preset, setPreset] = useState<DatePreset>("today");
  const [customStart, setCustomStart] = useState(() => toDateInputValue(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [customEnd, setCustomEnd] = useState(() => toDateInputValue(Date.now()));

  const realizedFn = useServerFn(getRealizedPnlHistory);

  const range =
    preset === "custom"
      ? { start: new Date(customStart).getTime(), end: new Date(customEnd).getTime() + 24 * 60 * 60 * 1000 - 1 }
      : getPresetRange(preset);

  const isToday = preset === "today";

  const history = useQuery({
    queryKey: ["realized-pnl", preset, range.start, range.end],
    queryFn: () => realizedFn({ data: { startTime: range.start, endTime: range.end } }),
    enabled: expanded && !isToday,
    retry: false,
    staleTime: 30_000,
  });

  const displayValue = isToday
    ? realizedToday
    : history.data?.total ?? null;

  const presets: { id: DatePreset; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "yesterday", label: "Yesterday" },
    { id: "7d", label: "7D" },
    { id: "30d", label: "30D" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Realized {preset === "today" ? "today" : preset === "custom" ? "custom" : preset}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-xs"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "×" : "Filter"}
          </Button>
        </div>
        <p className={`mt-1 text-lg font-semibold tabular-nums ${displayValue !== null && displayValue < 0 ? "text-red-500" : displayValue !== null && displayValue > 0 ? "text-green-500" : ""}`}>
          {displayValue !== null ? `${displayValue.toFixed(4)} USDT` : history.isFetching ? "Loading..." : "—"}
        </p>

        {expanded && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1">
              {presets.map((p) => (
                <Button
                  key={p.id}
                  variant={preset === p.id ? "default" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setPreset(p.id)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-7 text-xs"
                />
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
            )}
            {!isToday && history.data?.breakdown && history.data.breakdown.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded border text-xs">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-2 py-1 text-left font-medium">Time</th>
                      <th className="px-2 py-1 text-left font-medium">Type</th>
                      <th className="px-2 py-1 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.data.breakdown.slice(0, 50).map((r: any, i: number) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-2 py-0.5 text-muted-foreground">
                          {new Date(r.time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-2 py-0.5">{r.type.replace(/_/g, " ")}</td>
                        <td className={`px-2 py-0.5 text-right tabular-nums ${r.amount < 0 ? "text-red-500" : "text-green-500"}`}>
                          {r.amount.toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function KpiStrip({
  account,
  grossUnrealized,
  netUnrealized,
  realizedToday,
  estFees,
}: {
  account: any;
  grossUnrealized: number;
  netUnrealized: number;
  realizedToday: number;
  estFees: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat
        label="Wallet balance"
        value={account?.totalWalletBalance ? `${num(account.totalWalletBalance)} USDT` : "—"}
      />
      <Stat label="Gross P&L" value={`${num(grossUnrealized)} USDT`} />
      <Stat label="Net if closed" value={`${num(netUnrealized)} USDT`} />
      <RealizedPnlCard realizedToday={realizedToday} />
      <Stat label="Est. fees" value={`${num(estFees)} USDT`} />
    </div>
  );
}
