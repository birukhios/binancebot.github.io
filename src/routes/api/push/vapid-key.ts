import { createFileRoute } from "@tanstack/react-router";
import { getPublicVapidKey } from "@/lib/bot/push.server";

export const Route = createFileRoute("/api/push/vapid-key")({
  server: {
    handlers: {
      GET: async () => {
        const key = getPublicVapidKey();
        return new Response(JSON.stringify({ key }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
