// Compact, reusable card that shows the device's current GPS status using
// the global LocationStore. Renders on /scan and /session so users always
// know whether parking decisions are using fresh GPS, last-known, or none.
import { MapPin, Wifi, WifiOff, AlertTriangle } from "lucide-react";
import {
  type DeviceLocation,
  type LocationStatus,
  formatLocationAge,
} from "@/stores/location-store";

interface Props {
  live: DeviceLocation | null;
  lastKnown: DeviceLocation | null;
  status: LocationStatus;
  /** Optional extra row, e.g. "Distance from car: 320 m". */
  extra?: React.ReactNode;
  className?: string;
}

export function LocationStatusCard({ live, lastKnown, status, extra, className }: Props) {
  const fix = live ?? lastKnown;
  const isLive = !!live && status === "watching";
  const isStale = !live && !!lastKnown;

  let tone = "border-border bg-surface text-foreground";
  let Icon = MapPin;
  let title = "Locating you…";
  let detail = "Waiting for the first GPS fix.";

  if (status === "denied") {
    tone = "border-park-red/40 bg-park-red-soft text-park-red";
    Icon = WifiOff;
    title = "Location permission denied";
    detail = "Enable location for this site in your browser settings.";
  } else if (status === "unavailable") {
    tone = "border-park-yellow/40 bg-park-yellow-soft text-park-yellow";
    Icon = WifiOff;
    title = "GPS unavailable";
    detail = "This device or browser doesn't expose location.";
  } else if (isLive && fix) {
    tone = "border-park-green/40 bg-park-green-soft text-park-green";
    Icon = Wifi;
    title = "Live location";
    detail = `±${Math.round(fix.accuracy ?? 0)} m · ${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`;
  } else if (isStale && fix) {
    tone = "border-park-yellow/40 bg-park-yellow-soft text-park-yellow";
    Icon = AlertTriangle;
    title = "Using last known location";
    detail = `Updated ${formatLocationAge(fix.timestamp)} · ±${Math.round(fix.accuracy ?? 0)} m`;
  }

  return (
    <div className={`mt-4 rounded-2xl border p-3 ${tone} ${className ?? ""}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">
            {title}
          </div>
          <div className="mt-0.5 text-xs font-medium text-foreground/90 break-words">
            {detail}
          </div>
          {extra && (
            <div className="mt-2 border-t border-foreground/10 pt-2 text-xs text-foreground/90">
              {extra}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
