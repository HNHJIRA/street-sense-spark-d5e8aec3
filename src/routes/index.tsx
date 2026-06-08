import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getCityInfo, getMapboxToken } from "@/lib/parking/parking.functions";
import { MapView } from "@/components/MapView";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { StreetSheet } from "@/components/StreetSheet";
import { ForecastSheet } from "@/components/ForecastSheet";
import { SearchSheet } from "@/components/SearchSheet";
import { ParkHereButton } from "@/components/ParkHereButton";
import { useAppStore } from "@/stores/app-store";

const cityOpts = queryOptions({
  queryKey: ["parking", "city", "seattle"],
  queryFn: () => getCityInfo({ data: { citySlug: "seattle" } }),
  staleTime: 5 * 60 * 1000,
});
const tokenOpts = queryOptions({
  queryKey: ["mapbox", "token"],
  queryFn: () => getMapboxToken(),
  staleTime: Infinity,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ParkClear — Seattle parking map" },
      { name: "description", content: "Real-time, color-coded street parking map for Seattle. See where you can park right now, or forecast a future time." },
      { property: "og:title", content: "ParkClear — Seattle parking map" },
      { property: "og:description", content: "See parking legality on every street in Seattle, at a glance." },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(cityOpts),
      context.queryClient.ensureQueryData(tokenOpts),
    ]);
  },
  component: HomePage,
  pendingComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">Loading parking data…</div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
      <div>
        <h1 className="text-lg font-bold">Couldn't load the parking map</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    </div>
  ),
  notFoundComponent: () => null,
});

function HomePage() {
  const cityQuery = useSuspenseQuery(cityOpts);
  const tokenQuery = useSuspenseQuery(tokenOpts);
  const [now, setNow] = useState<Date | null>(null);

  const forecastAt = useAppStore((s) => s.forecastAt);
  const tick = useAppStore((s) => s.tick);
  const bumpTick = useAppStore((s) => s.bumpTick);

  useEffect(() => {
    setNow(new Date());
    if (forecastAt) return;
    const id = window.setInterval(bumpTick, 60_000);
    return () => window.clearInterval(id);
  }, [forecastAt, bumpTick]);

  const displayTime = forecastAt ?? now;
  void tick;
  const city = cityQuery.data;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Mobile phone frame — constrains the map and all overlays to a phone-width column on larger screens. */}
      <div className="relative mx-auto h-full w-full max-w-md overflow-hidden bg-background shadow-2xl">
        <MapView token={tokenQuery.data.token} city={city} />
        <TopBar
          cityName={city.name}
          now={displayTime}
          timezone={city.timezone}
          isForecast={!!forecastAt}
        />
        <Legend />
        <ParkHereButton cityId={city.id} />
        <BottomNav />
        <SearchSheet token={tokenQuery.data.token} />
        <ForecastSheet />
        <StreetSheet timezone={city.timezone} restrictionTypes={city.restrictionTypes} />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div
      className="pointer-events-none fixed left-1/2 z-10 -translate-x-1/2"
      style={{ bottom: "calc(var(--safe-bottom) + 11rem)" }}
    >
      <div className="flex items-center gap-3 rounded-full border border-border bg-surface/85 px-4 py-2 backdrop-blur-xl">
        <LegendDot color="bg-park-green" label="Allowed" />
        <LegendDot color="bg-park-yellow" label="Restricted" />
        <LegendDot color="bg-park-red" label="No parking" />
      </div>
    </div>
  );
}
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}
