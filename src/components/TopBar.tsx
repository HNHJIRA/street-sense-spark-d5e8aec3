import { useEffect, useRef, useState } from "react";
import { Search, MapPin, Check, ChevronDown, ChevronLeft } from "lucide-react";
import { useAppStore } from "@/stores/app-store";

interface CityOption { slug: string; name: string }

interface TopBarProps {
  cityName: string;
  citySlug: string;
  cities: CityOption[];
  onCityChange: (slug: string) => void;
  now: Date | null;
  timezone: string;
  isForecast: boolean;
  onBack?: () => void;
}

function formatTime(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}

export function TopBar({ cityName, citySlug, cities, onCityChange, now, timezone, isForecast, onBack }: TopBarProps) {
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const clearForecast = useAppStore((s) => s.setForecastAt);
  const mapMode = useAppStore((s) => s.mapMode);
  const setMapMode = useAppStore((s) => s.setMapMode);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 safe-top safe-x">
      <div className="mx-auto flex max-w-md items-center gap-2 px-3 pt-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.15)]"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.4} style={{ color: "var(--pc-brand-end)" }} />
          </button>
        )}
        <div ref={wrapRef} className="pointer-events-auto relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface/90 px-3 py-1.5 backdrop-blur-xl shadow-lg"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <MapPin className="h-3.5 w-3.5 text-primary" strokeWidth={2.4} />
            <span className="text-xs font-semibold">{cityName}</span>
            <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={2.4} />
          </button>
          {open && (
            <div
              role="listbox"
              className="absolute left-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-2xl border border-border bg-surface/95 shadow-xl backdrop-blur-xl"
            >
              {cities.map((c) => {
                const active = c.slug === citySlug;
                return (
                  <button
                    key={c.slug}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => { onCityChange(c.slug); setOpen(false); }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold transition hover:bg-muted/60 ${
                      active ? "text-primary" : "text-foreground"
                    }`}
                  >
                    <span>{c.name}</span>
                    {active && <Check className="h-3.5 w-3.5" strokeWidth={2.4} />}
                  </button>
                );
              })}
            </div>
          )}
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
        {citySlug === "los-angeles" && (
          <div className="pointer-events-auto flex rounded-full border border-border bg-surface/90 p-0.5 shadow-lg backdrop-blur-xl">
            <button
              type="button"
              onClick={() => setMapMode("legal")}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${mapMode === "legal" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              Legal
            </button>
            <button
              type="button"
              onClick={() => setMapMode("available")}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${mapMode === "available" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              Open
            </button>
          </div>
        )}
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
