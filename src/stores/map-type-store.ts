// Shared map-type preference. Persisted to localStorage so the user's choice
// of base map (standard / satellite / hybrid) survives reloads and is shared
// across every Mapbox surface in the app.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type MapType = "standard" | "basic" | "satellite" | "hybrid";

export const MAPBOX_STYLE_FOR_TYPE: Record<MapType, string> = {
  standard: "mapbox://styles/mapbox/streets-v12",
  basic: "mapbox://styles/mapbox/light-v11",
  satellite: "mapbox://styles/mapbox/satellite-v9",
  hybrid: "mapbox://styles/mapbox/satellite-streets-v12",
};

interface MapTypeState {
  mapType: MapType;
  setMapType: (t: MapType) => void;
}

export const useMapTypeStore = create<MapTypeState>()(
  persist(
    (set) => ({
      mapType: "standard",
      setMapType: (mapType) => set({ mapType }),
    }),
    {
      name: "parkclear:map-type",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : (undefined as never),
      ),
      // Only persist the chosen type.
      partialize: (s) => ({ mapType: s.mapType }),
    },
  ),
);
