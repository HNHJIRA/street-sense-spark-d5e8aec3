// Parking history. Reads from device-store (Phase 4 addition). No backend
// dependency yet — history is per-device. Engine is not invoked here; we
// just display the engine-derived snapshots saved at session end.
import { createFileRoute, Link } from "@tanstack/react-router";
import { Car, ArrowLeft, Trash2, Clock, MapPin, ShieldAlert } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { useDeviceStore } from "@/stores/device-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Parking history — ParkClear" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const history = useDeviceStore((s) => s.parkingHistory);
  const clear = useDeviceStore((s) => s.clearParkingHistory);

  return (
    <div className="relative min-h-full bg-background pb-32">
      <div className="safe-top mx-auto max-w-md px-5 pt-6">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> Map
          </Link>
          <h1 className="font-display text-lg font-bold">Parking history</h1>
          {history.length > 0 ? (
            <button
              onClick={clear}
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-park-red"
            >
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          ) : <span className="w-12" />}
        </div>

        {history.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-border bg-surface/50 p-8 text-center">
            <Car className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No past parking sessions yet. End a parking session to see it here.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {history.map((h) => (
              <li key={h.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{h.segmentName}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(h.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {" → "}
                      {new Date(h.endedAt).toLocaleString([], { hour: "numeric", minute: "2-digit" })}
                    </div>
                  </div>
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    h.outcome === "expired"
                      ? "bg-park-red-soft text-park-red"
                      : "bg-park-green-soft text-park-green",
                  )}>
                    {h.outcome}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                  <Stat icon={Clock} label="Duration" value={`${h.durationMinutes} min`} />
                  <Stat
                    icon={ShieldAlert}
                    label="Status"
                    value={h.initialLabel}
                    tone={h.initialColor}
                  />
                  <Stat icon={MapPin} label="Source" value={h.sourceLabel ?? "—"} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <BottomNav />
    </div>
  );
}

function Stat({
  icon: Icon, label, value, tone,
}: { icon: typeof Clock; label: string; value: string; tone?: "green" | "yellow" | "red" }) {
  return (
    <div className="rounded-xl bg-background px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={cn(
        "mt-0.5 truncate text-xs font-semibold",
        tone === "red" && "text-park-red",
        tone === "yellow" && "text-park-yellow",
        tone === "green" && "text-park-green",
      )}>
        {value}
      </div>
    </div>
  );
}
