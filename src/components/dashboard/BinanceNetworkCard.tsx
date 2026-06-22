import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

export function BinanceNetworkCard({
  proxyConfigured,
  proxySource,
  serverPublicIp,
  vpnhoodRepoUrl = "https://github.com/vpnhood/vpnhood",
}: {
  proxyConfigured: boolean;
  proxySource?: string | null;
  serverPublicIp?: string | null;
  vpnhoodRepoUrl?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Network Route</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>VPN/proxy status</Label>
            <p className="text-xs text-muted-foreground">
              Reads <code>BINANCE_PROXY_URL</code> or <code>HTTPS_PROXY</code> from env.
            </p>
          </div>
          <Badge variant={proxyConfigured ? "default" : "secondary"}>
            {proxyConfigured ? `Proxy${proxySource ? ` (${proxySource})` : ""}` : "No proxy"}
          </Badge>
        </div>
        <div className="rounded-md border bg-muted/20 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Server public IP</span>
            <code>{serverPublicIp ?? "unknown"}</code>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={vpnhoodRepoUrl} target="_blank" rel="noreferrer">VpnHood GitHub</a>
        </Button>
      </CardContent>
    </Card>
  );
}
