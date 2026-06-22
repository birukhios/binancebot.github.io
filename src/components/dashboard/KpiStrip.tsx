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
      <CardContent className="pt-5 pb-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
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
      <Stat label="Realized today" value={`${realizedToday.toFixed(4)} USDT`} />
      <Stat label="Est. fees" value={`${num(estFees)} USDT`} />
    </div>
  );
}
