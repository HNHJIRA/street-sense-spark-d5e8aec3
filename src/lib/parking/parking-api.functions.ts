// Server functions wrapping the external ParkClear parking-sign analysis API.
// The backend is the SINGLE SOURCE OF TRUTH for sign interpretation — these
// functions only handle: presigned URL → S3 upload → analysis call.
//
// All auth/config flows through getParkingApiConfig() so swapping bearer-token
// auth for service-account login + refresh later is a one-file change.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getParkingApiConfig, authHeader } from "./parking-api.config";

export type ParkingApiJson =
  | string | number | boolean | null
  | { [k: string]: ParkingApiJson }
  | ParkingApiJson[];

export interface ParkingSignAnalysisResult {
  /** HTTP status of the analysis call (echoed for debugging). */
  status: number;
  /** Raw JSON body returned by the backend, unmodified. */
  raw: ParkingApiJson;
  /** The public/object URL that was sent to the analysis endpoint. */
  fileUrl: string | null;
  /** Time the analysis call took, in ms (server-side). */
  durationMs: number;
}

interface PresignedUrlResponse {
  // The backend may return any of these shapes — we normalize below.
  url?: string;
  upload_url?: string;
  uploadUrl?: string;
  presigned_url?: string;
  presignedUrl?: string;
  file_url?: string;
  fileUrl?: string;
  public_url?: string;
  publicUrl?: string;
  key?: string;
  fields?: Record<string, string>;
  [k: string]: unknown;
}

function pickUploadUrl(r: PresignedUrlResponse): string | null {
  return (
    r.upload_url ??
    r.uploadUrl ??
    r.presigned_url ??
    r.presignedUrl ??
    r.url ??
    null
  );
}

function pickPublicUrl(r: PresignedUrlResponse, uploadUrl: string | null): string | null {
  const direct =
    r.file_url ??
    r.fileUrl ??
    r.public_url ??
    r.publicUrl ??
    null;
  if (direct) return direct;
  // S3 presigned PUT URLs include the object URL minus the query string.
  if (uploadUrl) {
    try {
      const u = new URL(uploadUrl);
      return `${u.origin}${u.pathname}`;
    } catch {
      return uploadUrl;
    }
  }
  return null;
}

export const analyzeParkingSign = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      imageBase64: z.string().min(100).max(12_000_000),
      mimeType: z.string().regex(/^image\/(jpeg|jpg|png|webp|heic|heif)$/i),
      fileName: z.string().min(1).max(128).optional(),
      timezone: z.string().min(1).max(64).optional(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<ParkingSignAnalysisResult> => {
    const cfg = getParkingApiConfig();
    const headers = authHeader(cfg);
    const bytes = Uint8Array.from(atob(data.imageBase64), (c) => c.charCodeAt(0));
    const ext = (data.mimeType.split("/")[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
    const fileName = data.fileName ?? `scan-${Date.now()}.${ext}`;
    let timezone = data.timezone;
    if (!timezone) {
      try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* noop */ }
    }
    if (!timezone) timezone = "UTC";


    let fileUrl: string | null = null;

    // === Step 1: presigned URL (GET) ===
    // Backend: GET /authentication/v1/user/generate_s3_presigned_url/?file_name=...&content_type=...
    // → { data: { presigned_put_url, file_url, object_key } }
    const presignQs = new URLSearchParams({
      file_name: fileName,
      content_type: data.mimeType,
    });
    const presignRes = await fetch(
      `${cfg.baseUrl}${cfg.endpoints.presignedUrl}?${presignQs.toString()}`,
      { method: "GET", headers },
    );
    const presignText = await presignRes.text();
    // eslint-disable-next-line no-console
    console.log("[parking-api] presign", presignRes.status, presignText.slice(0, 300));
    if (!presignRes.ok) {
      throw new Error(`Presigned URL request failed (${presignRes.status}): ${presignText.slice(0, 300)}`);
    }
    let presignJson: { data?: { presigned_put_url?: string; file_url?: string; object_key?: string } } = {};
    try { presignJson = JSON.parse(presignText); } catch { /* noop */ }
    const uploadUrl = presignJson.data?.presigned_put_url ?? null;
    fileUrl = presignJson.data?.file_url ?? null;
    if (!uploadUrl || !fileUrl) {
      throw new Error("Presigned URL response missing presigned_put_url / file_url");
    }

    // Upload bytes directly to S3 with PUT. Content-Type must match what was
    // signed (the backend signs `content-type` into the request).
    // The backend signs presigned PUT URLs with a fixed Content-Type of
    // "image/jpg" regardless of the file extension or content_type param it
    // receives. Sending anything else (image/jpeg, image/png, etc.) yields
    // a SignatureDoesNotMatch 403 from S3. Do not "fix" this to data.mimeType.
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/jpg" },
      body: bytes,
    });

    // eslint-disable-next-line no-console
    console.log("[parking-api] s3 upload", putRes.status);
    if (!putRes.ok) {
      const t = await putRes.text();
      throw new Error(`S3 upload failed (${putRes.status}): ${t.slice(0, 300)}`);
    }

    // === Step 2: parking-sign-analysis ===
    const analysisUrl = `${cfg.baseUrl}${cfg.endpoints.parkingSignAnalysis}`;
    const started = Date.now();
    const res = await fetch(analysisUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ file: fileUrl, timezone, time_zone: timezone }),
    });


    const durationMs = Date.now() - started;
    const text = await res.text();
    let raw: ParkingApiJson = text;
    try { raw = JSON.parse(text) as ParkingApiJson; } catch { /* keep text */ }
    // eslint-disable-next-line no-console
    console.log("[parking-api] analysis", res.status, "in", durationMs, "ms");
    // eslint-disable-next-line no-console
    console.log("[parking-api] analysis body:", raw);

    if (!res.ok) {
      throw new Error(
        `Parking sign analysis failed (${res.status}): ${typeof raw === "string" ? raw.slice(0, 300) : JSON.stringify(raw).slice(0, 300)}`,
      );
    }

    return { status: res.status, raw, fileUrl, durationMs };
  });
