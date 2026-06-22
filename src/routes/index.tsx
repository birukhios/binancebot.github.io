import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AuthPage } from "@/routes/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Grid Bot Dashboard" }] }),
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
  });

  if (session.isLoading) return <AuthPage />;
  if (!session.data?.user?.id) return <AuthPage />;

  return <DashboardShell />;
}
