import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useTradesQuery } from "@/hooks/use-dashboard-data";
import { num, pnlColor } from "./KpiStrip";

type TradeSide = "all" | "BUY" | "SELL";

export function TradesPanel({
  sessionUserId,
  symbols,
  tradesFn,
}: {
  sessionUserId: string | null;
  symbols: any[];
  tradesFn: any;
}) {
  const [symbol, setSymbol] = useState("all");
  const [side, setSide] = useState<TradeSide>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => { setPage(1); }, [symbol, side, pageSize, startDate, endDate]);

  const trades = useTradesQuery(sessionUserId, tradesFn, {
    symbol, side, page, pageSize,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });
  const rows = trades.data?.items ?? [];
  const meta = trades.data ?? null;
  const start = meta && meta.total > 0 ? (meta.page - 1) * meta.pageSize + 1 : 0;
  const end = meta ? start + rows.length - 1 : 0;

  const totalPnl = rows.reduce((s: number, t: any) => {
    const gross = Number(t.realized_pnl ?? 0);
    const commission = Number(t.commission ?? 0);
    return s + gross - commission;
  }, 0);

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        {/* Filters row */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Symbol</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-full sm:w-36"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All symbols</SelectItem>
                {symbols.map((s: any) => (
                  <SelectItem key={s.symbol} value={s.symbol}>{s.symbol}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Side</Label>
            <Select value={side} onValueChange={(v) => setSide(v as TradeSide)}>
              <SelectTrigger className="w-full sm:w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="BUY">BUY</SelectItem>
                <SelectItem value="SELL">SELL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 w-full text-xs sm:w-36" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 w-full text-xs sm:w-36" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Per page</Label>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="w-full sm:w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[10, 20, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(startDate || endDate) && (
            <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setStartDate(""); setEndDate(""); }}>
              Clear dates
            </Button>
          )}
        </div>

        {/* Summary bar */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/20 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {meta?.total ?? 0} trade{(meta?.total ?? 0) === 1 ? "" : "s"}
            {meta?.total ? ` · showing ${start}–${end}` : ""}
          </span>
          {rows.length > 0 && (
            <span className={`ml-auto font-semibold ${pnlColor(totalPnl)}`}>
              Page net: {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(4)} USDT
            </span>
          )}
        </div>

        {/* Mobile card layout */}
        <div className="space-y-2 md:hidden">
          {rows.map((t: any) => {
            const gross = Number(t.realized_pnl ?? 0);
            const commission = Number(t.commission ?? 0);
            const net = gross - commission;
            return (
              <Card key={t.id}>
                <CardContent className="p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-mono text-xs">{t.symbol}</span>
                    <Badge variant={t.side === "BUY" ? "default" : "secondary"} className="text-[10px]">{t.side}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                    <div className="text-muted-foreground">Time</div>
                    <div className="text-right">{new Date(t.filled_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                    <div className="text-muted-foreground">Price / Qty</div>
                    <div className="text-right">{num(t.price)} / {num(t.qty)}</div>
                    <div className="text-muted-foreground">Gross</div>
                    <div className={`text-right ${pnlColor(gross)}`}>{num(gross)}</div>
                    <div className="text-muted-foreground">Net</div>
                    <div className={`text-right ${pnlColor(net)}`}>{num(net)}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {rows.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No trades match the current filters</p>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Gross PnL</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t: any) => {
                const gross = Number(t.realized_pnl ?? 0);
                const commission = Number(t.commission ?? 0);
                const net = gross - commission;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{new Date(t.filled_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono">{t.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={t.side === "BUY" ? "default" : "secondary"}>{t.side}</Badge>
                    </TableCell>
                    <TableCell>{num(t.price)}</TableCell>
                    <TableCell>{num(t.qty)}</TableCell>
                    <TableCell className={pnlColor(gross)}>{num(gross)}</TableCell>
                    <TableCell className="text-muted-foreground">{num(commission)}</TableCell>
                    <TableCell className={pnlColor(net)}>{num(net)}</TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">No trades match the current filters</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {meta?.page ?? 1} of {meta?.totalPages ?? 1}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={(meta?.page ?? 1) <= 1 || trades.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
            <Button variant="outline" size="sm" disabled={(meta?.page ?? 1) >= (meta?.totalPages ?? 1) || trades.isFetching} onClick={() => setPage((p) => Math.min(meta?.totalPages ?? 1, p + 1))}>Next</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
