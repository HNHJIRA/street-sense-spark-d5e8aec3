import { Search, MapPin } from "lucide-react";
import { useAppStore } from "@/stores/app-store";

interface TopBarProps {
  cityName: string;
  now: Date;
  timezone: string;
  isForecast: boolean;
}

function formatTime(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

function formatDay(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function TopBar({ cityName, now, timezone, isForecast }: TopBarProps) {
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const clearForecast = useAppStore((s) => s.setForecastAt);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-20 safe-top">
      <div className="mx-auto max-w-md px-3">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="pointer-events-auto flex w-full items-center gap-3 rounded-full border border-border bg-surface/90 px-4 py-3 text-left shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur-xl"
        >
          <Search className="h-5 w-5 text-muted-foreground" strokeWidth={2.2} />
          <span className="flex-1 text-sm text-muted-foreground">Search address, landmark, neighborhood…</span>
        </button>

        <div className="pointer-events-auto mt-2 flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface/80 px-3 py-1.5 backdrop-blur-xl">
            <MapPin className="h-3.5 w-3.5 text-primary" strokeWidth={2.4} />
            <span className="text-xs font-semibold tracking-wide">{cityName}</span>
          </div>
          <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 backdrop-blur-xl ${isForecast ? "border-park-yellow/40 bg-park-yellow-soft text-park-yellow" : "border-border bg-surface/80 text-foreground"}`}>
            <span className="text-xs font-semibold">
              {isForecast ? "Forecast • " : "Live • "}
              {formatDay(now, timezone)} · {formatTime(now, timezone)}
            </span>
            {isForecast && (
              <button
                type="button"
                onClick={() => clearForecast(null)}
                className="ml-1 rounded-full bg-park-yellow/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-park-yellow"
              >
                Live
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
