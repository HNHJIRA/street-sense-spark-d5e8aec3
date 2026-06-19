import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getCityInfo, getMapboxToken } from "@/lib/parking/parking.functions";
import { MapView } from "@/components/MapView";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { StreetSheet } from "@/components/StreetSheet";
import { ForecastSheet } from "@/components/ForecastSheet";
import { SearchSheet } from "@/components/SearchSheet";
import { DestinationParkingSheet } from "@/components/DestinationParkingSheet";
import { ParkHereButton } from "@/components/ParkHereButton";
import { ActiveSessionWidget } from "@/components/ActiveSessionWidget";
import { Onboarding } from "@/components/Onboarding";
import { useAppStore } from "@/stores/app-store";

export const AVAILABLE_CITIES: { slug: string; name: string }[] = [
  { slug: "los-angeles", name: "Los Angeles" },
  { slug: "santa-monica", name: "Santa Monica" },
  { slug: "west-hollywood", name: "West Hollywood" },
  { slug: "pasadena", name: "Pasadena" },
  { slug: "arlington", name: "Arlington, VA" },
  { slug: "bellevue", name: "Bellevue, WA" },
  { slug: "seattle", name: "Seattle" },
];

const DEFAULT_CITY = "los-angeles";

function cityOptsFor(slug: string) {
  return queryOptions({
    queryKey: ["parking", "city", slug],
    queryFn: () => getCityInfo({ data: { citySlug: slug } }),
    staleTime: 5 * 60 * 1000,
  });
}
const tokenOpts = queryOptions({
  queryKey: ["mapbox", "token"],
  queryFn: () => getMapboxToken(),
  staleTime: Infinity,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ParkClear — Street parking map" },
      { name: "description", content: "Real-time, color-coded street parking map. See where you can park right now, or forecast a future time." },
      { property: "og:title", content: "ParkClear — Street parking map" },
      { property: "og:description", content: "See parking legality on every street, at a glance." },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(cityOptsFor(DEFAULT_CITY)),
      context.queryClient.ensureQueryData(tokenOpts),
    ]);
  },
  component: HomePage,
  pendingComponent: () => (
    <div className="flex min-h-full items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">Loading parking data…</div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="flex min-h-full items-center justify-center bg-background p-6 text-center">
      <div>
        <h1 className="text-lg font-bold">Couldn't load the parking map</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    </div>
  ),
  notFoundComponent: () => null,
});

const CITY_STORAGE_KEY = "parkclear:selected-city";

function HomePage() {
  const [citySlug, setCitySlug] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_CITY;
    const stored = window.localStorage.getItem(CITY_STORAGE_KEY);
    if (stored && AVAILABLE_CITIES.some((c) => c.slug === stored)) return stored;
    return DEFAULT_CITY;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CITY_STORAGE_KEY, citySlug);
    }
  }, [citySlug]);

  const cityQuery = useSuspenseQuery(cityOptsFor(citySlug));
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
  const router = useRouter();
  const canGoBack = typeof window !== "undefined" && window.history.length > 1;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#e8eef5]">
      <MapView token={tokenQuery.data.token} city={city} />
      <TopBar
        cityName={city.name}
        citySlug={city.slug}
        cities={AVAILABLE_CITIES}
        onCityChange={setCitySlug}
        now={displayTime}
        timezone={city.timezone}
        isForecast={!!forecastAt}
        onBack={canGoBack ? () => router.history.back() : undefined}
      />
      <Legend />
      <ActiveSessionWidget restrictionTypes={city.restrictionTypes} />
      <ParkHereButton cityId={city.id} timezone={city.timezone} />
      {/* <BottomNav /> */}
      <SearchSheet token={tokenQuery.data.token} />
      <ForecastSheet />
      <StreetSheet timezone={city.timezone} restrictionTypes={city.restrictionTypes} cityId={city.id} citySlug={city.slug} />
      <DestinationParkingSheet cityId={city.id} timezone={city.timezone} />
      <Onboarding />
    </div>
  );
}

function Legend() {
  const mapMode = useAppStore((s) => s.mapMode);
  const labels = mapMode === "available"
    ? ["Likely open", "Tight", "Full"]
    : ["Allowed", "Restricted", "No parking"];
  return (
    <div
      className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2"
      style={{ bottom: "calc(var(--safe-bottom) + 11rem)" }}
    >
      <div className="flex items-center gap-3 rounded-full bg-white px-4 py-2 pc-shadow-card">
        <LegendDot color="bg-park-green" label={labels[0]} />
        <LegendDot color="bg-park-yellow" label={labels[1]} />
        <LegendDot color="bg-park-red" label={labels[2]} />
      </div>
    </div>
  );
}
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}
