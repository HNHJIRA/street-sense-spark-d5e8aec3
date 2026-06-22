import { X, Clock, ShieldAlert, BadgeInfo, Database, Timer, Bookmark, Heart, Car, Navigation, Trophy, CheckCircle2, Circle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { getSegmentDetails } from "@/lib/parking/parking.functions";
import { evaluateRulesAt } from "@/lib/parking/engine";
import { isRuleActiveAt, providerLabel, formatDays, formatHours, explainWinner } from "@/lib/parking/rule-explain";
import type { RestrictionType, StreetSegment } from "@/lib/parking/types";
import { useAppStore } from "@/stores/app-store";
import { useDeviceStore } from "@/stores/device-store";
import { cn } from "@/lib/utils";
import { DayPlannerCard } from "@/components/DayPlannerCard";
import { RiskBadge } from "@/components/RiskBadge";
import { scoreConfidence } from "@/lib/parking/confidence";



interface StreetSheetProps {
  timezone: string;
  restrictionTypes: RestrictionType[];
  cityId: string;
  citySlug: string;
}


const COLOR_CLASS = {
  green: "bg-park-green-soft text-park-green border-park-green/40",
  yellow: "bg-park-yellow-soft text-park-yellow border-park-yellow/40",
  red: "bg-park-red-soft text-park-red border-park-red/40",
  gray: "bg-muted text-muted-foreground border-border",
} as const;

function formatTime(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function StreetSheet({ timezone, restrictionTypes, cityId, citySlug }: StreetSheetProps) {
  const navigate = useNavigate();
  const selectedSegmentId = useAppStore((s) => s.selectedSegmentId);
  const selectSegment = useAppStore((s) => s.selectSegment);
  const forecastAt = useAppStore((s) => s.forecastAt);
  const requestCheckSegment = useAppStore((s) => s.requestCheckSegment);


  const addSavedSpot = useDeviceStore((s) => s.addSavedSpot);
  const addFavorite = useDeviceStore((s) => s.addFavorite);
  const removeFavorite = useDeviceStore((s) => s.removeFavorite);
  const isFav = useDeviceStore((s) => s.isFavoriteSegment(selectedSegmentId));
  const favEntry = useDeviceStore((s) => s.favorites.find((f) => f.segmentId === selectedSegmentId));
  const startSession = useDeviceStore((s) => s.startSession);

  const [saveOpen, setSaveOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [notes, setNotes] = useState("");

  const detailsQuery = useQuery({
    queryKey: ["segment-details", selectedSegmentId],
    queryFn: () => getSegmentDetails({ data: { id: selectedSegmentId! } }),
    enabled: !!selectedSegmentId,
    staleTime: 60_000,
  });

  if (!selectedSegmentId) return null;

  const data = detailsQuery.data;
  const segment: StreetSegment | null = data
    ? {
        id: data.id, name: data.name, side: data.side,
        neighborhood: data.neighborhood, coordinates: [],
        rules: data.rules, events: data.events,
      }
    : null;
  const when = forecastAt ?? new Date();
  const status = segment ? evaluateRulesAt(segment, restrictionTypes, when, timezone) : null;
  const coords = (useAppStore.getState().mapCenter
    ? [useAppStore.getState().mapCenter!.lng, useAppStore.getState().mapCenter!.lat]
    : null) as [number, number] | null;

  const handleSave = () => {
    if (!data) return;
    addSavedSpot({
      segmentId: data.id,
      name: data.name,
      nickname: nickname.trim() || data.name,
      notes: notes.trim(),
      coordinates: coords,
    });
    toast.success(`Saved "${nickname.trim() || data.name}"`);
    setSaveOpen(false); setNickname(""); setNotes("");
  };

  const handleFavorite = () => {
    if (!data) return;
    if (isFav && favEntry) {
      removeFavorite(favEntry.id);
      toast.success("Removed from favorites");
    } else {
      addFavorite({
        label: data.name,
        address: data.neighborhood,
        coordinates: coords ?? [0, 0],
        segmentId: data.id,
      });
      toast.success("Added to favorites");
    }
  };

  const handleParkHere = () => {
    if (!data || !status) return;
    startSession({
      segmentId: data.id,
      segmentName: data.name,
      coordinates: coords,
      cityId,
      cityTimezone: timezone,
      initialColor: status.color,
      initialLabel: status.label,
      initialAllowedUntil: status.allowed_until,
      initialReason: status.notes,
      sourceLabel: data.source_label ?? null,
    });
    selectSegment(null);
    navigate({ to: "/session" });
  };

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => selectSegment(null)} />
      <div className="absolute inset-x-0 bottom-0 z-50 safe-bottom animate-in slide-in-from-bottom duration-200">
        <div className="mx-auto max-w-md px-3 pb-3">
          <div className="pc-shadow-card flex max-h-[85vh] flex-col overflow-hidden rounded-3xl border border-[var(--pc-border)] bg-white text-slate-900">
            <div className="shrink-0 px-5 pt-3">
              <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-slate-200" />
            </div>
            <div className="overflow-y-auto overscroll-contain px-5 pb-5 pt-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold leading-tight text-slate-900">
                  {segment?.name ?? (detailsQuery.isLoading ? "Loading…" : "Street")}
                </h2>
                {data?.source_category && (
                  <p className="mt-0.5 text-xs text-slate-500">{data.source_category}</p>
                )}
              </div>
              <button onClick={() => selectSegment(null)} className="pc-bg-gradient-brand rounded-full p-2 text-white" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {status && (
              <div className={cn("mt-4 flex items-center justify-between rounded-2xl border px-4 py-3", COLOR_CLASS[status.color])}>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">
                    {forecastAt ? `At ${formatTime(forecastAt, timezone)}` : "Right now"}
                  </div>
                  <div className="text-lg font-bold">{status.label}</div>
                </div>
                <span className={cn("h-3 w-3 rounded-full ring-4", {
                  "bg-park-green ring-park-green/30": status.color === "green",
                  "bg-park-yellow ring-park-yellow/30": status.color === "yellow",
                  "bg-park-red ring-park-red/30": status.color === "red",
                })} />
              </div>
            )}

            {status && (
              <div className="mt-4 grid grid-cols-1 gap-2 text-sm">
                {status.allowed_until && <Row icon={Clock} label="Allowed until" value={formatTime(new Date(status.allowed_until), timezone)} />}
                {status.permit_zone && <Row icon={ShieldAlert} label="Permit zone" value={status.permit_zone} />}
                {status.time_limit_minutes != null && <Row icon={Timer} label="Max stay" value={`${status.time_limit_minutes} min`} />}
                {status.notes && <Row icon={BadgeInfo} label="Notes" value={status.notes} />}
                {data?.source_label && <Row icon={Database} label="Source" value={data.source_label} />}
              </div>
            )}

            {data && segment && status && (() => {
              const conf = scoreConfidence({
                matchedRule: !!status.rule_id || !!status.event_id,
                conflictCount: 0,
                dataSource: data.data_source,
                ruleCount: data.rules.length,
                lastSyncedAt: null,
              });
              return null; // RiskBadge hidden
            })()}


            {/* Manual Test: evaluate this exact segment, no GPS needed */}
            {data && (
              <button
                type="button"
                onClick={() => {
                  requestCheckSegment(data.id);
                  selectSegment(null);
                }}
                className="pc-bg-gradient-brand pc-shadow-brand mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-bold text-white transition active:scale-95"
              >
                <Navigation className="h-4 w-4" strokeWidth={2.5} />
                Can I park here?
              </button>
            )}

            {/* Action row */}
            {data && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <ActionButton icon={Bookmark} label="Save" onClick={() => setSaveOpen((v) => !v)} active={saveOpen} />
                <ActionButton icon={Heart} label={isFav ? "Favorited" : "Favorite"} onClick={handleFavorite} active={isFav} />
                <ActionButton
                  icon={Car}
                  label="I parked here"
                  onClick={handleParkHere}
                  primary
                  disabled={status?.color === "red"}
                />
              </div>
            )}


            {saveOpen && (
              <div className="mt-3 space-y-2 rounded-2xl bg-[var(--pc-surface)] p-3">
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Nickname (Work Parking, Gym…)"
                  maxLength={60}
                  className="w-full rounded-xl bg-white px-3 py-2 text-sm text-slate-900 outline-none border border-[var(--pc-border)]"
                />
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes (e.g. block 200 side near hydrant)"
                  maxLength={240}
                  rows={2}
                  className="w-full resize-none rounded-xl bg-white px-3 py-2 text-sm text-slate-900 outline-none border border-[var(--pc-border)]"
                />
                <div className="flex gap-2">
                  <button onClick={() => setSaveOpen(false)} className="flex-1 rounded-full bg-slate-200 py-2 text-xs font-semibold text-slate-700">Cancel</button>
                  <button onClick={handleSave} className="pc-bg-gradient-brand flex-1 rounded-full py-2 text-xs font-bold text-white">Save spot</button>
                </div>
              </div>
            )}

            {segment && segment.rules.length > 0 && (() => {
              const sorted = [...segment.rules].sort((a, b) => a.priority - b.priority);
              const winnerId = status?.rule_id ?? null;
              const winner = sorted.find((r) => r.id === winnerId) ?? null;
              return (
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Posted Rules ({sorted.length})
                    </div>
                    <div className="text-[10px] font-medium text-slate-400">Lowest priority wins</div>
                  </div>

                  {winner && (
                    <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-amber-700">
                        <Trophy className="h-3.5 w-3.5" /> Why this rule won
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-amber-900">
                        {explainWinner(winner, sorted)}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    {sorted.map((r) => {
                      const t = restrictionTypes.find((x) => x.code === r.restriction_code);
                      const active = isRuleActiveAt(r, when, timezone);
                      const isWinner = r.id === winnerId;
                      return (
                        <div
                          key={r.id}
                          className={cn(
                            "rounded-2xl border p-3",
                            isWinner
                              ? "border-amber-300 bg-amber-50/60"
                              : "border-transparent bg-[var(--pc-surface)]",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", {
                              "bg-park-green": t?.color === "green",
                              "bg-park-yellow": t?.color === "yellow",
                              "bg-park-red": t?.color === "red",
                              "bg-slate-400": t?.color === "gray" || !t,
                            })} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-slate-900">
                                  {t?.label ?? r.restriction_code}
                                </span>
                                {isWinner && (
                                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900">
                                    Winner
                                  </span>
                                )}
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                                    active
                                      ? "bg-green-100 text-green-800"
                                      : "bg-slate-100 text-slate-500",
                                  )}
                                >
                                  {active ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                                  {active ? "Active now" : "Not active"}
                                </span>
                              </div>
                              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                                <Meta label="Source" value={providerLabel(r.data_source)} />
                                <Meta label="Priority" value={String(r.priority)} mono />
                                <Meta label="Days" value={formatDays(r.days_of_week)} />
                                <Meta label="Hours" value={formatHours(r.time_start, r.time_end)} />
                                <Meta label="Color" value={(t?.color ?? "gray").toUpperCase()} />
                                <Meta label="Code" value={r.restriction_code} mono />
                              </dl>
                              {r.notes && (
                                <p className="mt-1.5 text-[11px] italic text-slate-500">{r.notes}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* DayPlanner hidden for now — component preserved in repo */}
            {/* <div className="mt-4">
              <DayPlannerCard segmentId={selectedSegmentId} citySlug={citySlug} />
            </div> */}

            <div className="mt-5 text-center text-[10px] text-slate-400">
              {data?.source_label ? `Source: ${data.source_label} · ` : ""}Verify posted signs before parking.
            </div>

            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-[var(--pc-surface)] px-4 py-3">
      <span className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function ActionButton({
  icon: Icon, label, onClick, active, primary, disabled,
}: { icon: typeof Clock; label: string; onClick: () => void; active?: boolean; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-3 text-[11px] font-bold transition active:scale-95 disabled:opacity-40",
        primary
          ? "pc-bg-gradient-brand text-white"
          : active
            ? "bg-[color-mix(in_oklab,var(--pc-brand)_15%,white)] text-[var(--pc-brand-end)]"
            : "bg-[var(--pc-surface)] text-slate-700",
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2.4} />
      <span className="leading-tight text-center">{label}</span>
    </button>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">{label}</dt>
      <dd className={cn("truncate text-slate-700", mono && "font-mono text-[10px]")}>{value}</dd>
    </div>
  );
}
