import { Search, MapPin } from "lucide-react";
import { useAppStore } from "@/stores/app-store";

interface TopBarProps {
  cityName: string;
  now: Date | null;
  timezone: string;
  isForecast: boolean;
}

function formatTime(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}

export function TopBar({ cityName, now, timezone, isForecast }: TopBarProps) {
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const clearForecast = useAppStore((s) => s.setForecastAt);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 safe-top safe-x">
      <div className="mx-auto flex max-w-md items-center gap-2 px-3 pt-2">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-surface/90 px-3 py-1.5 backdrop-blur-xl shadow-lg">
          <MapPin className="h-3.5 w-3.5 text-primary" strokeWidth={2.4} />
          <span className="text-xs font-semibold">{cityName}</span>
        </div>
        <div
          className={`pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 backdrop-blur-xl shadow-lg ${
            isForecast
              ? "border-park-yellow/40 bg-park-yellow-soft text-park-yellow"
              : "border-border bg-surface/90 text-foreground"
          }`}
        >
          <span className="text-xs font-semibold">
            {isForecast ? "Forecast" : "Live"}
            {now ? ` · ${formatTime(now, timezone)}` : ""}
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
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          className="pointer-events-auto ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface/90 backdrop-blur-xl shadow-lg"
        >
          <Search className="h-4 w-4" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
