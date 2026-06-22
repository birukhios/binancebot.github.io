import { Card, CardContent } from "@/components/ui/card";

function num(v: string | number) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toFixed(6);
}

export { num };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3 sm:pt-5 sm:pb-4">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</p>
        <p className="mt-0.5 text-sm font-semibold tabular-nums sm:mt-1 sm:text-lg">{value}</p>
      </CardContent>
    </Card>
  );
}

function pnlColor(v: number) {
  if (v > 0) return "text-green-500";
  if (v < 0) return "text-red-500";
  return "";
}

export { pnlColor };

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
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
      <Stat
        label="Wallet balance"
        value={account?.totalWalletBalance ? `${num(account.totalWalletBalance)} USDT` : "—"}
      />
      <Stat label="Gross P&L" value={`${num(grossUnrealized)} USDT`} />
      <Stat label="Net if closed" value={`${num(netUnrealized)} USDT`} />
      <Card>
        <CardContent className="p-3 sm:pt-5 sm:pb-4">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">Realized today</p>
          <p className={`mt-0.5 text-sm font-semibold tabular-nums sm:mt-1 sm:text-lg ${pnlColor(realizedToday)}`}>
            {realizedToday.toFixed(4)} USDT
          </p>
        </CardContent>
      </Card>
      <Stat label="Est. fees" value={`${num(estFees)} USDT`} />
    </div>
  );
}
