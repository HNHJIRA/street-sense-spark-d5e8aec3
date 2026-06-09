// "Where should I park?" sheet — shows top ranked parking spots near a
// destination chosen from search. Reuses findRankedParking (which uses
// evaluateRulesAt internally) — does not duplicate parking logic.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  X, Loader2, Footprints, MapPin, ArrowRight, Sparkles,
} from "lucide-react";
import {
  findRankedParking,
  type RankedParkingOption,
} from "@/lib/parking/parking.functions";
import { scoreBadgeClass } from "@/lib/parking/score";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

interface Props {
  cityId: string;
  timezone: string;
}

function formatTime(iso: string | null, tz: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
}

function formatWalk(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m} min walk`;
}

export function DestinationParkingSheet({ cityId, timezone }: Props) {
  const destination = useAppStore((s) => s.destination);
  const setDestination = useAppStore((s) => s.setDestination);
  const setFlyTo = useAppStore((s) => s.setFlyTo);
  const selectSegment = useAppStore((s) => s.selectSegment);
  const setRecommendedHighlight = useAppStore((s) => s.setRecommendedHighlight);
  const forecastAt = useAppStore((s) => s.forecastAt);

  const find = useServerFn(findRankedParking);
  const atIso = forecastAt ? forecastAt.toISOString() : null;

  const q = useQuery<RankedParkingOption[]>({
    queryKey: ["dest-parking", destination?.lng, destination?.lat, atIso, cityId],
    queryFn: () => find({
      data: {
        cityId,
        lng: destination!.lng,
        lat: destination!.lat,
        timezone,
        at: atIso,
        limit: 5,
        includeLimited: true,
      },
    }),
    enabled: !!destination,
    staleTime: 60_000,
  });

  // Fly to destination when it changes
  useEffect(() => {
    if (destination) setFlyTo({ lng: destination.lng, lat: destination.lat, zoom: 17 });
  }, [destination, setFlyTo]);

  if (!destination) return null;

  const close = () => {
    setDestination(null);
    setRecommendedHighlight(null);
  };

  const choose = (opt: RankedParkingOption) => {
    const mid = opt.coordinates[Math.floor(opt.coordinates.length / 2)] ?? opt.coordinates[0];
    if (mid) setFlyTo({ lng: mid[0], lat: mid[1], zoom: 18 });
    setRecommendedHighlight({
      from: { lng: destination.lng, lat: destination.lat },
      segmentId: opt.segmentId,
      coordinates: opt.coordinates,
    });
    selectSegment(opt.segmentId);
  };

  const results = q.data ?? [];
  const top = results[0];

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={close} />
      <div className="absolute inset-x-0 bottom-0 z-50 safe-bottom animate-in slide-in-from-bottom duration-200">
        <div className="mx-auto max-w-md px-3 pb-3">
          <div className="max-h-[85vh] overflow-y-auto rounded-3xl border border-border bg-elevated p-5 shadow-2xl">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <MapPin className="h-3 w-3" /> Park near
                </div>
                <h2 className="mt-0.5 truncate font-display text-lg font-bold leading-tight">
                  {destination.name}
                </h2>
                <p className="truncate text-xs text-muted-foreground">{destination.placeName}</p>
              </div>
              <button onClick={close} className="rounded-full bg-muted p-2 text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {q.isLoading && (
              <div className="mt-5 flex items-center gap-2 rounded-2xl bg-surface px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Finding the best parking spots…
              </div>
            )}

            {!q.isLoading && results.length === 0 && (
              <div className="mt-5 rounded-2xl bg-surface px-3 py-4 text-sm text-muted-foreground">
                No legal parking found within 500m. Try a different destination or scan a posted sign.
              </div>
            )}

            {top && (
              <div className="mt-5 rounded-2xl border border-primary/40 bg-primary/5 p-4">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  <Sparkles className="h-3 w-3" /> Best option
                </div>
                <div className="mt-1.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-bold">{top.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{Math.round(top.distance_m)} m</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1"><Footprints className="h-3 w-3" />{formatWalk(top.walking_seconds)}</span>
                      <span>·</span>
                      <span>{top.label}</span>
                    </div>
                    {top.allowed_until && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        Allowed until {formatTime(top.allowed_until, timezone)}
                      </div>
                    )}
                  </div>
                  <ScoreBadge score={top.parking_score} />
                </div>
                <button
                  onClick={() => choose(top)}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-primary py-2.5 text-sm font-bold text-primary-foreground"
                >
                  Show on map <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {results.length > 1 && (
              <div className="mt-4">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  More options
                </div>
                {results.slice(1).map((opt) => (
                  <button
                    key={opt.segmentId}
                    onClick={() => choose(opt)}
                    className="mt-1.5 flex w-full items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 text-left transition active:scale-[0.99]"
                  >
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", {
                      "bg-park-green": opt.color === "green",
                      "bg-park-yellow": opt.color === "yellow",
                    })} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{opt.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{Math.round(opt.distance_m)} m</span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1"><Footprints className="h-3 w-3" />{formatWalk(opt.walking_seconds)}</span>
                        {opt.allowed_until && (<><span>·</span><span>until {formatTime(opt.allowed_until, timezone)}</span></>)}
                      </div>
                    </div>
                    <ScoreBadge score={opt.parking_score} small />
                  </button>
                ))}
              </div>
            )}

            {results.length > 0 && (
              <p className="mt-4 text-center text-[10px] text-muted-foreground">
                Searched within {results[0].search_tier_m}m. Verify posted signs before parking.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ScoreBadge({ score, small }: { score: number; small?: boolean }) {
  return (
    <div
      className={cn(
        "shrink-0 rounded-full border px-2.5 text-center font-bold tabular-nums",
        scoreBadgeClass(score),
        small ? "py-0.5 text-[11px]" : "py-1 text-sm",
      )}
      title="Parking quality score"
    >
      {score}
    </div>
  );
}
