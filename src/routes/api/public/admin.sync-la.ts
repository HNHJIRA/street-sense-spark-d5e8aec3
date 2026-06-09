// One-off admin trigger to populate LA meter inventory + live occupancy.
// Public (no auth) but does only idempotent server-side syncs from public LADOT feeds.
import { createFileRoute } from "@tanstack/react-router";
import { syncLaMeterInventory, syncLaMeterOccupancy } from "@/lib/parking/la-express.functions";

export const Route = createFileRoute("/api/public/admin/sync-la")({
  server: {
    handlers: {
      POST: async () => {
        const inv = await syncLaMeterInventory();
        const occ = await syncLaMeterOccupancy();
        return new Response(JSON.stringify({ ok: true, inv, occ }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      GET: async () => {
        const inv = await syncLaMeterInventory();
        const occ = await syncLaMeterOccupancy();
        return new Response(JSON.stringify({ ok: true, inv, occ }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
