import { create } from "zustand";

interface ClockState {
  /** null = live mode, otherwise the forecast Date. */
  forecastAt: Date | null;
  setForecastAt: (d: Date | null) => void;
  selectedSegmentId: string | null;
  selectSegment: (id: string | null) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  forecastOpen: boolean;
  setForecastOpen: (v: boolean) => void;
  tick: number;
  bumpTick: () => void;
  flyTo: { lng: number; lat: number; zoom?: number } | null;
  setFlyTo: (v: { lng: number; lat: number; zoom?: number } | null) => void;
  /** Current map center, kept in sync by MapView so the "Can I park here?" button can use it as a tap-to-query fallback when GPS is unavailable. */
  mapCenter: { lng: number; lat: number } | null;
  setMapCenter: (v: { lng: number; lat: number } | null) => void;
  /** "legal" = is parking allowed here? "available" = is there an open spot right now? */
  mapMode: "legal" | "available";
  setMapMode: (m: "legal" | "available") => void;
  /** Set by StreetSheet to ask ParkHereButton to evaluate a specific segment (Manual Test Mode). */
  pendingCheckSegmentId: string | null;
  requestCheckSegment: (id: string | null) => void;
  /** Recommended alternative parking — drawn as a highlight + connector line on the map. */
  recommendedHighlight: {
    from: { lng: number; lat: number };
    segmentId: string;
    coordinates: [number, number][];
  } | null;
  setRecommendedHighlight: (v: ClockState["recommendedHighlight"]) => void;
}

export const useAppStore = create<ClockState>((set) => ({
  forecastAt: null,
  setForecastAt: (d) => set({ forecastAt: d }),
  selectedSegmentId: null,
  selectSegment: (id) => set({ selectedSegmentId: id }),
  searchOpen: false,
  setSearchOpen: (v) => set({ searchOpen: v }),
  forecastOpen: false,
  setForecastOpen: (v) => set({ forecastOpen: v }),
  tick: 0,
  bumpTick: () => set((s) => ({ tick: s.tick + 1 })),
  flyTo: null,
  setFlyTo: (v) => set({ flyTo: v }),
  mapCenter: null,
  setMapCenter: (v) => set({ mapCenter: v }),
  mapMode: "legal",
  setMapMode: (m) => set({ mapMode: m }),
}));
