import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "bkbot-install-dismissed";

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

function isIos() {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (window.sessionStorage.getItem(DISMISS_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS Safari doesn't fire beforeinstallprompt — show manual hint
    if (isIos()) {
      setIosHint(true);
      setVisible(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    setVisible(false);
    window.sessionStorage.setItem(DISMISS_KEY, "1");
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setVisible(false);
    }
    setDeferredPrompt(null);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:bottom-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-xl border bg-card p-4 shadow-lg">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#1a1a2e]">
          <span className="bg-gradient-to-br from-[#f7b733] to-[#fc4a1a] bg-clip-text text-xl font-black text-transparent">
            BK
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Install BKbot</p>
          {iosHint ? (
            <p className="text-xs text-muted-foreground">
              Tap Share then "Add to Home Screen"
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Add to your home screen for quick access & alerts
            </p>
          )}
        </div>
        {!iosHint && (
          <Button size="sm" onClick={install} className="shrink-0 gap-1.5">
            <Download className="h-4 w-4" />
            Download
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={dismiss}
          className="h-8 w-8 shrink-0"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
