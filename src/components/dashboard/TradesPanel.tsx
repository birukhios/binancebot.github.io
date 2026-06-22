import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useTradesQuery } from "@/hooks/use-dashboard-data";
import { num } from "./KpiStrip";

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

  useEffect(() => { setPage(1); }, [symbol, side, pageSize]);

  const trades = useTradesQuery(sessionUserId, tradesFn, { symbol, side, page, pageSize });
  const rows = trades.data?.items ?? [];
  const meta = trades.data ?? null;
  const start = meta && meta.total > 0 ? (meta.page - 1) * meta.pageSize + 1 : 0;
  const end = meta ? start + rows.length - 1 : 0;

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Symbol</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All" /></SelectTrigger>
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
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="BUY">BUY</SelectItem>
                <SelectItem value="SELL">SELL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Per page</Label>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[10, 20, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto text-right text-xs text-muted-foreground">
            {meta?.total ?? 0} trade{(meta?.total ?? 0) === 1 ? "" : "s"}
            {meta?.total ? ` · ${start}–${end}` : ""}
          </div>
        </div>

        <div className="overflow-x-auto">
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
                    <TableCell className="font-mono text-xs">
                      {new Date(t.filled_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono">{t.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={t.side === "BUY" ? "default" : "secondary"}>{t.side}</Badge>
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
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No trades match the current filters
                  </TableCell>
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
            <Button
              variant="outline" size="sm"
              disabled={(meta?.page ?? 1) <= 1 || trades.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >Prev</Button>
            <Button
              variant="outline" size="sm"
              disabled={(meta?.page ?? 1) >= (meta?.totalPages ?? 1) || trades.isFetching}
              onClick={() => setPage((p) => Math.min(meta?.totalPages ?? 1, p + 1))}
            >Next</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
