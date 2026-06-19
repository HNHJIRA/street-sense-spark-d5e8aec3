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

  const pillBase =
    "pointer-events-auto flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 pc-shadow-card";
  const brandColor = "var(--pc-brand-end)";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 safe-top safe-x">
      <div className="mx-auto flex max-w-md items-center gap-2 px-3 pt-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white pc-shadow-card"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.4} style={{ color: brandColor }} />
          </button>
        )}
        <div ref={wrapRef} className="pointer-events-auto relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={pillBase}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <MapPin className="h-3.5 w-3.5" strokeWidth={2.4} style={{ color: brandColor }} />
            <span className="text-xs font-semibold text-slate-900">{cityName}</span>
            <ChevronDown className="h-3 w-3 text-slate-500" strokeWidth={2.4} />
          </button>
          {open && (
            <div
              role="listbox"
              className="absolute left-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-2xl bg-white pc-shadow-card"
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
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold transition hover:bg-slate-50"
                    style={{ color: active ? brandColor : "#0f172a" }}
                  >
                    <span>{c.name}</span>
                    {active && <Check className="h-3.5 w-3.5" strokeWidth={2.4} style={{ color: brandColor }} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div
          className={
            isForecast
              ? "pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 pc-shadow-brand pc-bg-gradient-brand text-white"
              : pillBase + " text-slate-900"
          }
        >
          <span className="text-xs font-semibold">
            {isForecast ? "Forecast" : "Live"}
            {now ? ` · ${formatTime(now, timezone)}` : ""}
          </span>
          {isForecast && (
            <button
              type="button"
              onClick={() => clearForecast(null)}
              className="ml-1 rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
            >
              Live
            </button>
          )}
        </div>
        {citySlug === "los-angeles" && (
          <div className="pointer-events-auto flex rounded-full bg-white p-0.5 pc-shadow-card">
            <button
              type="button"
              onClick={() => setMapMode("legal")}
              className="rounded-full px-2.5 py-1 text-[11px] font-bold transition"
              style={
                mapMode === "legal"
                  ? { background: "var(--pc-gradient-brand)", color: "#fff" }
                  : { color: "#6B7280" }
              }
            >
              Legal
            </button>
            <button
              type="button"
              onClick={() => setMapMode("available")}
              className="rounded-full px-2.5 py-1 text-[11px] font-bold transition"
              style={
                mapMode === "available"
                  ? { background: "var(--pc-gradient-brand)", color: "#fff" }
                  : { color: "#6B7280" }
              }
            >
              Open
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          className="pointer-events-auto ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-white pc-shadow-card"
        >
          <Search className="h-4 w-4" strokeWidth={2.4} style={{ color: brandColor }} />
        </button>
      </div>
    </div>
  );
}
