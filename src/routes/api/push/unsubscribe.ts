import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { removeSubscriptions } from "@/lib/bot/push.server";

export const Route = createFileRoute("/api/push/unsubscribe")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user?.id) {
          return new Response("Unauthorized", { status: 401 });
        }
        removeSubscriptions(session.user.id);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
