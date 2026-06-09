import { useEffect, useState } from "react";
import { CircleCheck, CircleX, Loader2, Navigation, TriangleAlert, MapPin, Clock, ScanLine, Footprints, ArrowRight, ShieldQuestion } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  checkParkingHere,
  checkParkingForSegment,
  findNearbyAvailable,
  type ParkHereResult,
  type NearbyOption,
} from "@/lib/parking/parking.functions";
import { useAppStore } from "@/stores/app-store";
import { useLocationStore } from "@/stores/location-store";
import { cn } from "@/lib/utils";

interface Props {
  cityId: string;
  timezone: string;
}

function formatTime(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}

function formatWalk(seconds: number) {
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m} min walk`;
}

export function ParkHereButton({ cityId, timezone }: Props) {
  const checkGps = useServerFn(checkParkingHere);
  const checkSeg = useServerFn(checkParkingForSegment);
  const findNearby = useServerFn(findNearbyAvailable);

  const setFlyTo = useAppStore((s) => s.setFlyTo);
  const selectSegment = useAppStore((s) => s.selectSegment);
  const mapCenter = useAppStore((s) => s.mapCenter);
  const forecastAt = useAppStore((s) => s.forecastAt);
  const pendingCheckSegmentId = useAppStore((s) => s.pendingCheckSegmentId);
  const requestCheckSegment = useAppStore((s) => s.requestCheckSegment);
  const setRecommendedHighlight = useAppStore((s) => s.setRecommendedHighlight);

  const liveLocation = useLocationStore((s) => s.current);
  const lastKnown = useLocationStore((s) => s.lastKnown);
  const locStatus = useLocationStore((s) => s.status);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParkHereResult | null>(null);
  const [origin, setOrigin] = useState<{ lng: number; lat: number } | null>(null);
  const [alts, setAlts] = useState<NearbyOption[] | null>(null);
  const [altsLoading, setAltsLoading] = useState(false);

  const closeAll = () => {
    setResult(null);
    setAlts(null);
    setOrigin(null);
    setRecommendedHighlight(null);
  };

  const atIso = forecastAt ? forecastAt.toISOString() : null;

  const maybeLoadAlts = async (
    res: ParkHereResult,
    from: { lng: number; lat: number } | null,
  ) => {
    if (!from) return;
    // Mode 2: trigger when NO PARKING or UNKNOWN
    const needAlts = !res.found || res.color === "red";
    if (!needAlts) return;
    setAltsLoading(true);
    try {
      const opts = await findNearby({
        data: {
          cityId, lng: from.lng, lat: from.lat,
          radiusM: 100, limit: 8,
          at: atIso, timezone,
          excludeSegmentId: res.segmentId ?? null,
        },
      });
      setAlts(opts);
    } catch (e) {
      console.warn("[ParkHereButton] alternatives failed", e);
      setAlts([]);
    } finally {
      setAltsLoading(false);
    }
  };

  const runGpsOrTap = async () => {
    const fix = liveLocation ?? lastKnown;
    const from = fix ? { lng: fix.lng, lat: fix.lat } : mapCenter;
    const source: "gps" | "tap" = fix ? "gps" : "tap";
    if (!from) {
      if (locStatus === "denied") {
        toast.error("Location denied. Pan the map to a street and tap again.");
      } else {
        toast.error("Pan the map to a street, then tap again.");
      }
      return;
    }
    setLoading(true);
    setOrigin(from);
    if (fix) setFlyTo({ lat: fix.lat, lng: fix.lng, zoom: 18 });
    try {
      const res = await checkGps({
        data: { cityId, lng: from.lng, lat: from.lat, source, timezone, at: atIso },
      });
      setResult(res);
      if (res.found && res.segmentId) selectSegment(res.segmentId);
      await maybeLoadAlts(res, from);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Mode 3: Manual Test — triggered from StreetSheet
  useEffect(() => {
    if (!pendingCheckSegmentId) return;
    const segId = pendingCheckSegmentId;
    requestCheckSegment(null);
    (async () => {
      setLoading(true);
      const from = mapCenter ?? (liveLocation ? { lng: liveLocation.lng, lat: liveLocation.lat } : null);
      setOrigin(from);
      try {
        const res = await checkSeg({ data: { segmentId: segId, at: atIso, timezone } });
        setResult(res);
        await maybeLoadAlts(res, from);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCheckSegmentId]);

  const viewOnMap = (opt: NearbyOption) => {
    const mid = opt.coordinates[Math.floor(opt.coordinates.length / 2)] ?? opt.coordinates[0];
    if (mid) setFlyTo({ lng: mid[0], lat: mid[1], zoom: 18 });
    if (origin && mid) {
      setRecommendedHighlight({
        from: origin,
        segmentId: opt.segmentId,
        coordinates: opt.coordinates,
      });
    }
    selectSegment(opt.segmentId);
    setResult(null);
    setAlts(null);
  };

  const decision: "YES" | "NO" | "LIMITED" | "UNKNOWN" = !result
    ? "UNKNOWN"
    : !result.found
      ? "UNKNOWN"
      : result.color === "green"
        ? "YES"
        : result.color === "yellow"
          ? "LIMITED"
          : "NO";

  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 z-20 safe-x"
        style={{ bottom: "calc(var(--safe-bottom) + 7rem)" }}
      >
        <div className="mx-auto flex max-w-md items-center justify-center gap-2 px-3">
          <button
            type="button"
            onClick={runGpsOrTap}
            disabled={loading}
            className="pointer-events-auto flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-[0_20px_60px_-10px_rgba(0,0,0,0.5)] transition active:scale-95 disabled:opacity-70"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" strokeWidth={2.5} />}
            {loading ? "Checking…" : "Can I park here?"}
          </button>
          <a
            href="/scan"
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-surface px-4 py-3 text-sm font-bold shadow-[0_20px_60px_-10px_rgba(0,0,0,0.5)] transition active:scale-95"
          >
            <ScanLine className="h-4 w-4" strokeWidth={2.5} />
            Scan sign
          </a>
        </div>
      </div>

      {result && (
        <>
          <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={closeAll} />
          <div className="absolute inset-x-0 bottom-0 z-50 safe-bottom animate-in slide-in-from-bottom duration-200">
            <div className="mx-auto max-w-md px-3 pb-3">
              <div className="max-h-[80vh] overflow-y-auto rounded-3xl border border-border bg-elevated p-5 shadow-2xl">
                <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" />

                {/* Decision banner */}
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-4",
                    decision === "YES" && "border-park-green/40 bg-park-green-soft text-park-green",
                    decision === "LIMITED" && "border-park-yellow/40 bg-park-yellow-soft text-park-yellow",
                    decision === "NO" && "border-park-red/40 bg-park-red-soft text-park-red",
                    decision === "UNKNOWN" && "border-border bg-surface text-muted-foreground",
                  )}
                >
                  {decision === "YES" ? <CircleCheck className="h-8 w-8 shrink-0" />
                    : decision === "LIMITED" ? <TriangleAlert className="h-8 w-8 shrink-0" />
                    : decision === "NO" ? <CircleX className="h-8 w-8 shrink-0" />
                    : <ShieldQuestion className="h-8 w-8 shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">
                      Can I park here? · {decision}
                    </div>
                    <div className="text-base font-bold leading-tight">{result.message}</div>
                    {result.found && (
                      <div className="mt-0.5 text-[11px] opacity-80">
                        {result.source === "gps" ? "GPS" : result.source === "tap" ? "Map" : "Selected"} · {Math.round(result.distance_m ?? 0)} m away
                      </div>
                    )}
                  </div>
                </div>

                {result.found && (
                  <div className="mt-3 grid grid-cols-1 gap-1.5 text-xs">
                    {result.name && (
                      <DetailRow icon={MapPin} label="Street" value={`${result.name}${result.side && result.side !== "both" ? ` (${result.side})` : ""}`} />
                    )}
                    <DetailRow icon={ShieldQuestion} label="Status" value={result.label ?? "—"} />
                    {result.allowed_until && (
                      <DetailRow icon={Clock} label="Allowed until" value={formatTime(new Date(result.allowed_until), timezone)} />
                    )}
                    {result.permit_zone && (
                      <DetailRow icon={MapPin} label="Permit zone" value={result.permit_zone} />
                    )}
                    {result.time_limit_minutes != null && (
                      <DetailRow icon={Clock} label="Max stay" value={`${result.time_limit_minutes} min`} />
                    )}
                    {result.data_source && (
                      <DetailRow icon={MapPin} label="Source" value={result.data_source} />
                    )}
                  </div>
                )}

                {/* Mode 2: alternatives */}
                {(altsLoading || (alts && alts.length > 0)) && (
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Nearest available parking
                      </div>
                      <div className="text-[10px] text-muted-foreground">within 100 m</div>
                    </div>
                    {altsLoading && (
                      <div className="flex items-center gap-2 rounded-2xl bg-surface px-3 py-3 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching nearby…
                      </div>
                    )}
                    {!altsLoading && (alts ?? []).map((opt) => (
                      <button
                        key={opt.segmentId}
                        type="button"
                        onClick={() => viewOnMap(opt)}
                        className="mt-1.5 flex w-full items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 text-left transition active:scale-[0.99]"
                      >
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", {
                          "bg-park-green": opt.color === "green",
                          "bg-park-yellow": opt.color === "yellow",
                          "bg-park-red": opt.color === "red",
                        })} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{opt.name}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{Math.round(opt.distance_m)} m</span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1"><Footprints className="h-3 w-3" />{formatWalk(opt.walking_seconds)}</span>
                            <span>·</span>
                            <span>{opt.label}</span>
                          </div>
                          {opt.allowed_until && (
                            <div className="text-[10px] text-muted-foreground">until {formatTime(new Date(opt.allowed_until), timezone)}</div>
                          )}
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))}
                    {!altsLoading && alts && alts.length === 0 && (
                      <div className="rounded-2xl bg-surface px-3 py-3 text-xs text-muted-foreground">
                        No open parking found within 100 m right now.
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (result.found && result.segmentId) selectSegment(result.segmentId);
                    setResult(null);
                    setAlts(null);
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
      <span className="truncate pl-2 text-right font-semibold">{value}</span>
    </div>
  );
}
