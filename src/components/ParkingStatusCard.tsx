// Parking status widget — drop-in card that re-uses the rules-engine output
// passed in by the caller. No business logic here; it just renders the
// engine's verdict alongside the derived risk score and next planned alert.
import { Clock, ShieldAlert, Activity, BellRing } from "lucide-react";
import { countdownTo } from "@/lib/parking/countdown";
import {
  computeAlertWindows,
  computeRiskScore,
  nextPlannedAlert,
  riskColorClass,
  type AlertSettings,
} from "@/lib/parking/alerts";
import { cn } from "@/lib/utils";

interface ParkingStatusCardProps {
  segmentName: string;
  color: "green" | "yellow" | "red" | "gray";
  label: string;
  allowedUntil: string | null;
  reason: string | null;
  timezone: string;
  alertSettings: AlertSettings;
  nowMs: number;
  compact?: boolean;
}

export function ParkingStatusCard({
  segmentName,
  color,
  label,
  allowedUntil,
  reason,
  timezone,
  alertSettings,
  nowMs,
  compact,
}: ParkingStatusCardProps) {
  const cd = countdownTo(allowedUntil, nowMs);
  const risk = computeRiskScore(allowedUntil, color, nowMs);
  const planned = computeAlertWindows(allowedUntil, color, reason, alertSettings, nowMs);
  const next = nextPlannedAlert(planned, nowMs);

  const statusColorClass =
    color === "red"
      ? "bg-park-red ring-park-red/30"
      : color === "yellow"
        ? "bg-park-yellow ring-park-yellow/30"
        : color === "gray"
          ? "bg-muted ring-muted/30"
          : "bg-park-green ring-park-green/30";

  return (
    <div className="rounded-3xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Parking status
          </div>
          <div className="mt-0.5 truncate text-sm font-bold">{segmentName}</div>
        </div>
        <span className={cn("h-3 w-3 shrink-0 rounded-full ring-4", statusColorClass)} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Cell
          icon={Activity}
          label="Status"
          value={label}
        />
        <Cell
          icon={Clock}
          label="Time remaining"
          value={cd.text}
          valueClass={cd.urgency === "danger" || cd.urgency === "expired" ? "text-park-red" : cd.urgency === "warn" ? "text-park-yellow" : ""}
        />
        <Cell
          icon={Clock}
          label="Allowed until"
          value={allowedUntil ? new Date(allowedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: timezone }) : "—"}
        />
        <div className={cn("flex flex-col gap-1 rounded-2xl border px-3 py-2", riskColorClass(risk.level))}>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider opacity-80">
            <ShieldAlert className="h-3.5 w-3.5" /> Risk
          </div>
          <div className="text-sm font-bold capitalize">{risk.level}</div>
          {!compact && <div className="text-[10px] opacity-70">{risk.reason}</div>}
        </div>
      </div>

      {alertSettings.enabled && next && (
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-background px-3 py-2">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Next alert</div>
              <div className="text-xs font-semibold">{next.label}</div>
            </div>
          </div>
          <div className="text-xs font-bold tabular-nums">
            {new Date(next.triggerAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: timezone })}
          </div>
        </div>
      )}
      {alertSettings.enabled && !next && allowedUntil && (
        <div className="mt-3 rounded-2xl bg-background px-3 py-2 text-[11px] text-muted-foreground">
          No more alerts before this window ends.
        </div>
      )}
      {!alertSettings.enabled && (
        <div className="mt-3 rounded-2xl bg-background px-3 py-2 text-[11px] text-muted-foreground">
          Alerts are turned off. Enable them in Profile.
        </div>
      )}
    </div>
  );
}

function Cell({ icon: Icon, label, value, valueClass }: { icon: typeof Clock; label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-background px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={cn("text-sm font-bold tabular-nums truncate", valueClass)}>{value}</div>
    </div>
  );
}
