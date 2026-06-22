import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AuthPage } from "@/routes/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "BKbot" }] }),
  component: Dashboard,
});

type ClientSession = {
  user?: { id?: string; email?: string };
} | null;

async function fetchClientSession(): Promise<ClientSession> {
  const res = await fetch("/api/session", { credentials: "include" });
  if (!res.ok) throw new Error("Could not check sign-in status.");
  return res.json();
}

function Dashboard() {
  const session = useQuery({
    queryKey: ["auth-session"],
    queryFn: fetchClientSession,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (session.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }
  if (!session.data?.user?.id) return <AuthPage />;

  return <DashboardShell />;
}
