import { useState } from "react";
import { CircleCheck, CircleX, Loader2, Navigation, TriangleAlert, MapPin, Clock } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { checkParkingHere, type ParkHereResult } from "@/lib/parking/parking.functions";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

interface Props {
  cityId: string;
  timezone: string;
  /** Map center fallback when GPS is unavailable. Provided by MapView via store. */
}

function formatTime(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}

export function ParkHereButton({ cityId, timezone }: Props) {
  const check = useServerFn(checkParkingHere);
  const setFlyTo = useAppStore((s) => s.setFlyTo);
  const selectSegment = useAppStore((s) => s.selectSegment);
  const mapCenter = useAppStore((s) => s.mapCenter);
  const forecastAt = useAppStore((s) => s.forecastAt);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParkHereResult | null>(null);

  const queryAt = (lng: number, lat: number, source: "gps" | "tap") =>
    check({
      data: {
        cityId, lng, lat, source, timezone,
        at: forecastAt ? forecastAt.toISOString() : null,
      },
    });

  const runWithMapCenter = async () => {
    if (!mapCenter) {
      toast.error("Pan the map to a street, then tap again.");
      return;
    }
    setLoading(true);
    try {
      const res = await queryAt(mapCenter.lng, mapCenter.lat, "tap");
      setResult(res);
      if (res.found && res.segmentId) selectSegment(res.segmentId);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const run = async () => {
    if (!navigator.geolocation || !window.isSecureContext) {
      // No GPS available — fall back to map center.
      await runWithMapCenter();
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          setFlyTo({ lat: latitude, lng: longitude, zoom: 18 });
          const res = await queryAt(longitude, latitude, "gps");
          setResult(res);
          if (res.found && res.segmentId) selectSegment(res.segmentId);
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setLoading(false);
        }
      },
      async () => {
        // GPS denied or failed — fall back gracefully.
        await runWithMapCenter();
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 z-20 safe-x"
        style={{ bottom: "calc(var(--safe-bottom) + 7rem)" }}
      >
        <div className="mx-auto flex max-w-md justify-center px-3">
          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="pointer-events-auto flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-[0_20px_60px_-10px_rgba(0,0,0,0.5)] transition active:scale-95 disabled:opacity-70"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Navigation className="h-4 w-4" strokeWidth={2.5} />
            )}
            {loading ? "Checking…" : "Can I park here?"}
          </button>
        </div>
      </div>

      {result && (
        <>
          <div
            className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setResult(null)}
          />
          <div className="absolute inset-x-0 bottom-0 z-50 safe-bottom animate-in slide-in-from-bottom duration-200">
            <div className="mx-auto max-w-md px-3 pb-3">
              <div className="rounded-3xl border border-border bg-elevated p-5 shadow-2xl">
                <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" />
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-4",
                    result.color === "green" && "border-park-green/40 bg-park-green-soft text-park-green",
                    result.color === "yellow" && "border-park-yellow/40 bg-park-yellow-soft text-park-yellow",
                    (result.color === "red" || !result.found) && "border-park-red/40 bg-park-red-soft text-park-red",
                  )}
                >
                  {result.color === "green" ? (
                    <CircleCheck className="h-8 w-8 shrink-0" />
                  ) : result.color === "yellow" ? (
                    <TriangleAlert className="h-8 w-8 shrink-0" />
                  ) : (
                    <CircleX className="h-8 w-8 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">
                      {result.found
                        ? `${result.source === "gps" ? "GPS" : "Map"} · ${Math.round(result.distance_m ?? 0)} m away`
                        : "Result"}
                    </div>
                    <div className="text-base font-bold leading-tight">{result.message}</div>
                  </div>
                </div>

                {result.found && (
                  <div className="mt-3 grid grid-cols-1 gap-1.5 text-xs">
                    {result.allowed_until && (
                      <DetailRow icon={Clock} label="Allowed until" value={formatTime(new Date(result.allowed_until), timezone)} />
                    )}
                    {result.permit_zone && (
                      <DetailRow icon={MapPin} label="Permit zone" value={result.permit_zone} />
                    )}
                    {result.time_limit_minutes != null && (
                      <DetailRow icon={Clock} label="Max stay" value={`${result.time_limit_minutes} min`} />
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    if (result.found && result.segmentId) selectSegment(result.segmentId);
                  }}
                  className="mt-4 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground"
                >
                  {result.found ? "See full street details" : "Got it"}
                </button>
                <p className="mt-3 text-center text-[10px] text-muted-foreground">
                  Verify posted signs before parking.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-surface px-3 py-2">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
