import { useMemo } from "react";
import { X, Navigation, Clock, ShieldAlert, BadgeInfo } from "lucide-react";
import type { CityBundle } from "@/lib/parking/types";
import { computeStatus } from "@/lib/parking/engine";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

interface StreetSheetProps {
  bundle: CityBundle;
  now: Date;
}

const COLOR_CLASS = {
  green: "bg-park-green-soft text-park-green border-park-green/40",
  yellow: "bg-park-yellow-soft text-park-yellow border-park-yellow/40",
  red: "bg-park-red-soft text-park-red border-park-red/40",
} as const;

function formatTime(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function StreetSheet({ bundle, now }: StreetSheetProps) {
  const selectedSegmentId = useAppStore((s) => s.selectedSegmentId);
  const selectSegment = useAppStore((s) => s.selectSegment);
  const setFlyTo = useAppStore((s) => s.setFlyTo);

  const segment = useMemo(
    () => bundle.segments.find((s) => s.id === selectedSegmentId) ?? null,
    [bundle, selectedSegmentId],
  );

  if (!segment) return null;
  const status = computeStatus(segment, bundle.restrictionTypes, now, bundle.city.timezone);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={() => selectSegment(null)}
      />
      <div className="fixed inset-x-0 bottom-0 z-50 safe-bottom animate-in slide-in-from-bottom duration-200">
        <div className="mx-auto max-w-md px-3 pb-3">
          <div className="rounded-3xl border border-border bg-elevated p-5 shadow-2xl">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold leading-tight">{segment.name}</h2>
                {segment.neighborhood && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{segment.neighborhood} · Seattle</p>
                )}
              </div>
              <button
                onClick={() => selectSegment(null)}
                className="rounded-full bg-muted p-2 text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className={cn("mt-4 flex items-center justify-between rounded-2xl border px-4 py-3", COLOR_CLASS[status.color])}>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">Right now</div>
                <div className="text-lg font-bold">{status.label}</div>
              </div>
              <span className={cn("h-3 w-3 rounded-full ring-4", {
                "bg-park-green ring-park-green/30": status.color === "green",
                "bg-park-yellow ring-park-yellow/30": status.color === "yellow",
                "bg-park-red ring-park-red/30": status.color === "red",
              })} />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 text-sm">
              {status.allowed_until && (
                <Row icon={Clock} label="Restriction ends" value={formatTime(new Date(status.allowed_until), bundle.city.timezone)} />
              )}
              {status.permit_zone && (
                <Row icon={ShieldAlert} label="Permit zone" value={status.permit_zone} />
              )}
              {status.time_limit_minutes != null && (
                <Row icon={Clock} label="Max stay" value={`${status.time_limit_minutes} min`} />
              )}
              {status.notes && (
                <Row icon={BadgeInfo} label="Notes" value={status.notes} />
              )}
            </div>

            <div className="mt-5">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">All Posted Rules</div>
              <div className="space-y-1.5">
                {[...segment.rules].sort((a, b) => a.priority - b.priority).map((r) => {
                  const t = bundle.restrictionTypes.find((x) => x.code === r.restriction_code);
                  return (
                    <div key={r.id} className="flex items-start gap-3 rounded-2xl bg-surface p-3">
                      <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", {
                        "bg-park-green": t?.color === "green",
                        "bg-park-yellow": t?.color === "yellow",
                        "bg-park-red": t?.color === "red",
                      })} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{t?.label ?? r.restriction_code}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {r.days_of_week.length === 7 ? "Every day" : r.days_of_week.map((d) => DOW[d]).join(", ")}
                          {r.time_start && r.time_end ? ` · ${r.time_start.slice(0,5)}–${r.time_end.slice(0,5)}` : " · All day"}
                          {r.notes ? ` · ${r.notes}` : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                const [lng, lat] = segment.coordinates[0];
                setFlyTo({ lng, lat, zoom: 18 });
                selectSegment(null);
              }}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-bold text-primary-foreground"
            >
              <Navigation className="h-4 w-4" /> Center on map
            </button>
            <div className="mt-3 text-center text-[10px] text-muted-foreground">
              Source: {segment.rules[0] ? "Seattle (seed)" : "—"} · Verify posted signs before parking.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
