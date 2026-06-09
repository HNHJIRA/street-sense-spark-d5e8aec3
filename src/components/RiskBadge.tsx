// Parking Risk Badge. Inverts the Parking Health Score into a Low / Medium /
// High risk surface for the driver. Pure presentation — health is computed
// by computeHealthScore (which is itself derived from the existing
// confidence + provider signals; not a new engine).
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { computeHealthScore, type HealthInputs } from "@/lib/parking/health-score";
import { cn } from "@/lib/utils";

interface Props extends HealthInputs {
  compact?: boolean;
}

function riskBand(score: number): { label: string; tone: "low" | "medium" | "high" } {
  if (score >= 75) return { label: "Low risk", tone: "low" };
  if (score >= 50) return { label: "Medium risk", tone: "medium" };
  return { label: "High risk", tone: "high" };
}

export function RiskBadge({ compact, ...inputs }: Props) {
  const health = computeHealthScore(inputs);
  const risk = riskBand(health.score);
  const Icon = risk.tone === "low" ? ShieldCheck : risk.tone === "medium" ? ShieldAlert : ShieldX;
  const cls = risk.tone === "low"
    ? "bg-park-green-soft text-park-green border-park-green/40"
    : risk.tone === "medium"
      ? "bg-park-yellow-soft text-park-yellow border-park-yellow/40"
      : "bg-park-red-soft text-park-red border-park-red/40";
  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", cls)}>
        <Icon className="h-3 w-3" /> {risk.label}
      </span>
    );
  }
  return (
    <div className={cn("flex items-center justify-between rounded-2xl border px-3 py-2", cls)}>
      <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider">
        <Icon className="h-4 w-4" /> {risk.label}
      </span>
      <span className="text-sm font-bold tabular-nums" title="Parking reliability score">
        {health.score}/100
      </span>
    </div>
  );
}
