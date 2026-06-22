// Full Can-I-Park decision screen. Renders the verdict banner, live countdown,
// next-restriction card, parking timeline, confidence badge, and AI driver
// summary. Pure presentation — all data comes from `getDecisionForSegment`
// (server) + `getDriverSummary` (server). No parking logic lives here.
import { useEffect, useMemo, useState } from "react";
import {
  CircleCheck, CircleX, TriangleAlert, ShieldQuestion,
  Clock, Timer, ShieldAlert, BadgeInfo, MapPin, Sparkles,
  Bell, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParkingDecision } from "@/lib/parking/decision";
import type { SegmentDecisionResult } from "@/lib/parking/decision.functions";
import { formatTimelineTime } from "@/lib/parking/timeline";

interface Props {
  result: SegmentDecisionResult;
  timezone: string;
  /** When the decision was evaluated for (forecast or now). */
  evaluatedAt: Date;
}

const VERDICT_META = {
  YES: { className: "border-park-green/40 bg-park-green-soft text-park-green", Icon: CircleCheck, label: "You can park here" },
  LIMITED: { className: "border-park-yellow/40 bg-park-yellow-soft text-park-yellow", Icon: TriangleAlert, label: "Limited parking" },
  NO: { className: "border-park-red/40 bg-park-red-soft text-park-red", Icon: CircleX, label: "No parking" },
  UNKNOWN: { className: "border-[var(--pc-border)] bg-[var(--pc-surface)] text-slate-500", Icon: ShieldQuestion, label: "Status unknown" },
} as const;

function formatTime(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
}

function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms <= 0) return "Expired";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function formatHHMMSS(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":");
}

