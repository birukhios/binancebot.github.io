import { Card, CardContent } from "@/components/ui/card";

export function LogsPanel({ logs }: { logs: any[] }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-5 font-mono text-xs">
        {logs.map((l: any) => (
          <div key={l.id} className="flex gap-2">
            <span className="shrink-0 text-muted-foreground">
              {new Date(l.created_at).toLocaleTimeString()}
            </span>
            <span
              className={
                l.level === "error"
                  ? "text-destructive"
                  : l.level === "warn"
                    ? "text-orange-600"
                    : "text-muted-foreground"
              }
            >
              [{l.level}]
            </span>
            {l.symbol && <span className="text-primary">{l.symbol}</span>}
            <span className="break-all">{l.message}</span>
          </div>
        ))}
        {logs.length === 0 && (
          <p className="text-muted-foreground">No logs yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
