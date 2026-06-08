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
  /** Tick value to force a re-render every minute in live mode. */
  tick: number;
  bumpTick: () => void;
  flyTo: { lng: number; lat: number; zoom?: number } | null;
  setFlyTo: (v: { lng: number; lat: number; zoom?: number } | null) => void;
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
}));
