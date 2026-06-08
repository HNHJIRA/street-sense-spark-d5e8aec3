import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { User, MapPin, ShieldCheck, Bookmark, Heart, Clock, Car, ChevronRight } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { AlertSettingsCard, NotificationHistoryCard } from "@/components/AlertSettings";
import { useDeviceStore } from "@/stores/device-store";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profile — ParkClear" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const savedCount = useDeviceStore((s) => s.savedSpots.length);
  const favCount = useDeviceStore((s) => s.favorites.length);
  const histCount = useDeviceStore((s) => s.searchHistory.length);
  const hasSession = useDeviceStore((s) => !!s.activeSession);
  const session = useDeviceStore((s) => s.activeSession);
  const clearHistory = useDeviceStore((s) => s.clearSearchHistory);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="relative min-h-screen bg-background pb-32">
      <div className="safe-top mx-auto max-w-md px-5 pt-6">
        <h1 className="font-display text-2xl font-bold">Profile</h1>

        <div className="mt-6 flex items-center gap-4 rounded-3xl bg-surface p-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <User className="h-7 w-7" />
          </div>
          <div>
            <div className="text-sm font-semibold">This device</div>
            <div className="text-xs text-muted-foreground">Sign-in coming soon · data stored locally</div>
          </div>
        </div>

        {hasSession && session && mounted && (
          <Link to="/session" className="mt-4 flex items-center justify-between rounded-3xl border border-park-green/40 bg-park-green-soft p-4 text-park-green">
            <div className="flex items-center gap-3">
              <Car className="h-5 w-5" />
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">Active session</div>
                <div className="text-sm font-bold leading-tight">{session.segmentName}</div>
              </div>
            </div>
            <ChevronRight className="h-5 w-5" />
          </Link>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <StatCard to="/saved" icon={Bookmark} label="Saved spots" value={mounted ? savedCount : 0} />
          <StatCard to="/saved" icon={Heart} label="Favorites" value={mounted ? favCount : 0} />
        </div>

        <div className="mt-6 space-y-2">
          <Row icon={MapPin} label="Current city" value="Seattle, WA" />
          <Row icon={ShieldCheck} label="Data source" value="Seattle SDOT Blockface" />
          <Row icon={Clock} label="Recent searches" value={mounted ? `${histCount}` : "0"} />
        </div>

        {mounted && histCount > 0 && (
          <button
            onClick={clearHistory}
            className="mt-3 w-full rounded-2xl bg-surface py-3 text-xs font-semibold text-muted-foreground"
          >
            Clear search history
          </button>
        )}

        <p className="mt-8 px-1 text-[11px] text-muted-foreground">
          Saved spots, favorites, and parking sessions are stored on this device. When account sign-in is added, your data can sync across devices.
        </p>
      </div>
      <BottomNav />
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

function StatCard({ to, icon: Icon, label, value }: { to: string; icon: typeof MapPin; label: string; value: number }) {
  return (
    <Link to={to} className="rounded-2xl bg-surface p-4">
      <Icon className="h-5 w-5 text-primary" />
      <div className="mt-2 text-2xl font-extrabold tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </Link>
  );
}
