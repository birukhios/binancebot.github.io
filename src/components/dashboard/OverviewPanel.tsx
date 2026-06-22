import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KpiStrip } from "./KpiStrip";
import { PositionsTable } from "./PositionsTable";
import { OrdersTable } from "./OrdersTable";

export function OverviewPanel({
  dash,
  isDashRefreshing,
  positions,
  openOrders,
  onClosePosition,
}: {
  dash: any;
  isDashRefreshing: boolean;
  positions: any[];
  openOrders: any[];
  onClosePosition: (symbol: string) => void;
}) {
  const account = dash?.account;
  const grossUnrealized = positions.reduce(
    (sum: number, p: any) => sum + Number(p.unrealizedProfit ?? 0), 0,
  );
  const netUnrealized = positions.reduce(
    (sum: number, p: any) => sum + Number(p.netUnrealizedAfterCloseFee ?? p.unrealizedProfit ?? 0), 0,
  );
  const estCloseFees = positions.reduce(
    (sum: number, p: any) => sum + Number(p.estCloseFeeUsdt ?? 0), 0,
  );
  const estOpenOrderFees = openOrders.reduce(
    (sum: number, o: any) => sum + Number(o.estMakerFeeUsdt ?? 0), 0,
  );

  return (
    <div className="space-y-4">
      <KpiStrip
        account={account}
        grossUnrealized={grossUnrealized}
        netUnrealized={netUnrealized}
        realizedToday={dash?.realizedToday ?? 0}
        estFees={estCloseFees + estOpenOrderFees}
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Open Positions</CardTitle>
            {isDashRefreshing && (
              <Badge variant="outline" className="text-xs">Refreshing</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {openOrders.length > 0
                ? "No filled positions yet. Grid orders are active below."
                : "No open positions."}
            </p>
          ) : (
            <PositionsTable positions={positions} onClose={onClosePosition} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Grid Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <OrdersTable openOrders={openOrders} snapshotAt={dash?.snapshotAt ?? null} />
        </CardContent>
      </Card>
    </div>
  );
}
