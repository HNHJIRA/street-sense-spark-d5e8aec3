// AI Sign Scanner — capture/upload a parking-sign photo, send to the engine
// pipeline, render the engine's verdict.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import {
  Camera, Upload, Loader2, ArrowLeft, ScanLine,
  Check, X, AlertTriangle, HelpCircle, Bell, MessageSquare,
  ArrowLeftRight, ArrowRight, Clock,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { LocationStatusCard } from "@/components/LocationStatusCard";
import { getCityInfo } from "@/lib/parking/parking.functions";
import { scanSign, type SignScanResponse } from "@/lib/parking/scan.functions";
import { useLocationStore } from "@/stores/location-store";
import { cn } from "@/lib/utils";

const cityOpts = queryOptions({
  queryKey: ["parking", "city", "seattle"],
  queryFn: () => getCityInfo({ data: { citySlug: "seattle" } }),
  staleTime: 5 * 60 * 1000,
});

export const Route = createFileRoute("/scan")({
  head: () => ({ meta: [{ title: "Scan a parking sign — ParkClear" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(cityOpts),
  component: ScanPage,
});

function ScanPage() {
  const city = useSuspenseQuery(cityOpts).data;
  const scan = useServerFn(scanSign);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SignScanResponse | null>(null);

  // Global location store — single source of truth across pages.
  const liveLocation = useLocationStore((s) => s.current);
  const lastKnown = useLocationStore((s) => s.lastKnown);
  const locStatus = useLocationStore((s) => s.status);

  const reset = () => {
    setResult(null); setPreviewUrl(null); setError(null);
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  };

  const onFile = async (inputFile: File) => {
    setError(null); setResult(null);
    if (inputFile.size > 12 * 1024 * 1024) {
      setError("Image must be under 12 MB. Try a different photo.");
      return;
    }

    setLoading(true);
    try {
      let file = inputFile;
      // HEIC/HEIF from iOS cameras won't render in <img>. Convert to JPEG client-side.
      const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
      if (isHeic) {
        try {
          const { default: heic2any } = await import("heic2any");
          const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
          const blob = Array.isArray(converted) ? converted[0] : converted;
          file = new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
        } catch {
          setError("Couldn't convert this HEIC image. Try uploading a JPG/PNG instead.");
          setLoading(false);
          return;
        }
      }
      if (file.size > 8 * 1024 * 1024) {
        setError("Image must be under 8 MB after conversion. Try a smaller photo.");
        setLoading(false);
        return;
      }
      const base64 = await fileToBase64(file);
      const mimeType = file.type || "image/jpeg";
      // Use a data URL for preview so it renders reliably across browsers
      // (blob: URLs can be flaky on some mobile WebViews / privacy modes).
      setPreviewUrl(`data:${mimeType};base64,${base64}`);
      // Use the global GPS store — live fix, then last-known, then null.
      const fix = liveLocation ?? lastKnown;
      const res = await scan({
        data: {
          cityId: city.id, citySlug: city.slug, timezone: "America/Los_Angeles",
          imageBase64: base64,
          mimeType,
          lng: fix?.lng ?? null, lat: fix?.lat ?? null,
        },
      });
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background pb-32">
      <div className="safe-top mx-auto max-w-md px-5 pt-6">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> Map
          </Link>
          <span className="rounded-full bg-primary/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
            AI Sign Scanner
          </span>
        </div>

        <h1 className="mt-4 font-display text-2xl font-bold leading-tight">Scan a parking sign</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Snap any posted sign. The AI extracts the rule, then the ParkClear engine answers
          <b> Can I park here?</b> using your location.
        </p>

        {/* Global GPS status — same source of truth as map/session. */}
        <LocationStatusCard
          live={liveLocation}
          lastKnown={lastKnown}
          status={locStatus}
        />

        {/* Capture / upload */}
        {!result && (
          <div className="mt-5 space-y-3">
            <div className="aspect-[4/5] overflow-hidden rounded-3xl border border-dashed border-border bg-surface/40">
              {previewUrl ? (
                <img src={previewUrl} alt="Captured sign" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <ScanLine className="h-10 w-10" />
                  <div className="text-xs">No image yet</div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={loading}
                onClick={() => cameraRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
              >
                <Camera className="h-4 w-4" /> Take photo
              </button>
              <button
                disabled={loading}
                onClick={() => fileRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-full bg-surface py-3 text-sm font-semibold disabled:opacity-60"
              >
                <Upload className="h-4 w-4" /> Upload
              </button>
            </div>

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
            />

            {loading && (
              <div className="flex items-center justify-center gap-2 rounded-2xl bg-surface px-4 py-3 text-sm font-semibold text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Reading sign and running rules engine…
              </div>
            )}
            {error && (
              <div className="rounded-2xl border border-park-red/40 bg-park-red-soft px-4 py-3 text-sm text-park-red">
                {error}
              </div>
            )}
          </div>
        )}

        {result && <ScanResult result={result} previewUrl={previewUrl} onReset={reset} />}
      </div>
      <BottomNav />
    </div>
  );
}

function ScanResult({
  result, previewUrl, onReset,
}: { result: SignScanResponse; previewUrl: string | null; onReset: () => void }) {
  const [side, setSide] = useState<"left" | "both" | "right">("both");
  const sideEval = result.sides ? result.sides[side] : null;
  const s = sideEval?.summary ?? result.summary;
  const decision = sideEval?.decision ?? result.decision;

  const palette =
    s.status === "YES"
      ? { ring: "bg-park-green/15", dot: "bg-park-green", text: "text-park-green", icon: Check, title: "Yes, you can park!", subtitle: "Parking is allowed at this spot right now.", untilLabel: "Parking until" }
      : s.status === "NO"
      ? { ring: "bg-park-red/15", dot: "bg-park-red", text: "text-park-red", icon: X, title: "No, you can't park", subtitle: "Parking is not allowed at this spot right now.", untilLabel: "Restriction until" }
      : s.status === "LIMITED"
      ? { ring: "bg-park-yellow/15", dot: "bg-park-yellow", text: "text-park-yellow", icon: AlertTriangle, title: "Limited parking", subtitle: s.plain, untilLabel: "Changes at" }
      : { ring: "bg-muted", dot: "bg-muted-foreground", text: "text-foreground", icon: HelpCircle, title: "Unclear sign", subtitle: "We couldn't fully read this sign.", untilLabel: "Next change" };

  const Icon = palette.icon;

  const TZ = "America/Los_Angeles";
  const fmtClock = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: TZ,
      });
    } catch { return null; }
  };

  const nextChange = s.timeline.find((t) => t.when !== "now");
  const untilTime = nextChange?.when_label ?? null;

  // Applies-To derived from arrow detection + selected side.
  const appliesTo: "LEFT" | "RIGHT" | "BOTH" | "NONE" =
    s.status === "UNKNOWN" && result.parsed_rules.length === 0
      ? "NONE"
      : result.sides
        ? (side === "left" ? "LEFT" : side === "right" ? "RIGHT" : "BOTH")
        : "BOTH";
  const sideClause =
    appliesTo === "LEFT"  ? "on the LEFT side of this sign" :
    appliesTo === "RIGHT" ? "on the RIGHT side of this sign" :
    appliesTo === "BOTH"  ? (result.sides ? "on both sides of this sign" : "across this entire curb area")
                          : "";

  // Allowed Until: arrival + time_limit, capped at the next restriction start.
  // For YES/LIMITED with a time limit this is distinct from "Next Restriction Starts".
  let allowedUntilIso: string | null = decision.allowed_until ?? null;
  if (result.time_limit_minutes && (s.status === "LIMITED" || s.status === "YES")) {
    const start = new Date(result.scanned_at).getTime();
    let moveBy = start + result.time_limit_minutes * 60_000;
    if (decision.restriction_starts_at) {
      const changeMs = new Date(decision.restriction_starts_at).getTime();
      if (Number.isFinite(changeMs) && changeMs < moveBy) moveBy = changeMs;
    }
    allowedUntilIso = new Date(moveBy).toISOString();
  }
  const allowedUntilLabel = fmtClock(allowedUntilIso);
  const nextStartLabel = fmtClock(decision.restriction_starts_at);
  const nextEndLabel = fmtClock(decision.restriction_ends_at);

  // Live countdown to allowed_until.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  let timeRemainingLabel: string | null = null;
  if (allowedUntilIso) {
    const diff = Math.floor((new Date(allowedUntilIso).getTime() - nowMs) / 1000);
    if (diff <= 0) timeRemainingLabel = "Expired";
    else {
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const sec = diff % 60;
      timeRemainingLabel = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec.toString().padStart(2, "0")}s` : `${sec}s`;
    }
  }

  const maxStayLabel = result.time_limit_minutes
    ? (result.time_limit_minutes % 60 === 0
        ? `${result.time_limit_minutes / 60} Hour${result.time_limit_minutes === 60 ? "" : "s"}`
        : `${result.time_limit_minutes} minutes`)
    : null;

  const reasonLabel = result.current_rule?.label ?? s.reason ?? "Posted restriction";
  const nextReasonLabel = result.next_rule?.label ?? result.next_restriction_reason ?? null;

  // moveByLabel kept for the existing "Until card" UI below.
  const moveByLabel = allowedUntilLabel && (s.status === "LIMITED" || (s.status === "YES" && result.time_limit_minutes))
    ? allowedUntilLabel : null;

  const arrivalClock = new Date(result.scanned_at).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: TZ,
  });
  const officerParagraph = buildOfficerParagraph({
    status: s.status,
    reason: reasonLabel,
    sideClause,
    arrivalClock,
    allowedUntilLabel,
    timeRemainingLabel,
    maxStayLabel,
    nextReasonLabel,
    nextStartLabel,
    nextEndLabel,
    permitZone: decision.permit_zone,
  });


  return (
    <div className="mt-5 space-y-5">
      {/* Directional arrow chooser — only shown when AI detected ←/→ arrows */}
      {result.sides && (
        <div className="rounded-3xl border border-border bg-surface/60 p-4">
          <div className="mb-2 flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold text-foreground">Which side of the post?</span>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            This sign has directional arrows — different rules apply on each side. Pick where your car is.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { key: "left",  label: "Left",  Icon: ArrowLeft },
              { key: "both",  label: "Both",  Icon: ArrowLeftRight },
              { key: "right", label: "Right", Icon: ArrowRight },
            ] as const).map(({ key, label, Icon: I }) => (
              <button
                key={key}
                onClick={() => setSide(key)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-bold transition",
                  side === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                <I className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hero status */}
      <div className="flex flex-col items-center pt-2 text-center">
        <div className={cn("flex h-28 w-28 items-center justify-center rounded-full", palette.ring)}>
          <div className={cn("flex h-20 w-20 items-center justify-center rounded-full", palette.dot)}>
            <Icon className="h-10 w-10 text-white" strokeWidth={3} />
          </div>
        </div>
        <h2 className={cn("mt-5 font-display text-3xl font-extrabold leading-tight", palette.text)}>
          {palette.title}
        </h2>
        <p className="mt-2 px-4 text-sm text-muted-foreground">{palette.subtitle}</p>
      </div>

      {/* Until card */}
      {(untilTime || moveByLabel) && (
        <div className="rounded-3xl bg-surface p-5">
          {moveByLabel && (
            <>
              <div className="text-[11px] font-bold uppercase tracking-wider text-park-yellow">
                Park until
              </div>
              <div className="mt-1 font-display text-3xl font-extrabold text-foreground">
                {moveByLabel}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Move your car by this time to avoid a ticket.
              </div>
            </>
          )}
          {untilTime && (
            <div className={cn(moveByLabel && "mt-4 border-t border-border pt-4")}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {palette.untilLabel}
              </div>
              <div className="mt-1 font-display text-2xl font-extrabold text-foreground">
                {untilTime}
              </div>
            </div>
          )}
          <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border-2 border-primary py-3 text-sm font-bold text-primary">
            <Bell className="h-4 w-4" /> Set a reminder
          </button>
        </div>
      )}

      {/* Parking details — structured, enforcement-grade readout. */}
      <div className="rounded-3xl border border-border bg-background p-5">
        <div className="mb-3 text-sm font-bold text-foreground">Parking details</div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          <DetailRow label="Current status" value={
            <span className={cn("font-bold", palette.text)}>{s.status}</span>
          } />
          <DetailRow label="Reason" value={reasonLabel} />
          <DetailRow label="Allowed until" value={allowedUntilLabel ?? "—"} />
          <DetailRow label="Time remaining" value={timeRemainingLabel ?? "—"} />
          <DetailRow label="Maximum stay" value={maxStayLabel ?? "No limit"} />
          <DetailRow label="Next restriction" value={nextReasonLabel ?? "None scheduled"} />
          <DetailRow label="Restriction starts" value={nextStartLabel ?? "—"} />
          <DetailRow label="Restriction ends" value={nextEndLabel ?? "—"} />
          <DetailRow label="Applies to" value={
            appliesTo === "BOTH" && !result.sides
              ? "BOTH (no arrows)"
              : appliesTo === "LEFT" ? "LEFT side"
              : appliesTo === "RIGHT" ? "RIGHT side"
              : appliesTo === "BOTH" ? "BOTH sides" : "NONE"
          } />
          <DetailRow label="Confidence" value={`${Math.round(result.decision_confidence * 100)}%`} />
        </dl>
      </div>

      {/* AI driver summary — enforcement-officer style paragraph. */}
      <div className="rounded-3xl border border-border bg-background p-5">
        <div className="mb-2 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold text-foreground">AI summary</span>
        </div>
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
          {officerParagraph}
        </p>
        {(result.left_summary || result.right_summary) && (
          <div className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
            {result.left_summary && <p>{result.left_summary}</p>}
            {result.right_summary && <p>{result.right_summary}</p>}
          </div>
        )}
        <div className="mt-3 flex gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>OCR {Math.round(result.ocr_confidence * 100)}%</span>
          <span>Interp {Math.round(result.interpretation_confidence * 100)}%</span>
          <span>Decision {Math.round(result.decision_confidence * 100)}%</span>
        </div>
      </div>


      {/* Upcoming rules timeline (Edge case 1 / 10) */}
      {(result.current_rule || result.next_rule || result.following_rule) && (
        <div className="rounded-3xl border border-border bg-background p-5">
          <div className="mb-3 text-sm font-bold text-foreground">Rule timeline</div>
          <div className="space-y-3 text-xs">
            {result.current_rule && (
              <div>
                <div className="font-semibold text-foreground">Current: {result.current_rule.label}</div>
                <div className="text-muted-foreground">Active until {result.current_rule.ends_at_human}</div>
              </div>
            )}
            {result.next_rule && (
              <div>
                <div className="font-semibold text-foreground">Next: {result.next_rule.label}</div>
                <div className="text-muted-foreground">
                  Begins {result.next_rule.starts_at_human}
                  {result.countdown_to_next_rule ? ` · in ${result.countdown_to_next_rule}` : ""}
                </div>
              </div>
            )}
            {result.following_rule && (
              <div>
                <div className="font-semibold text-foreground">Following: {result.following_rule.label}</div>
                <div className="text-muted-foreground">
                  Begins {result.following_rule.starts_at_human}
                  {result.countdown_to_following_rule ? ` · in ${result.countdown_to_following_rule}` : ""}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Risk + conflict badges */}
      <div className="flex flex-wrap gap-2">
        <span
          className={cn(
            "rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider",
            result.risk_level === "HIGH" && "bg-park-red/15 text-park-red",
            result.risk_level === "MEDIUM" && "bg-park-yellow/15 text-park-yellow",
            result.risk_level === "LOW" && "bg-park-green/15 text-park-green",
          )}
        >
          Risk: {result.risk_level}
        </span>
        {result.permit_required && (
          <span className="rounded-full bg-primary/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
            Permit required
          </span>
        )}
        {result.time_limit_minutes && (
          <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {result.time_limit_minutes} min limit
          </span>
        )}
      </div>

      {result.conflict_detected && (
        <div className="rounded-3xl border border-park-yellow/40 bg-park-yellow-soft p-5 text-sm">
          <div className="mb-1 font-bold text-park-yellow">City data ≠ scanned sign</div>
          <p className="text-xs text-foreground/80">{result.conflict_summary}</p>
        </div>
      )}


      {previewUrl && (
        <img src={previewUrl} alt="Captured sign" className="w-full rounded-3xl border border-border opacity-80" />
      )}

      <button
        onClick={onReset}
        className="w-full rounded-full bg-primary py-3 text-sm font-bold text-primary-foreground"
      >
        Scan another sign
      </button>
      <div className="flex items-center justify-center gap-1.5 text-center text-[10px] text-muted-foreground">
        <Clock className="h-3 w-3" />
        Scanned at{" "}
        {new Date(result.scanned_at).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/Los_Angeles",
          timeZoneName: "short",
        })}
        {" "}(Los Angeles)
        {result.segment ? ` near ${result.segment.name}` : ""}
      </div>
    </div>
  );
}


function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

