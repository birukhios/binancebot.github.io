import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { addSubscription } from "@/lib/bot/push.server";

export const Route = createFileRoute("/api/push/subscribe")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user?.id) {
          return new Response("Unauthorized", { status: 401 });
        }
        const body = await request.json();
        if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
          return new Response("Invalid subscription", { status: 400 });
        }
        addSubscription(session.user.id, { endpoint: body.endpoint, keys: body.keys });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
