import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { num } from "./KpiStrip";

export function PositionsTable({
  positions,
  onClose,
}: {
  positions: any[];
  onClose: (symbol: string) => void;
}) {
  if (positions.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Entry</TableHead>
            <TableHead>Mark</TableHead>
            <TableHead>TP Target</TableHead>
            <TableHead>Liq.</TableHead>
            <TableHead>Margin %</TableHead>
            <TableHead>Gross PnL</TableHead>
            <TableHead>Net PnL</TableHead>
            <TableHead>Funding</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((p: any) => {
            const upnl = parseFloat(p.unrealizedProfit);
            const roi = Number(p.roiPct ?? 0);
            const liq = parseFloat(p.liquidationPrice);
            const mr = Number(p.marginRatioPct ?? 0);
            const netPnl = Number(p.netUnrealizedAfterCloseFee ?? upnl);
            const netRoi = Number(p.netRoiPct ?? roi);
            const fee = Number(p.estFundingFee ?? 0);
            return (
              <TableRow key={p.symbol}>
                <TableCell className="font-mono">
                  {p.symbol}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {p.leverage}x
                  </span>
                </TableCell>
                <TableCell
                  className={parseFloat(p.positionAmt) >= 0 ? "text-green-600" : "text-destructive"}
                >
                  {p.positionAmt}
                </TableCell>
                <TableCell>{num(p.entryPrice)}</TableCell>
                <TableCell>{num(p.markPrice)}</TableCell>
                <TableCell>
                  {p.tpTargetPrice ? (
                    <span className="text-sm">{num(p.tpTargetPrice)}</span>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-destructive">
                  {liq > 0 ? num(liq) : "—"}
                </TableCell>
                <TableCell
                  className={mr >= 80 ? "text-destructive" : mr >= 50 ? "text-yellow-600" : ""}
                >
                  {mr.toFixed(1)}%
                </TableCell>
                <TableCell className={upnl >= 0 ? "text-green-600" : "text-destructive"}>
                  {num(upnl)} ({roi >= 0 ? "+" : ""}{roi.toFixed(1)}%)
                </TableCell>
                <TableCell className={netPnl >= 0 ? "text-green-600" : "text-destructive"}>
                  {num(netPnl)} ({netRoi >= 0 ? "+" : ""}{netRoi.toFixed(1)}%)
                </TableCell>
                <TableCell className={fee >= 0 ? "text-green-600" : "text-destructive"}>
                  {fee >= 0 ? "+" : ""}{fee.toFixed(4)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm(`Market-close ${p.symbol}?`)) onClose(p.symbol);
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
    </div>
  );
}
