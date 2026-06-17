// Browser notification scheduler for active parking sessions.
//
// On each tick (1s) we recompute planned alerts from the rules-engine output
// and fire any whose `triggerAt` has passed and that haven't already been
// delivered. Delivery is recorded in the device store (persisted) so the same
// alert never fires twice across remounts or tab focus changes.
import { useEffect } from "react";
import { useDeviceStore } from "@/stores/device-store";
import { computeAlertWindows, alertTypeLabel, type PlannedAlert } from "@/lib/parking/alerts";

export function useNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  return Notification.requestPermission();
}

interface UseSessionAlertSchedulerArgs {
  allowedUntil: string | null;
  color: "green" | "yellow" | "red" | "gray";
  reason: string | null;
  nowMs: number;
}

/**
 * Fire any planned alerts that are due as of `nowMs`. Caller is expected to
 * advance `nowMs` on a ~1s interval (the /session page already does this).
 * No-ops when there is no active session.
 */
export function useSessionAlertScheduler({ allowedUntil, color, reason, nowMs }: UseSessionAlertSchedulerArgs) {
  const session = useDeviceStore((s) => s.activeSession);
  const settings = useDeviceStore((s) => s.alertSettings);
  const hasDelivered = useDeviceStore((s) => s.hasDeliveredAlert);
  const record = useDeviceStore((s) => s.recordNotification);

  useEffect(() => {
    if (!session || !settings.enabled) return;
    const planned = computeAlertWindows(allowedUntil, color, reason, settings, nowMs - 1500);
    // Anything whose trigger is in the past relative to nowMs and not yet delivered.
    for (const alert of planned) {
      const triggerMs = new Date(alert.triggerAt).getTime();
      if (triggerMs > nowMs) break; // list is sorted
      if (hasDelivered(alert.id)) continue;
      const status = fireBrowserNotification(alert, session.segmentName);
      record({
        alertId: alert.id,
        sessionId: session.id,
        type: alert.type,
        label: alert.label,
        minutesBefore: alert.minutesBefore,
        triggerAt: alert.triggerAt,
        deliveryStatus: status,
        reason: alert.reason,
      });
    }
  }, [session, allowedUntil, color, reason, settings, nowMs, hasDelivered, record]);
}

function fireBrowserNotification(alert: PlannedAlert, segmentName: string): "delivered" | "in_app_only" | "failed" {
  if (typeof window === "undefined" || !("Notification" in window)) return "in_app_only";
  if (Notification.permission !== "granted") return "in_app_only";
  try {
    new Notification(`ParkClear — ${alertTypeLabel(alert.type)}`, {
      body: `${alert.label} on ${segmentName}`,
      tag: alert.id,
      icon: "/favicon.ico",
    });
    return "delivered";
  } catch {
    return "failed";
  }
}
