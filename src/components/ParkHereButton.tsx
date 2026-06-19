import { useEffect, useState } from "react";
import { Loader2, Navigation, ScanLine, Footprints, ArrowRight, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  findRankedParking,
  type RankedParkingOption,
} from "@/lib/parking/parking.functions";
import { scoreBadgeClass } from "@/lib/parking/score";
import {
  getDecisionForSegment,
  getDecisionAt,
  type SegmentDecisionResult,
} from "@/lib/parking/decision.functions";
import { ParkDecisionScreen, ParkDecisionUnknownCTA } from "@/components/ParkDecisionScreen";
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
  const checkAt = useServerFn(getDecisionAt);
  const checkSeg = useServerFn(getDecisionForSegment);
  const findRanked = useServerFn(findRankedParking);

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
  const [result, setResult] = useState<SegmentDecisionResult | null>(null);
  const [evaluatedAt, setEvaluatedAt] = useState<Date>(() => new Date());
  const [origin, setOrigin] = useState<{ lng: number; lat: number } | null>(null);
  const [alts, setAlts] = useState<RankedParkingOption[] | null>(null);
  const [altsLoading, setAltsLoading] = useState(false);

  const closeAll = () => {
    setResult(null);
    setAlts(null);
    setOrigin(null);
    setRecommendedHighlight(null);
  };

  const atIso = forecastAt ? forecastAt.toISOString() : null;

  const maybeLoadAlts = async (
    res: SegmentDecisionResult,
    from: { lng: number; lat: number } | null,
  ) => {
    if (!from) return;
    const verdict = res.decision?.verdict ?? "UNKNOWN";
    const needAlts = !res.found || verdict === "NO" || verdict === "UNKNOWN";
    if (!needAlts) return;
    setAltsLoading(true);
    try {
      const opts = await findRanked({
        data: {
          cityId, lng: from.lng, lat: from.lat,
          limit: 3,
          at: atIso, timezone,
          excludeSegmentId: res.segmentId ?? null,
          includeLimited: true,
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
    const when = forecastAt ?? new Date();
    setEvaluatedAt(when);
    if (fix) setFlyTo({ lat: fix.lat, lng: fix.lng, zoom: 18 });
    try {
      const res = await checkAt({
        data: { cityId, lng: from.lng, lat: from.lat, timezone, at: atIso },
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

  // Manual Test Mode — triggered from StreetSheet
  useEffect(() => {
    if (!pendingCheckSegmentId) return;
    const segId = pendingCheckSegmentId;
    requestCheckSegment(null);
    (async () => {
      setLoading(true);
      const from = mapCenter ?? (liveLocation ? { lng: liveLocation.lng, lat: liveLocation.lat } : null);
      setOrigin(from);
      const when = forecastAt ?? new Date();
      setEvaluatedAt(when);
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

  const viewOnMap = (opt: RankedParkingOption) => {
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

  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 z-20 safe-x"
        style={{ bottom: "calc(var(--safe-bottom) + 1.25rem)" }}
      >
        <div className="mx-auto max-w-md px-3">
          <div
            className="pointer-events-auto rounded-[2rem] bg-white px-5 py-5"
            style={{ boxShadow: "0 -8px 30px -10px rgba(15, 23, 42, 0.18), 0 20px 40px -15px rgba(15, 23, 42, 0.15)" }}
          >
            <button
              type="button"
              onClick={runGpsOrTap}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-full px-6 py-4 text-base font-bold text-white transition active:scale-[0.98] disabled:opacity-70"
              style={{
                background: "linear-gradient(90deg, #24C5FA 0%, #2772F1 100%)",
                boxShadow: "0 12px 24px -8px rgba(39, 114, 241, 0.55), 0 4px 12px -4px rgba(36, 197, 250, 0.4)",
                fontFamily: "'Outfit', system-ui, sans-serif",
                letterSpacing: "0.01em",
              }}
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              {loading ? "Checking…" : "Can I Park Here?"}
            </button>
          </div>
        </div>
      </div>

      {result && (
        <>
          <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={closeAll} />
          <div className="absolute inset-x-0 bottom-0 z-50 safe-bottom animate-in slide-in-from-bottom duration-200">
            <div className="mx-auto max-w-md px-3 pb-3">
              <div className="max-h-[85vh] overflow-y-auto rounded-3xl border border-border bg-elevated p-5 shadow-2xl">
                <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" />

                {result.found && result.decision ? (
                  <ParkDecisionScreen
                    result={result}
                    timezone={timezone}
                    evaluatedAt={evaluatedAt}
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-border bg-surface p-4 text-sm">
                      {result.message}
                    </div>
                    <ParkDecisionUnknownCTA onScanClick={() => { window.location.href = "/scan"; }} />
                  </div>
                )}

                {(altsLoading || (alts && alts.length > 0)) && (
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        <Sparkles className="h-3 w-3" /> Where should I park?
                      </div>
                      {alts && alts[0] && (
                        <div className="text-[10px] text-muted-foreground">within {alts[0].search_tier_m} m</div>
                      )}
                    </div>
                    {altsLoading && (
                      <div className="flex items-center gap-2 rounded-2xl bg-surface px-3 py-3 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching nearby (100 → 250 → 500 m)…
                      </div>
                    )}
                    {!altsLoading && (alts ?? []).map((opt, idx) => (
                      <button
                        key={opt.segmentId}
                        type="button"
                        onClick={() => viewOnMap(opt)}
                        className={cn(
                          "mt-1.5 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition active:scale-[0.99]",
                          idx === 0 ? "border border-primary/40 bg-primary/5" : "bg-surface",
                        )}
                      >
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", {
                          "bg-park-green": opt.color === "green",
                          "bg-park-yellow": opt.color === "yellow",
                        })} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {idx === 0 && (
                              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-foreground">Best</span>
                            )}
                            <div className="truncate text-sm font-semibold">{opt.name}</div>
                          </div>
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
                        <div
                          className={cn(
                            "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums",
                            scoreBadgeClass(opt.parking_score),
                          )}
                          title="Parking quality score"
                        >
                          {opt.parking_score}
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))}
                    {!altsLoading && alts && alts.length === 0 && (
                      <div className="rounded-2xl bg-surface px-3 py-3 text-xs text-muted-foreground">
                        No legal parking found within 500 m right now.
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
