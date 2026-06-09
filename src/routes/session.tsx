// Active parking session screen. Time remaining is calculated by the
// parking rules engine via getSegmentDetails + evaluateRulesAt — never by
// UI state alone.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Car, Clock, ShieldAlert, Timer, Database, MapPin, ArrowLeft, BellRing } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { LocationStatusCard } from "@/components/LocationStatusCard";
import { ParkingStatusCard } from "@/components/ParkingStatusCard";
import { useDeviceStore } from "@/stores/device-store";
import { useAppStore } from "@/stores/app-store";
import { useLocationStore, haversineMeters, walkingMinutes } from "@/stores/location-store";
import { getCityInfo, getSegmentDetails } from "@/lib/parking/parking.functions";
import { evaluateRulesAt } from "@/lib/parking/engine";
import { countdownTo, elapsedSince } from "@/lib/parking/countdown";
import { computeAlertWindows, nextPlannedAlert } from "@/lib/parking/alerts";
import { useSessionAlertScheduler } from "@/lib/parking/notifications";
import type { StreetSegment } from "@/lib/parking/types";
import { cn } from "@/lib/utils";

const cityOpts = queryOptions({
  queryKey: ["parking", "city", "seattle"],
  queryFn: () => getCityInfo({ data: { citySlug: "seattle" } }),
  staleTime: 5 * 60 * 1000,
});

