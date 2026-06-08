// Decision timeline — vertical "what changes next" view. Renders pure data
// from buildDecisionTimeline() so the engine remains the source of truth.
import { Circle } from "lucide-react";
import { formatTimelineTime, type TimelineEntry } from "@/lib/parking/timeline";
import { cn } from "@/lib/utils";

interface Props {
  entries: TimelineEntry[];
  timezone: string;
}

const DOT = {
  green: "bg-park-green ring-park-green/30",
  yellow: "bg-park-yellow ring-park-yellow/30",
  red: "bg-park-red ring-park-red/30",
} as const;

const TEXT = {
  green: "text-park-green",
  yellow: "text-park-yellow",
  red: "text-park-red",
} as const;

export function DecisionTimeline({ entries, timezone }: Props) {
  if (entries.length === 0) return null;
  return (
    <section className="rounded-3xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Decision timeline</h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Next {Math.min(24, entries.length * 3)}h</span>
      </div>
      <ol className="mt-3 relative ml-2">
        <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border" />
        {entries.map((e, i) => (
          <li key={i} className="relative flex items-start gap-3 py-2">
            <span className={cn("z-10 mt-1 h-3 w-3 shrink-0 rounded-full ring-4", DOT[e.color])}>
              <Circle className="h-0 w-0" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className={cn("text-[11px] font-bold uppercase tracking-wider", e.isNow ? "text-primary" : "text-muted-foreground")}>
                  {formatTimelineTime(e.iso, timezone, e.isNow)}
                </span>
                <span className={cn("text-[10px] font-semibold", TEXT[e.color])}>{e.color.toUpperCase()}</span>
              </div>
              <div className="text-sm font-bold">{e.label}</div>
              {e.reason && <div className="text-[11px] text-muted-foreground">{e.reason}</div>}
              {e.permitZone && <div className="text-[11px] text-muted-foreground">Zone {e.permitZone}</div>}
              {e.timeLimitMinutes != null && <div className="text-[11px] text-muted-foreground">{e.timeLimitMinutes} min max stay</div>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
