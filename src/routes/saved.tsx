import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bookmark, Heart, Trash2, MapPin } from "lucide-react";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { BottomNav } from "@/components/BottomNav";
import { useDeviceStore } from "@/stores/device-store";
import { useAppStore } from "@/stores/app-store";
import { getCityInfo } from "@/lib/parking/parking.functions";
import { cn } from "@/lib/utils";

const cityOpts = queryOptions({
  queryKey: ["parking", "city", "seattle"],
  queryFn: () => getCityInfo({ data: { citySlug: "seattle" } }),
  staleTime: 5 * 60 * 1000,
});

export const Route = createFileRoute("/saved")({
  head: () => ({ meta: [{ title: "Saved spots — ParkClear" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(cityOpts),
  component: SavedPage,
});

type Tab = "spots" | "favorites";

function SavedPage() {
  useSuspenseQuery(cityOpts); // ensure timezone available if needed later
  const [tab, setTab] = useState<Tab>("spots");
  const spots = useDeviceStore((s) => s.savedSpots);
  const favorites = useDeviceStore((s) => s.favorites);
  const removeSpot = useDeviceStore((s) => s.removeSavedSpot);
  const removeFav = useDeviceStore((s) => s.removeFavorite);
  const setFlyTo = useAppStore((s) => s.setFlyTo);
  const selectSegment = useAppStore((s) => s.selectSegment);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="relative min-h-screen bg-background pb-32">
      <div className="safe-top mx-auto max-w-md px-5 pt-6">
        <h1 className="font-display text-2xl font-bold">Saved</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your bookmarked blocks and favorite places. Stored on this device.
        </p>

        <div className="mt-5 grid grid-cols-2 rounded-full bg-surface p-1 text-sm font-semibold">
          <TabBtn active={tab === "spots"} onClick={() => setTab("spots")} icon={Bookmark} label={`Spots${mounted ? ` · ${spots.length}` : ""}`} />
          <TabBtn active={tab === "favorites"} onClick={() => setTab("favorites")} icon={Heart} label={`Favorites${mounted ? ` · ${favorites.length}` : ""}`} />
        </div>

        {!mounted ? (
          <Empty icon={Bookmark} text="Loading…" />
        ) : tab === "spots" ? (
          spots.length === 0 ? (
            <Empty icon={Bookmark} text="No saved spots yet. Tap a street on the map and choose Save." />
          ) : (
            <ul className="mt-5 space-y-2">
              {spots.map((s) => (
                <li key={s.id} className="rounded-2xl border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-bold">{s.nickname}</div>
                      <div className="truncate text-xs text-muted-foreground">{s.name}</div>
                      {s.notes && <div className="mt-2 text-xs text-foreground/80">{s.notes}</div>}
                      <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                        Saved {new Date(s.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      {s.coordinates && (
                        <Link to="/"
                          onClick={() => {
                            setFlyTo({ lng: s.coordinates![0], lat: s.coordinates![1], zoom: 18 });
                            if (s.segmentId) selectSegment(s.segmentId);
                          }}
                          className="rounded-full bg-primary/15 p-2 text-primary"
                        >
                          <MapPin className="h-4 w-4" />
                        </Link>
                      )}
                      <button onClick={() => removeSpot(s.id)} className="rounded-full bg-muted p-2 text-muted-foreground">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : favorites.length === 0 ? (
          <Empty icon={Heart} text="No favorites yet. Tap a street and choose Favorite." />
        ) : (
          <ul className="mt-5 space-y-2">
            {favorites.map((f) => (
              <li key={f.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-bold">{f.label}</div>
                    {f.address && <div className="truncate text-xs text-muted-foreground">{f.address}</div>}
                    <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Added {new Date(f.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Link to="/"
                      onClick={() => {
                        setFlyTo({ lng: f.coordinates[0], lat: f.coordinates[1], zoom: 18 });
                        if (f.segmentId) selectSegment(f.segmentId);
                      }}
                      className="rounded-full bg-primary/15 p-2 text-primary"
                    >
                      <MapPin className="h-4 w-4" />
                    </Link>
                    <button onClick={() => removeFav(f.id)} className="rounded-full bg-muted p-2 text-muted-foreground">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <BottomNav />
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Bookmark; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn("flex items-center justify-center gap-2 rounded-full px-3 py-2 transition", active ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground")}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof Bookmark; text: string }) {
  return (
    <div className="mt-8 rounded-3xl border border-dashed border-border bg-surface/50 p-8 text-center">
      <Icon className="mx-auto h-8 w-8 text-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