function useTick(intervalMs: number, enabled: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setN((x) => x + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return n;
}

export function ParkDecisionScreen({ result, timezone, evaluatedAt }: Props) {
  const decision = result.decision;
  const verdict = decision?.verdict ?? "UNKNOWN";
  const meta = VERDICT_META[verdict];
  const Icon = meta.Icon;

  // Live tick every second so countdown ticks down for YES/LIMITED.
  useTick(1000, verdict === "YES" || verdict === "LIMITED");

  const nowMs = Date.now();
  const remainingMs = decision?.time_remaining_ms != null
    ? Math.max(0, new Date(decision.evaluated_at).getTime() + decision.time_remaining_ms - nowMs)
    : null;
  const nextStartsMs = decision?.next_restriction
    ? Math.max(0, new Date(decision.next_restriction.starts_at).getTime() - nowMs)
    : null;

  return (
    <div className="space-y-4">
      <VerdictBanner
        verdict={verdict}
        statusLabel={decision?.status.label ?? "—"}
        streetName={result.name ?? "Selected street"}
        meta={meta}
        Icon={Icon}
      />

      {verdict === "YES" && remainingMs != null && (
        <CountdownCard remainingMs={remainingMs} />
      )}

      {decision?.next_restriction && nextStartsMs != null && (
        <NextRestrictionCard
          label={decision.next_restriction.label}
          startsAt={decision.next_restriction.starts_at}
          timeUntilMs={nextStartsMs}
          timezone={timezone}
          currentLabel={decision.status.label}
        />
      )}

      <DetailGrid result={result} decision={decision} timezone={timezone} />

      {decision && decision.timeline.length > 1 && (
        <TimelineCard decision={decision} timezone={timezone} />
      )}


      {result.found && decision && (
        <DriverSummaryCard
          result={result}
          decision={decision}
          timezone={timezone}
          evaluatedAt={evaluatedAt}
        />
      )}
    </div>
  );
}

function VerdictBanner({
  verdict, statusLabel, streetName, meta, Icon,
}: {
  verdict: "YES" | "NO" | "LIMITED" | "UNKNOWN";
  statusLabel: string;
  streetName: string;
  meta: typeof VERDICT_META[keyof typeof VERDICT_META];
  Icon: typeof CircleCheck;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border p-4", meta.className)}>
      <Icon className="h-10 w-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">
          Can I park here? · {verdict}
        </div>
        <div className="text-lg font-bold leading-tight">{meta.label}</div>
        <div className="mt-0.5 truncate text-xs opacity-80">
          {streetName} · {statusLabel}
        </div>
      </div>
    </div>
  );
}

function CountdownCard({ remainingMs }: { remainingMs: number }) {
  return (
    <div className="rounded-2xl border border-park-green/40 bg-park-green-soft p-4 text-park-green">
      <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">Time remaining</div>
      <div className="mt-1 font-mono text-3xl font-bold tabular-nums">
        {formatHHMMSS(remainingMs)}
      </div>
      <div className="mt-0.5 text-[11px] opacity-80">before the next restriction</div>
    </div>
  );
}

function NextRestrictionCard({
  label, startsAt, timeUntilMs, timezone, currentLabel,
}: {
  label: string; startsAt: string; timeUntilMs: number; timezone: string; currentLabel: string;
}) {
  return (
    <div className="rounded-2xl bg-[var(--pc-surface)] p-4">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        <Bell className="h-3.5 w-3.5" /> Next restriction
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-bold leading-tight text-slate-900">{label}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            Currently: {currentLabel}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold text-slate-900">{formatTime(startsAt, timezone)}</div>
          <div className="text-[11px] text-slate-500">in {formatDuration(timeUntilMs)}</div>
        </div>
      </div>
    </div>
  );
}

function DetailGrid({
  result, decision, timezone,
}: { result: SegmentDecisionResult; decision: ParkingDecision | null; timezone: string }) {
  const rows: Array<{ icon: typeof Clock; label: string; value: string }> = [];
  if (result.name) rows.push({ icon: MapPin, label: "Street", value: result.name });
  if (decision?.status.allowed_until) {
    rows.push({
      icon: Clock, label: "Allowed until",
      value: formatTime(decision.status.allowed_until, timezone) ?? "—",
    });
  }
  if (decision?.status.permit_zone) {
    rows.push({ icon: ShieldAlert, label: "Permit zone", value: decision.status.permit_zone });
  }
  if (decision?.status.time_limit_minutes != null) {
    rows.push({ icon: Timer, label: "Max stay", value: `${decision.status.time_limit_minutes} min` });
  }
  if (decision?.status.notes) {
    rows.push({ icon: BadgeInfo, label: "Notes", value: decision.status.notes });
  }
  if (result.source_label) {
    rows.push({ icon: BadgeInfo, label: "Source", value: result.source_label });
  }
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-1.5 text-xs">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between rounded-xl bg-[var(--pc-surface)] px-3 py-2">
          <span className="flex items-center gap-2 text-slate-500">
            <r.icon className="h-3.5 w-3.5" /> {r.label}
          </span>
          <span className="max-w-[60%] truncate pl-2 text-right font-semibold text-slate-900">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function TimelineCard({ decision, timezone }: { decision: ParkingDecision; timezone: string }) {
  return (
    <div className="rounded-2xl bg-[var(--pc-surface)] p-4">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        Parking timeline
      </div>
      <ol className="space-y-3">
        {decision.timeline.map((entry, idx) => {
          const dot = entry.color === "green"
            ? "bg-park-green"
            : entry.color === "yellow"
              ? "bg-park-yellow"
              : "bg-park-red";
          const isLast = idx === decision.timeline.length - 1;
          return (
            <li key={entry.iso} className="relative flex gap-3">
              <div className="flex flex-col items-center">
                <span className={cn("h-2.5 w-2.5 rounded-full ring-4 ring-white", dot)} />
                {!isLast && <span className="mt-1 h-full w-px flex-1 bg-slate-200" />}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {formatTimelineTime(entry.iso, timezone, entry.isNow)}
                  </span>
                </div>
                <div className="text-sm font-semibold leading-tight text-slate-900">{entry.label}</div>
                {entry.reason && (
                  <div className="text-[11px] text-slate-500">{entry.reason}</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}


function DriverSummaryCard({
  result, decision, timezone,
}: {
  result: SegmentDecisionResult;
  decision: ParkingDecision;
  timezone: string;
  evaluatedAt: Date;
}) {
  // Deterministic, instant — mirrors the AI Sign Scanner's local paragraph
  // builder. No async call, no spinner. The engine still decides; we narrate.
  const summary = useMemo(
    () => buildDecisionParagraph({ result, decision, timezone }),
    [result, decision, timezone],
  );

  return (
    <div className="rounded-2xl border border-[var(--pc-brand)]/30 bg-[color-mix(in_oklab,var(--pc-brand)_8%,white)] p-4">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--pc-brand-end)" }}>
        <Sparkles className="h-3.5 w-3.5" /> AI driver summary
      </div>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-800">
        {summary}
      </p>
    </div>
  );
}

function buildDecisionParagraph({
  result, decision, timezone,
}: {
  result: SegmentDecisionResult;
  decision: ParkingDecision;
  timezone: string;
}): string {
  const street = result.name ?? "this street";
  const verdict = decision.verdict;
  const statusLc = decision.status.label.toLowerCase();
  const allowedUntil = formatTime(decision.status.allowed_until, timezone);
  const remaining = formatDuration(decision.time_remaining_ms);
  const maxStay = decision.status.time_limit_minutes;
  const permit = decision.status.permit_zone;
  const nextLbl = decision.next_restriction?.label ?? null;
  const nextAt = formatTime(decision.next_restriction?.starts_at, timezone);

  if (verdict === "UNKNOWN") {
    return `UNKNOWN. Parking status on ${street} cannot be verified from current data. Please inspect the posted sign before parking.`;
  }

  const head =
    verdict === "YES"
      ? `YES. You can legally park here right now on ${street}.`
      : verdict === "LIMITED"
        ? `LIMITED. Parking on ${street} is restricted: ${statusLc}.`
        : `NO. You cannot park on ${street} right now: ${statusLc}.`;

  const parts: string[] = [head];
  if (allowedUntil) parts.push(`Allowed until ${allowedUntil}.`);
  if (remaining && verdict !== "NO") parts.push(`You have about ${remaining} remaining.`);
  if (maxStay) parts.push(`Maximum stay is ${maxStay} minutes.`);
  parts.push(permit ? `Permit zone ${permit} required.` : "No permit required.");
  if (nextLbl && nextAt) {
    parts.push(`Next: ${nextLbl} at ${nextAt} — move your vehicle before then.`);
  }
  return parts.join(" ");
}

export function ParkDecisionUnknownCTA({ onScanClick }: { onScanClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onScanClick}
      className="mt-2 flex w-full items-center justify-between rounded-2xl bg-[var(--pc-surface)] px-4 py-3 text-sm font-semibold text-slate-800 transition active:scale-[0.99]"
    >
      <span>Scan the posted sign instead</span>
      <ChevronRight className="h-4 w-4 text-slate-400" />
    </button>
  );
}
