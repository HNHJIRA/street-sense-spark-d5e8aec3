// Tiny client-side analytics + reporting helper. Fires server fns
// asynchronously and never throws — analytics must never break the UI.
import { trackEvent, submitReport } from "@/lib/parking/beta.functions";
import { getDeviceId } from "@/stores/device-store";

export type UsageEventName =
  | "park_here_used"
  | "forecast_opened"
  | "scan_started"
  | "scan_completed"
  | "session_started"
  | "session_ended"
  | "alert_delivered"
  | "saved_spot_added"
  | "favorite_added"
  | "search_performed"
  | "onboarding_completed"
  | "report_submitted";

export function track(name: UsageEventName, properties: Record<string, unknown> = {}, surface?: string): void {
  try {
    void trackEvent({
      data: {
        deviceId: getDeviceId(),
        eventName: name,
        surface: surface ?? null,
        properties,
      },
    }).catch(() => {});
  } catch {
    /* analytics never throws */
  }
}

export interface ReportInput {
  type: "incorrect_result" | "wrong_sign" | "wrong_street_data" | "other";
  surface: "park_here" | "forecast" | "session" | "street" | "scan" | "other";
  message: string;
  segmentId?: string | null;
  scanId?: string | null;
  context?: Record<string, unknown>;
}

export async function sendReport(input: ReportInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await submitReport({
      data: {
        deviceId: getDeviceId(),
        reportType: input.type,
        surface: input.surface,
        message: input.message,
        segmentId: input.segmentId ?? null,
        scanId: input.scanId ?? null,
        context: input.context ?? {},
      },
    });
    track("report_submitted", { type: input.type, surface: input.surface });
    return { ok: true, id: res.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
