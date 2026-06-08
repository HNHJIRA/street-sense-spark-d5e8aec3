import { Link, useRouterState } from "@tanstack/react-router";
import { Bookmark, Clock, Map as MapIcon, Search, User, Car } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDeviceStore } from "@/stores/device-store";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  icon: typeof MapIcon;
  to?: string;
  onClick?: () => void;
  active?: boolean;
  badge?: boolean;
}

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const setForecastOpen = useAppStore((s) => s.setForecastOpen);
  const searchOpen = useAppStore((s) => s.searchOpen);
  const forecastOpen = useAppStore((s) => s.forecastOpen);
  const forecastAt = useAppStore((s) => s.forecastAt);
  const hasSession = useDeviceStore((s) => !!s.activeSession);

  const tabs: Tab[] = [
    { id: "home", label: "Map", icon: MapIcon, to: "/", active: pathname === "/" && !searchOpen && !forecastOpen },
    { id: "search", label: "Search", icon: Search, onClick: () => { setSearchOpen(true); setForecastOpen(false); }, active: searchOpen },
    { id: "session", label: hasSession ? "Parked" : "Forecast", icon: hasSession ? Car : Clock,
      to: hasSession ? "/session" : undefined,
      onClick: hasSession ? undefined : () => { setForecastOpen(true); setSearchOpen(false); },
      active: hasSession ? pathname.startsWith("/session") : (forecastOpen || !!forecastAt),
      badge: hasSession },
    { id: "saved", label: "Saved", icon: Bookmark, to: "/saved", active: pathname.startsWith("/saved") },
    { id: "profile", label: "Profile", icon: User, to: "/profile", active: pathname.startsWith("/profile") },
  ];

  return (
    <nav className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 safe-bottom safe-x">
      <div className="mx-auto max-w-md px-3">
        <div className="flex items-center justify-between rounded-3xl border border-border bg-surface/85 px-2 py-2 backdrop-blur-xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]">
          {tabs.map((t) => {
            const Icon = t.icon;
            const inner = (
              <button
                type="button"
                onClick={t.onClick}
                className={cn(
                  "relative flex flex-1 flex-col items-center gap-0.5 rounded-2xl px-2 py-2 text-[11px] font-medium transition",
                  t.active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={2.2} />
                <span>{t.label}</span>
                {t.badge && <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-park-green ring-2 ring-surface" />}
              </button>
            );
            return t.to ? (
              <Link key={t.id} to={t.to} className="flex-1">
                {inner}
              </Link>
            ) : (
              <div key={t.id} className="flex-1">{inner}</div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
