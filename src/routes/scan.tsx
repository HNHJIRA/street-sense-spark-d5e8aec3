// AI Sign Scanner — capture/upload a parking-sign photo, send to the engine
// pipeline, render the engine's verdict.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import type { NormalizedRule } from "@/lib/parking/providers/types";
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
      // eslint-disable-next-line no-console
      console.groupCollapsed("%cDEBUG PIPELINE TRACE", "color:#16a34a;font-weight:bold");
      console.log("1. OCR plates detected:\n", res.debug.ocr_plates_text);
      console.log("2. Interpreted rules:", res.debug.interpreted_rules);
      console.log("   Detected arrows → applies_to:", res.debug.physical_arrow_directions, "→", res.applies_to);
      const activeRule = res.debug.interpreted_rules.find(r => r.id === res.debug.active_rule_id) ?? null;
      console.log("3. Active rule selected:", activeRule);
      console.log("4. Future rules (next, following):", res.next_rule, res.following_rule);
      console.log("5. Timeline rules rendered:", res.debug.timeline_rules);
      console.log("→ Engine decision:", { status: res.status, code: res.decision.code, allowed_until: res.decision.allowed_until });
      console.groupEnd();
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
  // Default the side selector to whichever direction the sign actually
  // addresses — never start in "both" when only one direction was photographed.
  const defaultSide: "left" | "both" | "right" =
    result.applies_to === "LEFT" ? "left"
    : result.applies_to === "RIGHT" ? "right"
    : "both";
  const [side, setSide] = useState<"left" | "both" | "right">(defaultSide);
  const sideEval = result.sides ? result.sides[side] : null;
  const s = sideEval?.summary ?? result.summary;
  const decision = sideEval?.decision ?? result.decision;

  // Loading-zone subtypes are RESTRICTED-USE zones, not parkable spots.
  // The UI must never imply "you may park for N minutes" when the active
  // rule is loading/taxi/bus zone — those time limits are LOADING limits.
  const LOADING_CODES = new Set([
    "loading_zone", "loading", "loading_only",
    "passenger_loading", "commercial_loading", "taxi_zone", "bus_zone",
  ]);
  const activeCode = decision?.code ?? "";
  const isLoading = LOADING_CODES.has(activeCode);

  const palette =
    s.status === "YES"
      ? { ring: "bg-park-green/15", dot: "bg-park-green", text: "text-park-green", icon: Check, title: "Yes, you can park!", subtitle: "Parking is allowed at this spot right now.", untilLabel: "Parking until" }
      : s.status === "NO"
      ? { ring: "bg-park-red/15", dot: "bg-park-red", text: "text-park-red", icon: X, title: "No, you can't park", subtitle: "Parking is not allowed at this spot right now.", untilLabel: "Restriction until" }
      : s.status === "LIMITED"
      ? { ring: "bg-park-yellow/15", dot: "bg-park-yellow", text: "text-park-yellow", icon: AlertTriangle, title: "Limited parking", subtitle: s.plain, untilLabel: isLoading ? "Restriction until" : "Changes at" }
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
  // Like fmtClock but prefixes "Tomorrow at" / "Weekday at" when not today.
  const fmtDayClock = (iso: string | null | undefined, ref?: Date): string | null => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      const r = ref ?? new Date();
      const dayKey = (x: Date) =>
        new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
      const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
      if (dayKey(d) === dayKey(r)) return time;
      const tomorrow = new Date(r.getTime() + 86_400_000);
      if (dayKey(d) === dayKey(tomorrow)) return `Tomorrow at ${time}`;
      const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long" }).format(d);
      return `${wd} at ${time}`;
    } catch { return null; }
  };
  // "9:00 AM" from a "HH:MM" string.
  const fmtHHMM = (hhmm: string | null | undefined): string | null => {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    const d = new Date(); d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const nextChange = s.timeline.find((t) => t.when !== "now");
  const untilTime = isLoading
    ? (fmtClock(decision.restriction_ends_at) ?? nextChange?.when_label ?? null)
    : (nextChange?.when_label ?? null);

  // Applies-To derived from arrow detection + selected side.
  // Applies-To: server is the source of truth (driven by physical arrows).
  // Multiple plates with one arrow are multiple time windows for the SAME
  // direction — never BOTH unless the photo shows it.
  const appliesTo: "LEFT" | "RIGHT" | "BOTH" | "NONE" = result.applies_to;
  const sideClause =
    appliesTo === "LEFT"  ? "on the LEFT side of this sign" :
    appliesTo === "RIGHT" ? "on the RIGHT side of this sign" :
    appliesTo === "BOTH"  ? (result.sides ? "on both sides of this sign" : "across this entire curb area")
                          : "";

  // Per-side rule + time-limit: when arrows split the sign, LEFT vs RIGHT
  // can carry independent rules (e.g. RIGHT=15-min, LEFT=2-hour). The
  // selected `side` must drive these — never the merged top-level result.
  const sideRules = sideEval?.rules ?? result.parsed_rules;
  const sidePrimaryRule = sideRules[0] ?? null;
  const sideTimeLimit =
    sideEval
      ? (sidePrimaryRule?.time_limit_minutes ?? sideEval.decision.time_limit_minutes ?? null)
      : result.time_limit_minutes;

  // Allowed Until: arrival + time_limit, capped at the next restriction start.
  // For YES/LIMITED with a time limit this is distinct from "Next Restriction Starts".
  let allowedUntilIso: string | null = decision.allowed_until ?? null;
  if (sideTimeLimit && (s.status === "LIMITED" || s.status === "YES")) {
    const start = new Date(result.scanned_at).getTime();
    let moveBy = start + sideTimeLimit * 60_000;
    if (decision.restriction_starts_at) {
      const changeMs = new Date(decision.restriction_starts_at).getTime();
      if (Number.isFinite(changeMs) && changeMs < moveBy) moveBy = changeMs;
    }
    allowedUntilIso = new Date(moveBy).toISOString();
  } else if (s.status === "YES" && !allowedUntilIso && decision.restriction_starts_at) {
    // Currently unrestricted but a future restriction begins — surface it.
    allowedUntilIso = decision.restriction_starts_at;
  }
  const scannedRef = new Date(result.scanned_at);
  const allowedUntilLabel = fmtClock(allowedUntilIso);
  const allowedUntilDayLabel = fmtDayClock(allowedUntilIso, scannedRef);
  const nextStartIso = decision.restriction_starts_at ?? result.next_rule?.starts_at ?? null;
  const nextEndIso = decision.restriction_ends_at ?? result.next_rule?.ends_at ?? null;
  const activeRestrictionEndIso = decision.restriction_ends_at ?? result.current_rule?.ends_at ?? null;
  const nextStartLabel = fmtClock(nextStartIso);
  const nextStartDayLabel = fmtDayClock(nextStartIso, scannedRef);
  // For NO: "Parking becomes available" should land 1 minute after the
  // restriction ends ("12:01 PM" rather than "12:00 PM").
  const becomesFreeIso = activeRestrictionEndIso
    ? new Date(new Date(activeRestrictionEndIso).getTime() + 60_000).toISOString()
    : null;
  const nextEndLabel = fmtClock(nextEndIso);
  const becomesFreeDayLabel = fmtDayClock(becomesFreeIso, scannedRef);

  // Rule time windows ("between 9:00 AM and 6:00 PM").
  const ruleWindow = (rs: { starts_at?: string; ends_at?: string } | null | undefined): string | null => {
    if (!rs?.starts_at || !rs?.ends_at) return null;
    const a = fmtClock(rs.starts_at), b = fmtClock(rs.ends_at);
    return a && b ? `between ${a} and ${b}` : null;
  };
  const currentRuleWindow = ruleWindow(result.current_rule ?? null);
  const nextRuleWindow = ruleWindow(result.next_rule ?? null);
  // Posted parsed rule window driven by the selected SIDE (so switching
  // LEFT/RIGHT updates the narrated window).
  const parsedWindow = (() => {
    const r = sidePrimaryRule;
    if (!r) return null;
    const a = fmtHHMM(r.time_start), b = fmtHHMM(r.time_end);
    return a && b ? `between ${a} and ${b}` : null;
  })();

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

  const maxStayLabel = sideTimeLimit
    ? (sideTimeLimit % 60 === 0
        ? `${sideTimeLimit / 60} Hour${sideTimeLimit === 60 ? "" : "s"}`
        : `${sideTimeLimit} minutes`)
    : null;

  // Reason label — prefer the SIDE's own rule when arrows split the sign.
  // CRITICAL: when status is YES with no currently-active engine rule, we
  // must NOT show an inactive plate's code (e.g. "no parking") as the
  // reason — that contradicts the green YES.
  const sideEngineCode = sideEval?.decision?.code ?? null;
  const sideHasActiveRule = !!(sideEngineCode && sideEngineCode !== "free" && sideEngineCode !== "unknown" && sideEngineCode !== "allowed");
  const LOADING_LABELS: Record<string, string> = {
    passenger_loading: "Passenger Loading Only",
    commercial_loading: "Commercial Loading Only",
    taxi_zone: "Taxi Zone",
    bus_zone: "Bus Zone",
    loading_zone: "Loading Zone",
  };
  const sideReasonFromRule = sidePrimaryRule && sideHasActiveRule
    ? (LOADING_LABELS[sidePrimaryRule.restriction_code ?? ""]
        ? `${LOADING_LABELS[sidePrimaryRule.restriction_code!]}${sidePrimaryRule.time_limit_minutes ? ` (${sidePrimaryRule.time_limit_minutes}-minute limit)` : ""}`
        : sidePrimaryRule.time_limit_minutes
          ? `${sidePrimaryRule.time_limit_minutes % 60 === 0 ? `${sidePrimaryRule.time_limit_minutes/60}-hour` : `${sidePrimaryRule.time_limit_minutes}-minute`} parking`
          : (sidePrimaryRule.restriction_code ?? "").replace(/_/g, " "))
    : null;
  const reasonLabel = sideEval
    ? (sideReasonFromRule || (s.status === "YES" ? "Currently allowed" : s.reason) || "Posted restriction")
    : (s.status === "YES"
        ? (result.current_rule?.label ?? "Currently allowed")
        : (result.current_rule?.label ?? s.reason ?? "Posted restriction"));
  const nextReasonLabel = result.next_rule?.label ?? result.next_restriction_reason ?? null;
  const nextRestrictionDetail = result.next_rule
    ? `${result.next_rule.label}${result.next_rule.time_limit_minutes ? ` · ${result.next_rule.time_limit_minutes} Minute Limit` : ""}`
    : nextReasonLabel;

  // moveByLabel kept for the existing "Until card" UI below.
  // For loading zones the user is NOT legally parked — never surface a
  // "Park until 9:17 AM" countdown; show "Restriction until 5:00 PM" instead.
  const moveByLabel = !isLoading && allowedUntilLabel && (s.status === "LIMITED" || (s.status === "YES" && sideTimeLimit))
    ? allowedUntilLabel : null;


  const arrivalClock = new Date(result.scanned_at).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: TZ,
  });
  const nowDay = new Date(result.scanned_at).toLocaleDateString("en-US", {
    weekday: "long", timeZone: TZ,
  });

  // Compute per-side "allowed until" labels when arrows split the sign.
  // Uses the SIDE's own time_limit (not the merged top-level value).
  const computeAllowedUntilForSide = (sideKey: "left" | "right"): string | null => {
    if (!result.sides) return null;
    const sEval = result.sides[sideKey];
    if (!sEval) return null;
    const dec = sEval.decision;
    const sideLimit = sEval.rules[0]?.time_limit_minutes ?? dec.time_limit_minutes ?? null;
    let iso: string | null = dec.allowed_until ?? null;
    if (sideLimit && (sEval.summary.status === "LIMITED" || sEval.summary.status === "YES")) {
      const start = new Date(result.scanned_at).getTime();
      let moveBy = start + sideLimit * 60_000;
      if (dec.restriction_starts_at) {
        const changeMs = new Date(dec.restriction_starts_at).getTime();
        if (Number.isFinite(changeMs) && changeMs < moveBy) moveBy = changeMs;
      }
      iso = new Date(moveBy).toISOString();
    }
    return fmtClock(iso);
  };
  const leftUntil = computeAllowedUntilForSide("left");
  const rightUntil = computeAllowedUntilForSide("right");

  // Per-side rule labels for the combined "both" narrative.
  const limitLabelFor = (min: number | null | undefined): string | null =>
    !min ? null : (min % 60 === 0 ? `${min / 60}-hour` : `${min}-minute`);
  const ruleNounFor = (r: NormalizedRule | null | undefined): string | null => {
    if (!r) return null;
    const lim = limitLabelFor(r.time_limit_minutes);
    if (lim) return `${lim} parking`;
    const code = (r.restriction_code ?? "").replace(/_/g, " ").trim();
    return code || null;
  };
  const leftRule = result.sides?.left.rules[0] ?? null;
  const rightRule = result.sides?.right.rules[0] ?? null;
  const leftRuleLabel = ruleNounFor(leftRule);
  const rightRuleLabel = ruleNounFor(rightRule);
  const leftActive = result.sides
    ? (result.sides.left.summary.status === "LIMITED" ||
       (result.sides.left.summary.status === "YES" && !!leftRule?.time_limit_minutes))
    : false;
  const rightActive = result.sides
    ? (result.sides.right.summary.status === "LIMITED" ||
       (result.sides.right.summary.status === "YES" && !!rightRule?.time_limit_minutes))
    : false;
  const rulesDiffer = !!(
    result.sides && side === "both" && leftRule && rightRule &&
    (leftRule.time_limit_minutes !== rightRule.time_limit_minutes ||
      leftRule.restriction_code !== rightRule.restriction_code)
  );
  const sidesDiffer = !!(result.sides && leftUntil && rightUntil && leftUntil !== rightUntil && side === "both") || rulesDiffer;
  // MIXED_RULES: user picked "both" but each side carries a distinct rule.
  // We must NOT collapse the two into one allowed-until / max-stay.
  const mixedMode = side === "both" && rulesDiffer;

  const sideWindowFor = (r: NormalizedRule | null): string | null => {
    if (!r) return null;
    const a = fmtHHMM(r.time_start), b = fmtHHMM(r.time_end);
    return a && b ? `from ${a} to ${b}` : null;
  };
  const bothWindow = sideWindowFor(leftRule) ?? sideWindowFor(rightRule);
  const leftWindow = sideWindowFor(leftRule);
  const rightWindow = sideWindowFor(rightRule);
  const leftRuleHeading = leftRuleLabel ? capitalizeWords(leftRuleLabel) : "Posted rule";
  const rightRuleHeading = rightRuleLabel ? capitalizeWords(rightRuleLabel) : "Posted rule";

  const officerParagraph = buildOfficerParagraph({
    status: s.status,
    reason: reasonLabel,
    appliesTo,
    hasArrows: !!result.sides,
    nowClock: arrivalClock,
    nowDay,
    allowedUntilLabel,
    allowedUntilDayLabel,
    maxStayLabel,
    timeLimitMinutes: sideTimeLimit ?? null,
    nextReasonLabel,
    nextStartLabel,
    nextStartDayLabel,
    nextEndLabel,
    becomesFreeDayLabel,
    currentRuleWindow,
    nextRuleWindow,
    parsedWindow,
    currentRuleActive: !!result.current_rule,
    sidesDiffer,
    leftUntil,
    rightUntil,
    leftRuleLabel,
    rightRuleLabel,
    leftActive,
    rightActive,
    bothWindow,
    restrictionStartsLabel: nextStartLabel,
    decisionConfidence: result.decision_confidence ?? 0,
    activeCode,
    loadingActivity: isLoading
      ? (activeCode === "passenger_loading"
          ? "You may briefly stop to pick up or drop off passengers."
          : activeCode === "commercial_loading"
            ? "You may stop only for active commercial loading or unloading by qualifying vehicles."
            : activeCode === "taxi_zone"
              ? "Reserved for taxis actively picking up or dropping off passengers."
              : activeCode === "bus_zone"
                ? "Reserved for transit buses — do not stop or park here."
                : "Stops are allowed only for active loading or unloading.")
      : null,
    restrictionEndLabel: fmtClock(decision.restriction_ends_at),
    currentRuleStartLabel: fmtClock(result.current_rule?.starts_at ?? null),
    currentRuleEndLabel: fmtClock(result.current_rule?.ends_at ?? null),
    nextRuleLabel: result.next_rule?.label ?? null,
    nextRuleTimeLimit: result.next_rule?.time_limit_minutes ?? null,
    nextRuleStartLabel: fmtClock(result.next_rule?.starts_at ?? null),
    nextRuleEndLabel: fmtClock(result.next_rule?.ends_at ?? null),
  });
  // sideClause/timeRemainingLabel intentionally unused here but kept for other UI.
  void sideClause; void timeRemainingLabel;

  // Warn when an upcoming side restriction begins soon (≤ 90 min).
  let soonWarning = "";
  if (s.status === "YES" && decision.restriction_starts_at) {
    const startsMs = new Date(decision.restriction_starts_at).getTime();
    const minsUntil = Math.round((startsMs - new Date(result.scanned_at).getTime()) / 60_000);
    if (minsUntil > 0 && minsUntil <= 90) {
      const what = nextReasonLabel ?? (sidePrimaryRule?.time_limit_minutes
        ? `${sidePrimaryRule.time_limit_minutes}-minute parking`
        : "the next posted restriction");
      soonWarning = ` Heads up — ${what.toLowerCase()} begins in about ${minsUntil} minute${minsUntil === 1 ? "" : "s"}.`;
    }
  }
  // -------- HIGH-RISK FUTURE AWARENESS --------
  // Surface tow-away / no-parking / street-cleaning / permit windows that
  // appear ANYWHERE in the timeline (current, next, following), so the
  // driver is never surprised by a future high-risk restriction.
  const HIGH_RISK_PRIORITY: Array<{ codes: string[]; label: string; isParking?: boolean }> = [
    { codes: ["tow_away"], label: "Tow-Away No Parking" },
    { codes: ["no_parking"], label: "No Parking" },
    { codes: ["no_stopping", "red_curb"], label: "No Stopping" },
    { codes: ["street_cleaning", "street_sweeping"], label: "Street Cleaning" },
    { codes: ["permit", "permit_parking", "rpz"], label: "Permit Parking" },
  ];
  const activeRestrictionType = result.current_rule?.restriction_type ?? null;
  const awarenessSentences: string[] = [];
  const seenLabels = new Set<string>();
  for (const tier of HIGH_RISK_PRIORITY) {
    for (const r of result.debug.timeline_rules) {
      if (!tier.codes.includes(r.restriction_type)) continue;
      // Skip the currently-active rule slot — already described above.
      if (r.slot === "CURRENT" && r.restriction_type === activeRestrictionType) continue;
      if (seenLabels.has(tier.label)) continue;
      seenLabels.add(tier.label);
      const startClock = fmtClock(r.starts_at);
      const endClock = fmtClock(r.ends_at);
      const windowStr = startClock && endClock ? ` from ${startClock} to ${endClock}` : "";
      awarenessSentences.push(
        `Be aware that this curb becomes a ${tier.label} zone${windowStr} (${r.time_until_human.toLowerCase()}).`,
      );
    }
  }
  const awarenessBlock = awarenessSentences.length ? " " + awarenessSentences.join(" ") : "";
  const officerParagraphWithWarning = officerParagraph + soonWarning + awarenessBlock;


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
          <DetailRow
            label={isLoading ? "Restriction until" : "Allowed until"}
            value={
              isLoading
                ? (fmtClock(decision.restriction_ends_at) ?? "—")
                : (allowedUntilLabel ?? "—")
            }
          />
          <DetailRow label="Time remaining" value={timeRemainingLabel ?? "—"} />
          <DetailRow label={isLoading ? "Loading time limit" : "Maximum stay"} value={maxStayLabel ?? "No limit"} />
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
          {officerParagraphWithWarning}
        </p>
        {(result.left_summary || result.right_summary) && appliesTo === "BOTH" && (
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

      {/* Debug panel — OCR → Arrows → Interpreted Rules → Active Rule → Decision */}
      <details className="rounded-3xl border border-dashed border-border bg-surface/40 p-4 text-xs">
        <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Debug: pipeline trace
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <div className="font-bold text-foreground">OCR plates</div>
            <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-background p-2 text-[11px] text-muted-foreground">
{result.debug.ocr_plates_text || "(none)"}
            </pre>
          </div>
          <div>
            <div className="font-bold text-foreground">Detected arrows</div>
            <div className="mt-1 text-muted-foreground">
              {result.debug.physical_arrow_directions.length
                ? result.debug.physical_arrow_directions.join(", ")
                : "(none)"} → applies_to = <span className="font-bold text-foreground">{result.applies_to}</span>
            </div>
          </div>
          <div>
            <div className="font-bold text-foreground">Interpreted rules ({result.debug.interpreted_rules.length})</div>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              {result.debug.interpreted_rules.map((r, i) => {
                const active = result.debug.active_rule_id === r.id;
                return (
                  <li key={i} className={cn(active && "font-bold text-park-green")}>
                    [{(r.arrow ?? "NONE").toString().toUpperCase()}] {r.restriction_code}
                    {r.time_start && r.time_end ? ` · ${r.time_start}–${r.time_end}` : " · all day"}
                    {r.time_limit_minutes ? ` · ${r.time_limit_minutes} min limit` : ""}
                    {active ? "  ← ACTIVE NOW" : ""}
                  </li>
                );
              })}
            </ol>
          </div>
          <div>
            <div className="font-bold text-foreground">Timeline rules ({result.debug.timeline_rules.length})</div>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              {result.debug.timeline_rules.map((r, i) => (
                <li key={i} className={cn(r.slot === "CURRENT" && "font-bold text-park-green")}>
                  [{r.slot}] {r.label}
                  {r.time_limit_minutes ? ` · ${r.time_limit_minutes} min limit` : ""}
                  {" · "}{r.starts_at_human} → {r.ends_at_human}
                  {r.slot !== "CURRENT" ? ` · in ${r.time_until_human}` : ""}
                </li>
              ))}
              {result.debug.timeline_rules.length === 0 && <li>(none)</li>}
            </ol>
          </div>
          <div>
            <div className="font-bold text-foreground">Engine decision</div>
            <div className="mt-1 text-muted-foreground">
              status=<span className="font-bold text-foreground">{result.status}</span> ·
              code={result.decision.code} ·
              rule_id={result.debug.active_rule_id ?? "(none)"} ·
              allowed_until={result.decision.allowed_until ?? "—"}
            </div>
          </div>
        </div>
      </details>


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

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

interface OfficerArgs {
  status: "YES" | "NO" | "LIMITED" | "UNKNOWN";
  reason: string;
  appliesTo: "LEFT" | "RIGHT" | "BOTH" | "NONE";
  hasArrows: boolean;
  nowClock: string;
  nowDay: string;
  allowedUntilLabel: string | null;
  allowedUntilDayLabel: string | null;
  maxStayLabel: string | null;
  timeLimitMinutes: number | null;
  nextReasonLabel: string | null;
  nextStartLabel: string | null;
  nextStartDayLabel: string | null;
  nextEndLabel: string | null;
  becomesFreeDayLabel: string | null;
  currentRuleWindow: string | null;
  nextRuleWindow: string | null;
  parsedWindow: string | null;
  currentRuleActive: boolean;
  sidesDiffer: boolean;
  leftUntil: string | null;
  rightUntil: string | null;
  leftRuleLabel: string | null;
  rightRuleLabel: string | null;
  leftActive: boolean;
  rightActive: boolean;
  bothWindow: string | null;
  restrictionStartsLabel: string | null;
  decisionConfidence: number;
  /** Engine code for the currently active rule (e.g. "passenger_loading"). */
  activeCode: string | null;
  /** Plain-English description of who may use a loading/taxi/bus zone. */
  loadingActivity: string | null;
  /** Clock label for restriction_ends_at, used by loading-zone narratives. */
  restrictionEndLabel: string | null;
  /** Current rule start clock label (e.g. "12:00 AM"). */
  currentRuleStartLabel: string | null;
  /** Current rule end clock label. */
  currentRuleEndLabel: string | null;
  /** Next rule reason label. */
  nextRuleLabel: string | null;
  /** Next rule time-limit minutes (distinct from current). */
  nextRuleTimeLimit: number | null;
  /** Next rule start/end clock labels. */
  nextRuleStartLabel: string | null;
  nextRuleEndLabel: string | null;
}

// Narrator-only side phrase. Uses ONLY the supplied arrow value — never guesses.
// Matches the spec verbiage exactly: "for the right side" / "for the left side"
// / "for both directions" / "for this location".
function sidePhrase(appliesTo: OfficerArgs["appliesTo"], hasArrows: boolean): string {
  if (!hasArrows || appliesTo === "NONE") return "for this location";
  if (appliesTo === "LEFT") return "for the left side";
  if (appliesTo === "RIGHT") return "for the right side";
  if (appliesTo === "BOTH") return "for both directions";
  return "for this location";
}

/**
 * Anti-hallucination narrator. Does NOT decide parking legality and does NOT
 * invent any facts. Every clause traces back to a structured input field; if
 * a field is missing the clause is dropped — never guessed, never estimated.
 *
 * Output style follows the "parking attendant" spec:
 *   YES./NO./LIMITED./UNKNOWN. it is currently {time} on {day}.
 *   <one or two short, conversational sentences>
 */
function buildOfficerParagraph(a: OfficerArgs): string {
  const directionSentence =
    a.appliesTo === "LEFT"  ? " This sign applies to the LEFT side." :
    a.appliesTo === "RIGHT" ? " This sign applies to the RIGHT side." :
    a.appliesTo === "BOTH"  ? " This sign applies to BOTH sides." : "";
  const prefix = `it is currently ${a.nowClock} on ${a.nowDay}.${directionSentence}`;

  // Confidence gate — below 0.65 we refuse to narrate the decision.
  if (a.status === "UNKNOWN" || a.decisionConfidence < 0.65) {
    return `UNKNOWN. ${prefix} The sign could not be interpreted with sufficient confidence. Please inspect the sign manually.`;
  }

  const side = sidePhrase(a.appliesTo, a.hasArrows);

  // -------- LOADING / TAXI / BUS ZONES (restricted-use, never "parkable") --------
  // These are NOT parking — even when the engine reports LIMITED with a
  // time limit, that limit is a LOADING limit, not a parking allowance.
  if (a.activeCode && a.loadingActivity) {
    const reasonNoLimit = (a.reason || "").replace(/\s*\([^)]*\)\s*$/, "").trim() || "Loading Only";
    const start = a.currentRuleStartLabel;
    const end = a.currentRuleEndLabel ?? a.restrictionEndLabel;
    const activeWindow = start && end
      ? `${reasonNoLimit} is active from ${start} until ${end}.`
      : end
        ? `${reasonNoLimit} is active until ${end}.`
        : `${reasonNoLimit} is currently active.`;
    const limitLine = a.timeLimitMinutes
      ? (end
          ? `A ${a.timeLimitMinutes}-minute loading limit applies until ${end}.`
          : `A ${a.timeLimitMinutes}-minute loading limit applies.`)
      : "";
    const nextLine = (() => {
      if (!a.nextRuleLabel) return "";
      const nextLimit = a.nextRuleTimeLimit
        ? `${a.nextRuleTimeLimit}-minute loading limit`
        : null;
      const untilNext = a.nextRuleEndLabel ? ` until ${a.nextRuleEndLabel}` : "";
      const after = end ? `After ${end} the rule changes to: ${a.nextRuleLabel}` : `Next: ${a.nextRuleLabel}`;
      return nextLimit ? `${after}, ${nextLimit}${untilNext}.` : `${after}${untilNext}.`;
    })();
    return [
      `LIMITED. ${prefix}`,
      activeWindow,
      "General parking is not permitted during this period.",
      a.loadingActivity,
      limitLine,
      nextLine,
    ].filter(Boolean).join(" ");
  }

  // -------- NO PARKING --------
  if (a.status === "NO") {
    const reasonLc = (a.reason || "no-parking").toLowerCase();
    const window = a.currentRuleWindow ?? a.parsedWindow;
    const windowClause = window ? ` ${window}` : "";
    const becomes = a.becomesFreeDayLabel ?? a.nextEndLabel;
    const endTail = becomes ? ` Parking becomes available again at ${becomes}.` : "";
    return `NO. ${prefix} A ${reasonLc} restriction ${side} is currently active${windowClause}. Parking is not allowed at this time.${endTail}`;
  }

  // -------- YES / LIMITED — currently parkable --------

  // Multi-side combined narrative — different rules and/or end times per direction.
  if (a.sidesDiffer && (a.leftRuleLabel || a.rightRuleLabel || (a.leftUntil && a.rightUntil))) {
    const rightLbl = a.rightRuleLabel ?? "posted";
    const leftLbl = a.leftRuleLabel ?? "posted";
    const bothActive = a.leftActive && a.rightActive;
    const neitherActive = !a.leftActive && !a.rightActive;
    if (bothActive) {
      const rightTail = a.rightUntil ? ` If you park on the right side, you must leave by ${a.rightUntil}.` : "";
      const leftTail = a.leftUntil ? ` If you park on the left side, you may remain until ${a.leftUntil}.` : "";
      return `YES. ${prefix} The ${rightLbl} restriction for the right side and the ${leftLbl} restriction for the left side are currently active.${rightTail}${leftTail}`;
    }
    if (neitherActive) {
      const windowClause = a.bothWindow ? ` ${a.bothWindow}` : "";
      const untilTailNeither = (a.allowedUntilDayLabel ?? a.allowedUntilLabel)
        ? ` You can park here until ${a.allowedUntilDayLabel ?? a.allowedUntilLabel}.`
        : "";
      return `YES. ${prefix} The ${rightLbl} restriction for the right side and the ${leftLbl} restriction for the left side both apply${windowClause}. Since it is currently outside that window, these time limits are not active.${untilTailNeither}`;
    }
    // Mixed: fall back to per-side end times.
    if (a.leftUntil && a.rightUntil) {
      return `YES. ${prefix} The ${rightLbl} restriction for the right side allows parking until ${a.rightUntil}, and the ${leftLbl} restriction for the left side allows parking until ${a.leftUntil} because different rules apply to each direction.`;
    }
  }

  const untilLabel = a.allowedUntilDayLabel ?? a.allowedUntilLabel;
  const untilTail = untilLabel ? ` You can park here until ${untilLabel}.` : "";
  const reasonLc = (a.reason || "").toLowerCase();
  const hasLimit = !!(a.timeLimitMinutes && a.timeLimitMinutes > 0);
  const limitLabel = a.maxStayLabel
    ? a.maxStayLabel.toLowerCase()
    : hasLimit
      ? `${a.timeLimitMinutes}-minute`
      : null;

  // Currently inside a time-limited window (e.g. 15-min / 2-hour parking).
  if (a.currentRuleActive && hasLimit && limitLabel) {
    const window = a.currentRuleWindow ? ` between ${a.currentRuleWindow.replace(/^between /, "")}` : "";
    const upTo = ` You may park here for up to ${limitLabel}.`;
    return `YES. ${prefix} The ${limitLabel} parking restriction ${side} is currently active${window}.${upTo}${untilTail}`;
  }

  // Restriction exists but is NOT active right now (we're outside the window).
  if (!a.currentRuleActive && (a.nextRuleWindow || a.parsedWindow)) {
    const rawWindow = (a.nextRuleWindow ?? a.parsedWindow)!;
    const window = rawWindow.replace(/^between /, "from ").replace(/ and /, " to ");
    const what = limitLabel
      ? `${limitLabel} parking`
      : a.nextReasonLabel
        ? a.nextReasonLabel.toLowerCase()
        : reasonLc || "posted";
    return `YES. ${prefix} The ${what} restriction ${side} applies ${window}. Since it is currently outside that window, this time limit is not active.${untilTail}`;
  }

  // Currently inside a non-time-limited active rule we can still park under.
  if (a.currentRuleActive && reasonLc && reasonLc !== "free parking") {
    const window = a.currentRuleWindow ? ` ${a.currentRuleWindow}` : "";
    return `YES. ${prefix} ${capitalize(reasonLc)} applies ${side}${window}.${untilTail}`;
  }

  // No posted restriction in play.
  return `YES. ${prefix} Parking is currently allowed here.${untilTail}`;
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}


