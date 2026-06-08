// Confidence badge — compact pill plus an expandable factor breakdown.
import { useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldX, ChevronDown } from "lucide-react";
import { confidenceColorClass, type ConfidenceScore } from "@/lib/parking/confidence";
import { cn } from "@/lib/utils";

interface Props {
  score: ConfidenceScore;
  compact?: boolean;
}

export function ConfidenceBadge({ score, compact }: Props) {
  const [open, setOpen] = useState(false);
  const Icon = score.level === "high" ? ShieldCheck : score.level === "medium" ? ShieldAlert : ShieldX;
  const colorClass = confidenceColorClass(score.level);

  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", colorClass)}>
        <Icon className="h-3 w-3" /> {score.level} ({score.score})
      </span>
    );
  }

  return (
    <div className={cn("rounded-3xl border p-4", colorClass)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6" />
          <div className="text-left">
            <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">Confidence</div>
            <div className="text-base font-bold capitalize">{score.level} · {score.score}/100</div>
          </div>
        </div>
        <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} />
      </button>
      <p className="mt-2 text-xs opacity-90">{score.summary}</p>
      {open && (
        <ul className="mt-3 space-y-1.5">
          {score.factors.map((f, i) => (
            <li key={i} className="flex items-start justify-between gap-3 rounded-xl bg-background/40 px-3 py-2 text-[11px]">
              <div className="min-w-0">
                <div className="font-bold">{f.label}</div>
                <div className="opacity-80">{f.detail}</div>
              </div>
              <span className={cn("shrink-0 tabular-nums font-bold",
                f.delta > 0 ? "text-park-green" : f.delta < 0 ? "text-park-red" : "opacity-70")}>
                {f.delta > 0 ? "+" : ""}{f.delta}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
