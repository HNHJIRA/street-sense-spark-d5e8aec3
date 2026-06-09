// AI Sign Scanner — capture/upload a parking-sign photo, send to the engine
// pipeline, render the engine's verdict.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import {
  Camera, Upload, Loader2, ArrowLeft, ScanLine, CheckCircle2, AlertTriangle, XCircle,
  Clock, ShieldAlert, MapPin, Database, FileText,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { getCityInfo } from "@/lib/parking/parking.functions";
import { scanSign, type SignScanResponse } from "@/lib/parking/scan.functions";
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

  const reset = () => {
    setResult(null); setPreviewUrl(null); setError(null);
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  };

  const onFile = async (file: File) => {
    setError(null); setResult(null);
    if (file.size > 6 * 1024 * 1024) {
      setError("Image must be under 6 MB. Try a different photo.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));

    setLoading(true);
    try {
      const base64 = await fileToBase64(file);
      // Use last-known browser geolocation if available — fall back to null.
      const coords = await getCurrentCoordsSafe();
      const res = await scan({
        data: {
          cityId: city.id, citySlug: city.slug, timezone: city.timezone,
          imageBase64: base64,
          mimeType: file.type || "image/jpeg",
          lng: coords?.lng ?? null, lat: coords?.lat ?? null,
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

        {result && <ScanResult result={result} previewUrl={previewUrl} timezone={city.timezone} onReset={reset} />}
      </div>
      <BottomNav />
    </div>
  );
}

function ScanResult({
  result, previewUrl, timezone, onReset,
}: { result: SignScanResponse; previewUrl: string | null; timezone: string; onReset: () => void }) {
  const s = result.summary;
  const tone =
    s.status === "YES" ? { border: "border-park-green/60 bg-park-green-soft", accent: "text-park-green" }
    : s.status === "NO" ? { border: "border-park-red/60 bg-park-red-soft", accent: "text-park-red" }
    : s.status === "LIMITED" ? { border: "border-park-yellow/60 bg-park-yellow-soft", accent: "text-park-yellow" }
    : { border: "border-border bg-surface", accent: "text-foreground" };
  const StatusIcon =
    s.status === "YES" ? CheckCircle2
    : s.status === "NO" ? XCircle
    : s.status === "LIMITED" ? AlertTriangle
    : ShieldAlert;

  return (
    <div className="mt-5 space-y-4">
      {/* Headline summary — driver should grok this in <5s. */}
      <div className={cn("rounded-3xl border-2 p-5 text-foreground", tone.border)}>
        <div className="flex items-center gap-3">
          <StatusIcon className={cn("h-7 w-7", tone.accent)} />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Can I park here?
            </div>
            <div className={cn("font-display text-3xl font-extrabold leading-tight", tone.accent)}>
              {s.status}
            </div>
          </div>
          <span className="ml-auto rounded-full bg-background/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-foreground">
            {s.confidence}
          </span>
        </div>
        <div className="mt-3 text-sm font-semibold leading-snug text-foreground">{s.plain}</div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full bg-background/70 px-2.5 py-1 font-semibold text-foreground">
            {s.reason}
          </span>
          {s.time_guidance && (
            <span className="rounded-full bg-background/70 px-2.5 py-1 font-semibold text-foreground">
              {s.time_guidance}
            </span>
          )}
        </div>
      </div>

      {/* Parking timeline — Now → next change(s). */}
      <section className="rounded-3xl border border-border bg-surface p-4">
        <h2 className="text-sm font-bold">Parking timeline</h2>
        <ol className="mt-3 space-y-3">
          {s.timeline.map((t, i) => (
            <li key={i} className="flex items-start gap-3">
              <TimelineDot icon={t.icon} />
              <div className="flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t.when_label}
                </div>
                <div className="text-sm font-semibold">{t.label}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Compact location/source context. */}
      <div className="grid grid-cols-1 gap-2">
        <Row icon={MapPin} label="Nearest street" value={result.segment ? `${result.segment.name} (${Math.round(result.segment.distance_m)} m)` : "Location not provided"} />
        <Row icon={Database} label="Data source" value={result.source_label} />
      </div>

      {/* Why? — collapsed by default. */}
      <details className="rounded-3xl border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-bold">Why this decision?</summary>
        <div className="mt-3 grid grid-cols-1 gap-2">
          {result.decision.allowed_until && (
            <Row icon={Clock} label="Allowed until"
                 value={new Date(result.decision.allowed_until).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: timezone })} />
          )}
          {result.decision.restriction_starts_at && (
            <Row icon={Clock} label="Restriction starts"
                 value={new Date(result.decision.restriction_starts_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: timezone })} />
          )}
          {result.decision.restriction_ends_at && (
            <Row icon={Clock} label="Restriction ends"
                 value={new Date(result.decision.restriction_ends_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: timezone })} />
          )}
          {result.decision.permit_zone && (
            <Row icon={ShieldAlert} label="Permit zone" value={result.decision.permit_zone} />
          )}
          {result.decision.time_limit_minutes != null && (
            <Row icon={Clock} label="Max stay" value={`${result.decision.time_limit_minutes} min`} />
          )}
          <Row icon={ScanLine} label="AI confidence" value={`${Math.round((result.overall_confidence || 0) * 100)}%`} />
        </div>
      </details>

      {result.parsed_rules.length > 0 && (
        <details className="rounded-3xl border border-border bg-surface p-4">
          <summary className="cursor-pointer flex items-center gap-2 text-sm font-bold">
            <FileText className="h-4 w-4 text-primary" /> Extracted sign rules
          </summary>
          <ul className="mt-3 space-y-2">
            {result.parsed_rules.map((r, i) => (
              <li key={i} className="rounded-2xl bg-background px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider">{r.restriction_code.replace(/_/g, " ")}</span>
                  <span className="text-[10px] text-muted-foreground">{daysLabel(r.days_of_week)}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {r.time_start && r.time_end ? `${r.time_start}–${r.time_end}` : "All day"}
                  {r.permit_zone ? ` · Zone ${r.permit_zone}` : ""}
                  {r.time_limit_minutes ? ` · ${r.time_limit_minutes} min limit` : ""}
                </div>
                {r.notes && <div className="mt-0.5 text-[11px] opacity-80">{r.notes}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {result.validations.length > 0 && (
        <details className="rounded-3xl border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-bold">Sign vs data validation</summary>
          <ul className="mt-2 space-y-1.5">
            {result.validations.map((v, i) => (
              <li key={i} className="flex items-start gap-2 rounded-2xl bg-background px-3 py-2 text-[11px]">
                <ValidationIcon outcome={v.outcome} />
                <span className="flex-1">{v.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {result.raw_text && (
        <details className="rounded-3xl border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-bold">Raw OCR transcript</summary>
          <pre className="mt-2 whitespace-pre-wrap text-[11px] text-muted-foreground">{result.raw_text}</pre>
        </details>
      )}

      {previewUrl && (
        <img src={previewUrl} alt="Captured sign" className="w-full rounded-3xl border border-border" />
      )}

      <button
        onClick={onReset}
        className="w-full rounded-full bg-primary py-3 text-sm font-bold text-primary-foreground"
      >
        Scan another sign
      </button>
      <p className="text-center text-[10px] text-muted-foreground">
        Summary generated from the ParkClear rules engine — the same evaluator used by
        Forecast, Can I Park Here, Sessions, and Alerts.
      </p>
    </div>
  );
}

function TimelineDot({ icon }: { icon: "allowed" | "restricted" | "limited" | "unknown" }) {
  if (icon === "allowed")
    return <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-park-green-soft text-park-green">✓</span>;
  if (icon === "restricted")
    return <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-park-red-soft text-park-red">⛔</span>;
  if (icon === "limited")
    return <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-park-yellow-soft text-park-yellow">⚠</span>;
  return <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface text-muted-foreground">?</span>;
}

function ValidationIcon({ outcome }: { outcome: SignScanResponse["validations"][number]["outcome"] }) {
  if (outcome === "match") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-park-green" />;
  if (outcome === "conflict") return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-park-yellow" />;
  if (outcome === "unmatched") return <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-primary" />;
  return <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function Row({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <span className="text-sm font-semibold text-right">{value}</span>
    </div>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function daysLabel(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return "Mon–Fri";
  if (days.length === 2 && days.includes(0) && days.includes(6)) return "Weekends";
  return [...days].sort().map((d) => DAY_LABELS[d]).join(", ");
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

async function getCurrentCoordsSafe(): Promise<{ lng: number; lat: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lng: pos.coords.longitude, lat: pos.coords.latitude }),
      () => resolve(null),
      { timeout: 4000, maximumAge: 60_000, enableHighAccuracy: false },
    );
  });
}
