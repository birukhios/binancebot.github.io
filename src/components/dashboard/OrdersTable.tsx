import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { num } from "./KpiStrip";

export function OrdersTable({
  openOrders,
  snapshotAt,
}: {
  openOrders: any[];
  snapshotAt: string | null;
}) {
  if (openOrders.length === 0) {
    return <p className="text-sm text-muted-foreground">No open grid orders.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{openOrders.length} live order{openOrders.length === 1 ? "" : "s"}</span>
        <span>
          Sync: {snapshotAt ? new Date(snapshotAt).toLocaleTimeString() : "—"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Notional</TableHead>
              <TableHead>Est. Fee</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {openOrders.map((o: any) => (
              <TableRow key={`${o.symbol}-${o.orderId}`}>
                <TableCell className="font-mono">{o.symbol}</TableCell>
                <TableCell className={o.side === "BUY" ? "text-green-600" : "text-destructive"}>
                  {o.side}
                </TableCell>
                <TableCell>{num(o.price)}</TableCell>
                <TableCell>{num(o.origQty)}</TableCell>
                <TableCell>{num(o.notional)} USDT</TableCell>
                <TableCell className="text-muted-foreground">{num(o.estMakerFeeUsdt ?? 0)}</TableCell>
                <TableCell>{o.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
