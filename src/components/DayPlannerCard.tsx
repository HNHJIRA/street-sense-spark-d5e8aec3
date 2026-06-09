// Smart Day Planner card — renders best parking windows for a chosen day
// for a single segment. Uses buildDayPlan (which uses evaluateRulesAt) and
// queries getSegmentDetails for the live rules. Pure UI on top of engine.
import { useMemo, useState } from "react";
import { useQuery, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { CalendarDays, Sun, AlertTriangle } from "lucide-react";
import { getCityInfo, getSegmentDetails } from "@/lib/parking/parking.functions";
import { buildDayPlan, type DayWindow } from "@/lib/parking/day-planner";
import { cn } from "@/lib/utils";

interface Props {
  segmentId: string;
  citySlug: string;
}

function ymd(d: Date, tz: string): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(d);
}

function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function windowDurationLabel(w: DayWindow): string {
  const ms = +new Date(w.end_iso) - +new Date(w.start_iso);
  const hours = Math.floor(ms / 3600_000);
  const mins = Math.round((ms % 3600_000) / 60_000);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

const PRESETS = [0, 1, 2] as const;
const PRESET_LABELS = { 0: "Today", 1: "Tomorrow", 2: "In 2 days" } as const;

export function DayPlannerCard({ segmentId, citySlug }: Props) {
  const cityOpts = queryOptions({
    queryKey: ["parking", "city", citySlug],
    queryFn: () => getCityInfo({ data: { citySlug } }),
    staleTime: 5 * 60 * 1000,
  });
  const city = useSuspenseQuery(cityOpts).data;
  const detailsQ = useQuery({
    queryKey: ["segment-details", segmentId],
    queryFn: () => getSegmentDetails({ data: { id: segmentId } }),
    staleTime: 60_000,
  });
  const [offset, setOffset] = useState<0 | 1 | 2>(0);

  const tz = city.timezone;
  const plan = useMemo(() => {
    if (!detailsQ.data) return null;
    const target = new Date(Date.now() + offset * 86_400_000);
    return buildDayPlan(
      {
        id: detailsQ.data.id,
        name: detailsQ.data.name,
        side: detailsQ.data.side,
        neighborhood: detailsQ.data.neighborhood,
        coordinates: [],
        rules: detailsQ.data.rules,
        events: detailsQ.data.events,
      },
      city.restrictionTypes,
      ymd(target, tz),
      tz,
    );
  }, [detailsQ.data, city.restrictionTypes, offset, tz]);


  if (!detailsQ.data) {
    return (
      <div className="rounded-3xl border border-border bg-surface p-4 text-sm text-muted-foreground">
        Loading day plan…
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-primary" />
        <div className="text-sm font-bold">Smart Day Planner</div>
      </div>

      <div className="mt-3 inline-flex rounded-full bg-background p-0.5 text-[11px] font-semibold">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setOffset(p)}
            className={cn(
              "rounded-full px-3 py-1 transition",
              offset === p ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>

      {plan?.best_window && (
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-park-green-soft px-3 py-2 text-park-green">
          <Sun className="h-4 w-4" />
          <div className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">Best window</div>
            <div className="text-sm font-bold">
              {formatTime(plan.best_window.start_iso, tz)} – {formatTime(plan.best_window.end_iso, tz)}
            </div>
          </div>
          <div className="text-xs font-semibold tabular-nums">{windowDurationLabel(plan.best_window)}</div>
        </div>
      )}

      <ul className="mt-3 space-y-1.5">
        {plan?.windows.map((w) => (
          <li
            key={w.start_iso}
            className={cn(
              "flex items-center justify-between rounded-2xl px-3 py-2 text-[12px]",
              w.color === "green" && "bg-park-green-soft text-park-green",
              w.color === "yellow" && "bg-park-yellow-soft text-park-yellow",
              w.color === "red" && "bg-park-red-soft text-park-red",
            )}
          >
            <span className="font-semibold">
              {formatTime(w.start_iso, tz)} – {formatTime(w.end_iso, tz)}
            </span>
            <span className="flex items-center gap-1.5">
              {w.color === "red" && <AlertTriangle className="h-3 w-3" />}
              {w.label}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-center text-[10px] text-muted-foreground">
        Computed by ParkClear rules engine. Verify posted signs.
      </p>
    </div>
  );
}