export const Route = createFileRoute("/session")({
  head: () => ({ meta: [{ title: "Parking session — ParkClear" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(cityOpts),
  component: SessionPage,
});

function SessionPage() {
  const city = useSuspenseQuery(cityOpts).data;
  const session = useDeviceStore((s) => s.activeSession);
  const endSession = useDeviceStore((s) => s.endSession);
  const setFlyTo = useAppStore((s) => s.setFlyTo);
  const selectSegment = useAppStore((s) => s.selectSegment);
  const navigate = useNavigate();
  const alertSettings = useDeviceStore((s) => s.alertSettings);
  const liveLocation = useLocationStore((s) => s.current);
  const lastKnownLocation = useLocationStore((s) => s.lastKnown);
  const locStatus = useLocationStore((s) => s.status);

  const detailsQ = useQuery({
    queryKey: ["segment-details", session?.segmentId],
    queryFn: () => getSegmentDetails({ data: { id: session!.segmentId } }),
    enabled: !!session,
    staleTime: 60_000,
  });

  // re-render every second for live countdown
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!session) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session]);

  // Re-evaluate via engine using fresh rules (no-op when no session).
  const details = detailsQ.data;
  const segment: StreetSegment | null = details
    ? {
        id: details.id, name: details.name, side: details.side,
        neighborhood: details.neighborhood, coordinates: [],
        rules: details.rules, events: details.events,
      }
    : null;
  const liveStatus = segment && session
    ? evaluateRulesAt(segment, city.restrictionTypes, new Date(nowMs), session.cityTimezone)
    : null;

  const allowedUntil = liveStatus?.allowed_until ?? session?.initialAllowedUntil ?? null;
  const color = liveStatus?.color ?? session?.initialColor ?? "green";
  const label = liveStatus?.label ?? session?.initialLabel ?? "—";
  const reason = liveStatus?.notes ?? session?.initialReason ?? null;
  const permitZone = liveStatus?.permit_zone ?? null;
  const timeLimit = liveStatus?.time_limit_minutes ?? null;
  const sourceLabel = details?.source_label ?? session?.sourceLabel ?? null;

  // Schedule + deliver any due parking alerts. Hook is safe with no session.
  useSessionAlertScheduler({ allowedUntil, color, reason, nowMs });

  if (!session) {
    return (
      <div className="relative min-h-screen bg-background pb-32">
        <div className="safe-top mx-auto max-w-md px-5 pt-6">
          <h1 className="font-display text-2xl font-bold">Parking session</h1>
          <div className="mt-8 rounded-3xl border border-dashed border-border bg-surface/50 p-8 text-center">
            <Car className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No active session. Tap a street on the map and choose <b>I parked here</b>.
            </p>
            <Link to="/" className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
              Back to map
            </Link>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  const cd = countdownTo(allowedUntil, nowMs);
  const elapsed = elapsedSince(session.startedAt, nowMs);

  const urgencyClass =
    cd.urgency === "danger" || cd.urgency === "expired"
      ? "border-park-red/50 bg-park-red-soft text-park-red"
      : cd.urgency === "warn"
        ? "border-park-yellow/50 bg-park-yellow-soft text-park-yellow"
        : "border-park-green/50 bg-park-green-soft text-park-green";

  const statusColorClass =
    color === "red" ? "border-park-red/40 bg-park-red-soft text-park-red"
      : color === "yellow" ? "border-park-yellow/40 bg-park-yellow-soft text-park-yellow"
      : "border-park-green/40 bg-park-green-soft text-park-green";

  return (
    <div className="relative min-h-screen bg-background pb-32">
      <div className="safe-top mx-auto max-w-md px-5 pt-6">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> Map
          </Link>
          <span className="rounded-full bg-primary/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
            Active session
          </span>
        </div>

        <h1 className="mt-4 font-display text-2xl font-bold leading-tight">{session.segmentName}</h1>
        <p className="mt-1 text-xs text-muted-foreground">Parked {elapsed} ago · {new Date(session.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>

        {/* Countdown hero */}
        <div className={cn("mt-5 rounded-3xl border-2 px-5 py-6 text-center", urgencyClass)}>
          <div className="text-[11px] font-bold uppercase tracking-widest opacity-80">Time remaining</div>
          <div className="mt-1 font-display text-5xl font-extrabold tabular-nums">{cd.text}</div>
          {allowedUntil && cd.urgency !== "expired" && (
            <div className="mt-2 text-xs opacity-80">
              Until {new Date(allowedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: session.cityTimezone })}
            </div>
          )}
          {!allowedUntil && (
            <div className="mt-2 text-xs opacity-80">No posted restriction window</div>
          )}
        </div>

        {/* Status from engine */}
        <div className={cn("mt-4 flex items-center justify-between rounded-2xl border px-4 py-3", statusColorClass)}>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">Current parking status</div>
            <div className="text-lg font-bold">{label}</div>
          </div>
          <span className={cn("h-3 w-3 rounded-full ring-4", {
            "bg-park-green ring-park-green/30": color === "green",
            "bg-park-yellow ring-park-yellow/30": color === "yellow",
            "bg-park-red ring-park-red/30": color === "red",
          })} />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
          {reason && <Row icon={ShieldAlert} label="Restriction reason" value={reason} />}
          {permitZone && <Row icon={ShieldAlert} label="Permit zone" value={permitZone} />}
          {timeLimit != null && <Row icon={Timer} label="Max stay" value={`${timeLimit} min`} />}
          {allowedUntil && (
            <Row
              icon={Clock}
              label="Allowed until"
              value={new Date(allowedUntil).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: session.cityTimezone })}
            />
          )}
          {sourceLabel && <Row icon={Database} label="Source provider" value={sourceLabel} />}
        </div>

        {/* Walking distance from current GPS to parked vehicle, via global LocationStore. */}
        {(() => {
          const fix = liveLocation ?? lastKnownLocation;
          let extra: React.ReactNode = null;
          if (fix && session.coordinates) {
            const meters = haversineMeters(
              { lng: fix.lng, lat: fix.lat },
              { lng: session.coordinates[0], lat: session.coordinates[1] },
            );
            const mins = walkingMinutes(meters);
            extra = (
              <div className="flex items-center justify-between">
                <span className="font-semibold">Distance to your car</span>
                <span>
                  {meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`}
                  {" · "}
                  {mins} min walk
                </span>
              </div>
            );
          } else if (!session.coordinates) {
            extra = <span className="opacity-80">No coordinates saved for this spot.</span>;
          }
          return (
            <LocationStatusCard
              live={liveLocation}
              lastKnown={lastKnownLocation}
              status={locStatus}
              extra={extra}
            />
          );
        })()}


        <UpcomingAlerts
          allowedUntil={allowedUntil}
          color={color}
          reason={reason}
          alertSettings={alertSettings}
          timezone={session.cityTimezone}
          nowMs={nowMs}
        />



        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              if (session.coordinates) setFlyTo({ lng: session.coordinates[0], lat: session.coordinates[1], zoom: 18 });
              selectSegment(session.segmentId);
              navigate({ to: "/" });
            }}
            className="flex items-center justify-center gap-2 rounded-full bg-surface py-3 text-sm font-semibold"
          >
            <MapPin className="h-4 w-4" /> View on map
          </button>
          <button
            onClick={() => { endSession(); navigate({ to: "/" }); }}
            className="rounded-full bg-park-red py-3 text-sm font-bold text-white"
          >
            End session
          </button>
        </div>

        <p className="mt-4 text-center text-[10px] text-muted-foreground">
          Countdown computed by ParkClear rules engine. Always verify posted signs.
        </p>
      </div>
      <BottomNav />
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <span className="text-sm font-semibold text-right">{value}</span>
    </div>
  );
}

function UpcomingAlerts({
  allowedUntil, color, reason, alertSettings, timezone, nowMs,
}: {
  allowedUntil: string | null;
  color: "green" | "yellow" | "red";
  reason: string | null;
  alertSettings: import("@/lib/parking/alerts").AlertSettings;
  timezone: string;
  nowMs: number;
}) {
  const planned = computeAlertWindows(allowedUntil, color, reason, alertSettings, nowMs);
  const next = nextPlannedAlert(planned, nowMs);
  const upcoming = planned.filter((a) => new Date(a.triggerAt).getTime() > nowMs).slice(0, 4);

  if (!alertSettings.enabled) {
    return (
      <div className="mt-4 rounded-2xl bg-surface px-4 py-3 text-xs text-muted-foreground">
        Alerts are turned off. Enable them in Profile to be warned before your window ends.
      </div>
    );
  }
  if (!allowedUntil) return null;

  return (
    <div className="mt-4 rounded-3xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <BellRing className="h-4 w-4 text-primary" />
        <div className="text-sm font-bold">Upcoming alerts</div>
      </div>
      {next ? (
        <div className="mt-2 flex items-center justify-between rounded-2xl bg-primary/10 px-3 py-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-primary">Next alert</div>
            <div className="text-sm font-bold">{next.label}</div>
          </div>
          <div className="text-sm font-bold tabular-nums text-primary">
            {new Date(next.triggerAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: timezone })}
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-2xl bg-background px-3 py-2 text-[11px] text-muted-foreground">
          No more alerts before this window ends.
        </div>
      )}
      {upcoming.length > 0 && (
        <ul className="mt-2 space-y-1">
          {upcoming.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-2xl bg-background px-3 py-1.5 text-[11px]">
              <span className="font-semibold">{a.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {new Date(a.triggerAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: timezone })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
