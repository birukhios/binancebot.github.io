import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface CredsStatus {
  mainnet: boolean;
  testnet: boolean;
}
interface CredsInput {
  api_key?: string;
  api_secret?: string;
  testnet_api_key?: string;
  testnet_api_secret?: string;
}

export function BinanceKeysCard({
  credsStatus,
  onSave,
}: {
  credsStatus?: CredsStatus;
  onSave: (vals: CredsInput) => Promise<void>;
}) {
  const [vals, setVals] = useState<CredsInput>({});
  const [saving, setSaving] = useState(false);
  const mainnetSet = credsStatus?.mainnet;
  const testnetSet = credsStatus?.testnet;
  const hasMainnetPair = !!vals.api_key?.trim() && !!vals.api_secret?.trim();
  const hasTestnetPair = !!vals.testnet_api_key?.trim() && !!vals.testnet_api_secret?.trim();
  const hasPartialPair =
    !!vals.api_key?.trim() !== !!vals.api_secret?.trim() ||
    !!vals.testnet_api_key?.trim() !== !!vals.testnet_api_secret?.trim();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Binance API Keys</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">
              Testnet key {testnetSet && <span className="text-green-600">saved</span>}
            </Label>
            <Input
              placeholder={testnetSet ? "•••••••• (keep)" : "Paste testnet key"}
              value={vals.testnet_api_key ?? ""}
              onChange={(e) => setVals({ ...vals, testnet_api_key: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Testnet secret</Label>
            <Input
              type="password"
              placeholder={testnetSet ? "•••••••• (keep)" : "Paste testnet secret"}
              value={vals.testnet_api_secret ?? ""}
              onChange={(e) => setVals({ ...vals, testnet_api_secret: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              Mainnet key {mainnetSet && <span className="text-green-600">saved</span>}
            </Label>
            <Input
              placeholder={mainnetSet ? "•••••••• (keep)" : "Paste mainnet key"}
              value={vals.api_key ?? ""}
              onChange={(e) => setVals({ ...vals, api_key: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mainnet secret</Label>
            <Input
              type="password"
              placeholder={mainnetSet ? "•••••••• (keep)" : "Paste mainnet secret"}
              value={vals.api_secret ?? ""}
              onChange={(e) => setVals({ ...vals, api_secret: e.target.value })}
            />
          </div>
        </div>
        {hasPartialPair && (
          <p className="text-xs text-destructive">
            Enter both key and secret for the same network.
          </p>
        )}
        <Button
          size="sm"
          disabled={saving || hasPartialPair || !(hasMainnetPair || hasTestnetPair)}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(vals);
              setVals({});
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save API keys"}
        </Button>
      </CardContent>
    </Card>
  );
}
