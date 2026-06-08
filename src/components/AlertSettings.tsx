// Alert settings + notification history UI. Lives on /profile.
import { useState } from "react";
import { BellRing, BellOff, Trash2, Check, X } from "lucide-react";
import { useDeviceStore } from "@/stores/device-store";
import {
  alertTypeLabel,
  type AlertSettings,
} from "@/lib/parking/alerts";
import {
  requestNotificationPermission,
  useNotificationPermission,
} from "@/lib/parking/notifications";
import { cn } from "@/lib/utils";

const THRESHOLD_TOGGLES: Array<{ key: keyof AlertSettings; label: string }> = [
  { key: "warn60", label: "60 minute warning" },
  { key: "warn30", label: "30 minute warning" },
  { key: "warn15", label: "15 minute warning" },
  { key: "warn5",  label: "5 minute warning" },
];

export function AlertSettingsCard() {
  const settings = useDeviceStore((s) => s.alertSettings);
  const setSetting = useDeviceStore((s) => s.setAlertSetting);
  const permission = useNotificationPermission();
  const [pending, setPending] = useState(false);

  const onEnableBrowser = async () => {
    setPending(true);
    try {
      await requestNotificationPermission();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-3xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {settings.enabled ? <BellRing className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
          <div className="text-sm font-bold">Parking alerts</div>
        </div>
        <Toggle on={settings.enabled} onChange={(v) => setSetting("enabled", v)} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Triggered from the parking rules engine using your session's allowed-until time.
      </p>

      <div className={cn("mt-3 space-y-1.5", !settings.enabled && "pointer-events-none opacity-50")}>
        {THRESHOLD_TOGGLES.map((t) => (
          <div key={t.key} className="flex items-center justify-between rounded-2xl bg-background px-3 py-2">
            <span className="text-xs font-semibold">{t.label}</span>
            <Toggle on={!!settings[t.key]} onChange={(v) => setSetting(t.key, v as never)} />
          </div>
        ))}
      </div>

      {permission === "unsupported" && (
        <div className="mt-3 rounded-2xl bg-background px-3 py-2 text-[11px] text-muted-foreground">
          This browser doesn't support notifications — alerts will still show in-app.
        </div>
      )}
      {permission === "default" && (
        <button
          onClick={onEnableBrowser}
          disabled={pending}
          className="mt-3 w-full rounded-2xl bg-primary py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Requesting…" : "Enable browser notifications"}
        </button>
      )}
      {permission === "denied" && (
        <div className="mt-3 rounded-2xl bg-park-red-soft px-3 py-2 text-[11px] text-park-red">
          Browser notifications are blocked. Alerts will still appear in-app.
        </div>
      )}
      {permission === "granted" && (
        <div className="mt-3 rounded-2xl bg-park-green-soft px-3 py-2 text-[11px] text-park-green">
          Browser notifications are enabled.
        </div>
      )}
    </div>
  );
}

export function NotificationHistoryCard() {
  const history = useDeviceStore((s) => s.notificationHistory);
  const clear = useDeviceStore((s) => s.clearNotificationHistory);

  if (history.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-surface/40 p-4 text-center">
        <div className="text-xs text-muted-foreground">No alerts delivered yet.</div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold">Notification history</div>
        <button onClick={clear} className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
          <Trash2 className="h-3 w-3" /> Clear
        </button>
      </div>
      <ul className="mt-3 space-y-1.5">
        {history.slice(0, 10).map((n) => (
          <li key={n.id} className="flex items-center justify-between gap-2 rounded-2xl bg-background px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold">{alertTypeLabel(n.type)}</div>
              <div className="truncate text-[10px] text-muted-foreground">{n.label}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {new Date(n.deliveredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
              {n.deliveryStatus === "delivered" ? (
                <Check className="h-3.5 w-3.5 text-park-green" />
              ) : n.deliveryStatus === "failed" ? (
                <X className="h-3.5 w-3.5 text-park-red" />
              ) : (
                <span className="text-[9px] font-bold uppercase text-muted-foreground">in-app</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-6 w-11 rounded-full transition",
        on ? "bg-primary" : "bg-border",
      )}
      aria-pressed={on}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition",
          on ? "left-[1.375rem]" : "left-0.5",
        )}
      />
    </button>
  );
}
