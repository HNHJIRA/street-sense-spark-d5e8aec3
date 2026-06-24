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
    }).parse(input),
  )
  .handler(async ({ data }): Promise<ParkingSignAnalysisResult> => {
    const cfg = getParkingApiConfig();
    const headers = authHeader(cfg);
    const bytes = Uint8Array.from(atob(data.imageBase64), (c) => c.charCodeAt(0));
    const ext = (data.mimeType.split("/")[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
    const fileName = data.fileName ?? `scan-${Date.now()}.${ext}`;

    let fileUrl: string | null = null;

    // === Step 1: presigned URL ===
    // We attempt the configured presign endpoint. If the backend rejects this
    // step we fall through to a multipart upload directly against the analysis
    // endpoint, so the analysis call always happens with the bearer token.
    try {
      const presignRes = await fetch(`${cfg.baseUrl}${cfg.endpoints.presignedUrl}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: fileName,
          fileName,
          content_type: data.mimeType,
          contentType: data.mimeType,
        }),
      });
      const presignText = await presignRes.text();
      // eslint-disable-next-line no-console
      console.log("[parking-api] presign", presignRes.status, presignText.slice(0, 500));
      if (presignRes.ok) {
        let parsed: PresignedUrlResponse = {};
        try { parsed = JSON.parse(presignText) as PresignedUrlResponse; } catch { /* non-JSON */ }
        const uploadUrl = pickUploadUrl(parsed);
        if (uploadUrl) {
          const putRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": data.mimeType },
            body: bytes,
          });
          // eslint-disable-next-line no-console
          console.log("[parking-api] s3 upload", putRes.status);
          if (putRes.ok) {
            fileUrl = pickPublicUrl(parsed, uploadUrl);
          }
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[parking-api] presign step failed:", (e as Error).message);
    }

    // === Step 2: parking-sign-analysis ===
    const analysisUrl = `${cfg.baseUrl}${cfg.endpoints.parkingSignAnalysis}`;
    const started = Date.now();
    let res: Response;
    if (fileUrl) {
      // Preferred path: backend gets a URL string per the Postman collection.
      res = await fetch(analysisUrl, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ file: fileUrl }),
      });
    } else {
      // Fallback: send the file directly as multipart so the user still gets a
      // backend-driven answer even when presign isn't wired yet.
      const fd = new FormData();
      const blob = new Blob([bytes], { type: data.mimeType });
      fd.append("file", blob, fileName);
      res = await fetch(analysisUrl, {
        method: "POST",
        headers, // no Content-Type — fetch sets the multipart boundary
        body: fd,
      });
    }
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
