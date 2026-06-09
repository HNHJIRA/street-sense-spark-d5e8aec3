// AI Sign Scanner — capture/upload a parking-sign photo, send to the engine
// pipeline, render the engine's verdict.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import {
  Camera, Upload, Loader2, ArrowLeft, ScanLine,
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
      // Use the global GPS store — live fix, then last-known, then null.
      const fix = liveLocation ?? lastKnown;
      const res = await scan({
        data: {
          cityId: city.id, citySlug: city.slug, timezone: city.timezone,
          imageBase64: base64,
          mimeType: file.type || "image/jpeg",
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
  const s = result.summary;
  const tone =
    s.status === "YES" ? "text-park-green"
    : s.status === "NO" ? "text-park-red"
    : s.status === "LIMITED" ? "text-park-yellow"
    : "text-foreground";

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-3xl border border-border bg-surface p-6">
        <div className="mb-3 flex items-center gap-2">
          <span className={cn("font-display text-2xl font-extrabold", tone)}>{s.status}</span>
          <span className="text-xs text-muted-foreground">— AI summary</span>
        </div>
        <p className="text-base font-semibold leading-relaxed text-foreground">
          {s.plain}
          {s.time_guidance ? ` ${s.time_guidance}` : ""}
        </p>
      </div>

      {previewUrl && (
        <img src={previewUrl} alt="Captured sign" className="w-full rounded-3xl border border-border opacity-80" />
      )}

      <button
        onClick={onReset}
        className="w-full rounded-full bg-primary py-3 text-sm font-bold text-primary-foreground"
      >
        Scan another sign
      </button>
      <p className="text-center text-[10px] text-muted-foreground">
        Summary generated by the ParkClear AI from the posted sign{result.segment ? ` near ${result.segment.name}` : ""}.
      </p>
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

