// Floating active-session widget on the home map. Re-evaluates the rules
// engine each tick (driven by the home page's `now`/`tick`) so countdown,
// risk score, and next alert all stay live without UI-only state.
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useDeviceStore } from "@/stores/device-store";
import { getSegmentDetails } from "@/lib/parking/parking.functions";
import { evaluateRulesAt } from "@/lib/parking/engine";
import { ParkingStatusCard } from "@/components/ParkingStatusCard";
import { useSessionAlertScheduler } from "@/lib/parking/notifications";
import type { RestrictionType, StreetSegment } from "@/lib/parking/types";

interface ActiveSessionWidgetProps {
  restrictionTypes: RestrictionType[];
}

export function ActiveSessionWidget({ restrictionTypes }: ActiveSessionWidgetProps) {
  const session = useDeviceStore((s) => s.activeSession);
  const alertSettings = useDeviceStore((s) => s.alertSettings);

  const detailsQ = useQuery({
    queryKey: ["segment-details", session?.segmentId],
    queryFn: () => getSegmentDetails({ data: { id: session!.segmentId } }),
    enabled: !!session,
    staleTime: 60_000,
  });

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!session) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session]);

  const details = detailsQ.data;
  const segment: StreetSegment | null = details && session
    ? {
        id: details.id, name: details.name, side: details.side,
        neighborhood: details.neighborhood, coordinates: [],
        rules: details.rules, events: details.events,
      }
    : null;
  const live = segment && session
    ? evaluateRulesAt(segment, restrictionTypes, new Date(nowMs), session.cityTimezone)
    : null;

  const allowedUntil = live?.allowed_until ?? session?.initialAllowedUntil ?? null;
  const color = live?.color ?? session?.initialColor ?? "green";
  const label = live?.label ?? session?.initialLabel ?? "—";
  const reason = live?.notes ?? session?.initialReason ?? null;

  // Fire alerts even while the user is on the map.
  useSessionAlertScheduler({ allowedUntil, color, reason, nowMs });

  if (!session) return null;

  return (
    <div
      className="pointer-events-auto absolute left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 px-3"
      style={{ top: "calc(var(--safe-top) + 4rem)" }}
    >
      <Link to="/session" className="block">
        <div className="relative">
          <ParkingStatusCard
            segmentName={session.segmentName}
            color={color}
            label={label}
            allowedUntil={allowedUntil}
            reason={reason}
            timezone={session.cityTimezone}
            alertSettings={alertSettings}
            nowMs={nowMs}
            compact
          />
          <ChevronRight className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
        </div>
      </Link>
    </div>
  );
}
