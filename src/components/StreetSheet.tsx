import { X, Clock, ShieldAlert, BadgeInfo, Database, Timer, Bookmark, Heart, Car, Navigation } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { getSegmentDetails } from "@/lib/parking/parking.functions";
import { evaluateRulesAt } from "@/lib/parking/engine";
import type { RestrictionType, StreetSegment } from "@/lib/parking/types";
import { useAppStore } from "@/stores/app-store";
import { useDeviceStore } from "@/stores/device-store";
import { cn } from "@/lib/utils";

interface StreetSheetProps {
  timezone: string;
  restrictionTypes: RestrictionType[];
  cityId: string;
}

const COLOR_CLASS = {
  green: "bg-park-green-soft text-park-green border-park-green/40",
  yellow: "bg-park-yellow-soft text-park-yellow border-park-yellow/40",
  red: "bg-park-red-soft text-park-red border-park-red/40",
} as const;

function formatTime(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function StreetSheet({ timezone, restrictionTypes, cityId }: StreetSheetProps) {
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
          <div className="rounded-3xl border border-border bg-elevated p-5 shadow-2xl">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold leading-tight">
                  {segment?.name ?? (detailsQuery.isLoading ? "Loading…" : "Street")}
                </h2>
                {data?.source_category && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{data.source_category}</p>
                )}
              </div>
              <button onClick={() => selectSegment(null)} className="rounded-full bg-muted p-2 text-muted-foreground hover:text-foreground" aria-label="Close">
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

            {/* Action row */}
            {data && (
              <div className="mt-4 grid grid-cols-3 gap-2">
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
              <div className="mt-3 space-y-2 rounded-2xl bg-surface p-3">
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Nickname (Work Parking, Gym…)"
                  maxLength={60}
                  className="w-full rounded-xl bg-elevated px-3 py-2 text-sm outline-none"
                />
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes (e.g. block 200 side near hydrant)"
                  maxLength={240}
                  rows={2}
                  className="w-full resize-none rounded-xl bg-elevated px-3 py-2 text-sm outline-none"
                />
                <div className="flex gap-2">
                  <button onClick={() => setSaveOpen(false)} className="flex-1 rounded-full bg-muted py-2 text-xs font-semibold">Cancel</button>
                  <button onClick={handleSave} className="flex-1 rounded-full bg-primary py-2 text-xs font-bold text-primary-foreground">Save spot</button>
                </div>
              </div>
            )}

            {segment && segment.rules.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Posted Rules</div>
                <div className="space-y-1.5">
                  {[...segment.rules].sort((a, b) => a.priority - b.priority).map((r) => {
                    const t = restrictionTypes.find((x) => x.code === r.restriction_code);
                    return (
                      <div key={r.id} className="flex items-start gap-3 rounded-2xl bg-surface p-3">
                        <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", {
                          "bg-park-green": t?.color === "green",
                          "bg-park-yellow": t?.color === "yellow",
                          "bg-park-red": t?.color === "red",
                        })} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">{t?.label ?? r.restriction_code}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {r.days_of_week.length === 7 ? "Every day" : r.days_of_week.map((d) => DOW[d]).join(", ")}
                            {r.time_start && r.time_end ? ` · ${r.time_start.slice(0,5)}–${r.time_end.slice(0,5)}` : " · All day"}
                            {r.notes ? ` · ${r.notes}` : ""}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-5 text-center text-[10px] text-muted-foreground">
              {data?.source_label ? `Source: ${data.source_label} · ` : ""}Verify posted signs before parking.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <span className="text-sm font-semibold">{value}</span>
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
          ? "bg-primary text-primary-foreground"
          : active
            ? "bg-primary/20 text-primary"
            : "bg-surface text-foreground",
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2.4} />
      <span className="leading-tight text-center">{label}</span>
    </button>
  );
}
