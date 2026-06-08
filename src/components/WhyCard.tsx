// "Why" card — explains a single engine decision: source, active rule,
// restriction window, confidence, data source. Reused on every result screen.
import { Database, Clock, ShieldAlert, Activity, FileText, Info } from "lucide-react";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import type { ConfidenceScore } from "@/lib/parking/confidence";
import { cn } from "@/lib/utils";

export interface WhyCardProps {
  /** "right now" or forecast time, formatted by caller. */
  whenLabel: string;
  /** Big verdict color from engine. */
  color: "green" | "yellow" | "red";
  /** Engine label, e.g. "No Parking", "2 Hour Parking". */
  decisionLabel: string;
  /** Human reason / engine notes. */
  reason: string | null;
  /** Restriction window, e.g. "Mon-Fri · 8:00 AM - 10:00 AM" — already formatted. */
  activeWindow: string | null;
  allowedUntil: string | null;
  timezone: string;
  /** Provider source ("Seattle SDOT Blockface", "AI sign scan", …). */
  dataSource: string;
  /** Optional: where the decision came from ("Rules engine", "AI scan + Engine", …). */
  decisionSource?: string;
  /** Confidence object from confidence.ts. */
  confidence: ConfidenceScore;
}

const colorClass = {
  green: "border-park-green/40 bg-park-green-soft text-park-green",
  yellow: "border-park-yellow/40 bg-park-yellow-soft text-park-yellow",
  red: "border-park-red/40 bg-park-red-soft text-park-red",
} as const;

export function WhyCard(props: WhyCardProps) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString([], {
      timeZone: props.timezone, weekday: "short", hour: "numeric", minute: "2-digit",
    });

  return (
    <section className="rounded-3xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <Info className="h-4 w-4 text-primary" /> Why this decision?
        </h3>
        <ConfidenceBadge score={props.confidence} compact />
      </div>

      <div className={cn("mt-3 rounded-2xl border px-3 py-2", colorClass[props.color])}>
        <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">{props.whenLabel}</div>
        <div className="text-base font-bold">{props.decisionLabel}</div>
        {props.reason && <div className="mt-0.5 text-[11px] opacity-90">{props.reason}</div>}
      </div>

      <ul className="mt-3 space-y-1.5 text-xs">
        <Row icon={Activity} label="Decision source" value={props.decisionSource ?? "ParkClear rules engine"} />
        {props.activeWindow && <Row icon={Clock} label="Active rule" value={props.activeWindow} />}
        {props.allowedUntil && <Row icon={Clock} label="Window ends" value={fmt(props.allowedUntil)} />}
        <Row icon={Database} label="Data source" value={props.dataSource} />
      </ul>

      <div className="mt-3">
        <ConfidenceBadge score={props.confidence} />
      </div>
    </section>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-2xl bg-background px-3 py-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      <span className="text-right font-semibold">{value}</span>
    </li>
  );
}

// Re-export so the badge can be imported from one place if preferred.
export { ConfidenceBadge };
export const _ICONS = { ShieldAlert, FileText };
