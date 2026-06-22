import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRealizedPnlHistory } from "@/lib/bot/bot.functions";
import { pnlColor } from "./KpiStrip";

type DatePreset = "today" | "yesterday" | "7d" | "30d" | "custom";

function getPresetRange(preset: DatePreset): { start: number; end: number } {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  switch (preset) {
    case "today":
      return { start: todayStart.getTime(), end: now.getTime() };
    case "yesterday": {
      const ydStart = new Date(todayStart.getTime() - 86400000);
      return { start: ydStart.getTime(), end: todayStart.getTime() };
    }
    case "7d":
      return { start: now.getTime() - 7 * 86400000, end: now.getTime() };
    case "30d":
      return { start: now.getTime() - 30 * 86400000, end: now.getTime() };
    default:
      return { start: todayStart.getTime(), end: now.getTime() };
  }
}

function toDateVal(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
  { id: "custom", label: "Custom" },
];

export function RealizedPnlPanel({ realizedToday }: { realizedToday: number }) {
  const [expanded, setExpanded] = useState(false);
  const [preset, setPreset] = useState<DatePreset>("today");
  const [customStart, setCustomStart] = useState(() => toDateVal(Date.now() - 7 * 86400000));
  const [customEnd, setCustomEnd] = useState(() => toDateVal(Date.now()));

  const realizedFn = useServerFn(getRealizedPnlHistory);

  const range =
    preset === "custom"
      ? { start: new Date(customStart).getTime(), end: new Date(customEnd).getTime() + 86400000 - 1 }
      : getPresetRange(preset);

  const isToday = preset === "today";

  const history = useQuery({
    queryKey: ["realized-pnl", preset, range.start, range.end],
    queryFn: () => realizedFn({ data: { startTime: range.start, endTime: range.end } }),
    enabled: expanded && !isToday,
    retry: false,
    staleTime: 30_000,
  });

  const displayValue = isToday ? realizedToday : history.data?.total ?? null;
  const breakdown = (!isToday ? history.data?.breakdown : null) ?? [];
  const wins = breakdown.filter((r: any) => r.type === "REALIZED_PNL" && r.amount > 0);
  const losses = breakdown.filter((r: any) => r.type === "REALIZED_PNL" && r.amount < 0);
  const totalFees = breakdown.filter((r: any) => r.type === "COMMISSION").reduce((s: number, r: any) => s + r.amount, 0);
  const totalFunding = breakdown.filter((r: any) => r.type === "FUNDING_FEE").reduce((s: number, r: any) => s + r.amount, 0);

  if (!expanded) {
    return (
      <Button variant="outline" size="sm" className="w-full" onClick={() => setExpanded(true)}>
        View Realized PnL History
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Realized PnL</CardTitle>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded(false)}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Preset buttons + custom date */}
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              variant={preset === p.id ? "default" : "outline"}
              size="sm"
              className="h-8"
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </Button>
          ))}
          {preset === "custom" && (
            <>
              <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="h-8 w-36 text-xs" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="h-8 w-36 text-xs" />
            </>
          )}
        </div>

        {/* Total */}
        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="text-xs uppercase text-muted-foreground">
            Total realized {isToday ? "today" : preset === "custom" ? `${customStart} — ${customEnd}` : preset}
          </p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${displayValue !== null ? pnlColor(displayValue) : ""}`}>
            {displayValue !== null
              ? `${displayValue >= 0 ? "+" : ""}${displayValue.toFixed(4)} USDT`
              : history.isFetching
                ? "Loading..."
                : "—"}
          </p>
        </div>

        {/* Summary stats */}
        {breakdown.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-md border p-2.5 text-center">
              <p className="text-[10px] uppercase text-muted-foreground">Wins</p>
              <p className="text-lg font-semibold text-green-500">{wins.length}</p>
              <p className="text-xs text-green-500">+{wins.reduce((s: number, r: any) => s + r.amount, 0).toFixed(2)}</p>
            </div>
            <div className="rounded-md border p-2.5 text-center">
              <p className="text-[10px] uppercase text-muted-foreground">Losses</p>
              <p className="text-lg font-semibold text-red-500">{losses.length}</p>
              <p className="text-xs text-red-500">{losses.reduce((s: number, r: any) => s + r.amount, 0).toFixed(2)}</p>
            </div>
            <div className="rounded-md border p-2.5 text-center">
              <p className="text-[10px] uppercase text-muted-foreground">Win Rate</p>
              <p className="text-lg font-semibold">
                {wins.length + losses.length > 0 ? ((wins.length / (wins.length + losses.length)) * 100).toFixed(0) : 0}%
              </p>
            </div>
            <div className="rounded-md border p-2.5 text-center">
              <p className="text-[10px] uppercase text-muted-foreground">Commissions</p>
              <p className={`text-lg font-semibold ${pnlColor(totalFees)}`}>{totalFees.toFixed(2)}</p>
            </div>
            <div className="rounded-md border p-2.5 text-center">
              <p className="text-[10px] uppercase text-muted-foreground">Funding</p>
              <p className={`text-lg font-semibold ${pnlColor(totalFunding)}`}>{totalFunding.toFixed(2)}</p>
            </div>
          </div>
        )}

        {/* Detail table */}
        {breakdown.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Symbol</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Type</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.slice(0, 200).map((r: any, i: number) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      {new Date(r.time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">{r.symbol}</td>
                    <td className="px-3 py-1.5 text-xs">
                      {r.type === "REALIZED_PNL" ? "Realized" : r.type === "COMMISSION" ? "Commission" : "Funding"}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums text-xs ${pnlColor(r.amount)}`}>
                      {r.amount >= 0 ? "+" : ""}{r.amount.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isToday && breakdown.length === 0 && !history.isFetching && (
          <p className="py-4 text-center text-sm text-muted-foreground">No income records for this period.</p>
        )}
      </CardContent>
    </Card>
  );
}
