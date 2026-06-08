// Anonymous device-local storage for user-facing Phase 2 features.
// Persists saved spots, favorites, search history, and the active parking
// session in browser localStorage. When real auth is added later, migrate
// these collections into per-user tables.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_ALERT_SETTINGS, type AlertSettings, type AlertType } from "@/lib/parking/alerts";

export interface SavedSpot {
  id: string;
  segmentId: string | null;
  name: string;
  nickname: string;
  notes: string;
  coordinates: [number, number] | null; // [lng, lat]
  createdAt: string; // ISO
}

export interface FavoritePlace {
  id: string;
  label: string;
  address: string | null;
  coordinates: [number, number]; // [lng, lat]
  segmentId?: string | null;
  createdAt: string;
}

export interface SearchHistoryItem {
  id: string;
  query: string;
  placeName: string;
  coordinates: [number, number]; // [lng, lat]
  searchedAt: string; // ISO
}

export interface ParkingSession {
  id: string;
  segmentId: string;
  segmentName: string;
  coordinates: [number, number] | null;
  cityId: string;
  cityTimezone: string;
  startedAt: string; // ISO
  // Snapshot from rules engine at the moment of parking — kept for history;
  // the live status screen recomputes via the engine each render.
  initialColor: "green" | "yellow" | "red";
  initialLabel: string;
  initialAllowedUntil: string | null;
  initialReason: string | null;
  sourceLabel: string | null;
}

interface DeviceState {
  savedSpots: SavedSpot[];
  favorites: FavoritePlace[];
  searchHistory: SearchHistoryItem[];
  activeSession: ParkingSession | null;

  addSavedSpot: (spot: Omit<SavedSpot, "id" | "createdAt">) => void;
  removeSavedSpot: (id: string) => void;
  updateSavedSpot: (id: string, patch: Partial<SavedSpot>) => void;

  addFavorite: (fav: Omit<FavoritePlace, "id" | "createdAt">) => void;
  removeFavorite: (id: string) => void;
  isFavoriteSegment: (segmentId: string | null | undefined) => boolean;

  pushSearch: (item: Omit<SearchHistoryItem, "id" | "searchedAt">) => void;
  removeSearch: (id: string) => void;
  clearSearchHistory: () => void;

  startSession: (s: Omit<ParkingSession, "id" | "startedAt">) => void;
  endSession: () => void;
}

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `id_${Math.random().toString(36).slice(2)}_${Date.now()}`);

export const useDeviceStore = create<DeviceState>()(
  persist(
    (set, get) => ({
      savedSpots: [],
      favorites: [],
      searchHistory: [],
      activeSession: null,

      addSavedSpot: (spot) =>
        set((s) => ({
          savedSpots: [{ ...spot, id: uid(), createdAt: new Date().toISOString() }, ...s.savedSpots],
        })),
      removeSavedSpot: (id) => set((s) => ({ savedSpots: s.savedSpots.filter((x) => x.id !== id) })),
      updateSavedSpot: (id, patch) =>
        set((s) => ({ savedSpots: s.savedSpots.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),

      addFavorite: (fav) =>
        set((s) => {
          if (fav.segmentId && s.favorites.some((f) => f.segmentId === fav.segmentId)) return s;
          return { favorites: [{ ...fav, id: uid(), createdAt: new Date().toISOString() }, ...s.favorites] };
        }),
      removeFavorite: (id) => set((s) => ({ favorites: s.favorites.filter((x) => x.id !== id) })),
      isFavoriteSegment: (segmentId) => {
        if (!segmentId) return false;
        return get().favorites.some((f) => f.segmentId === segmentId);
      },

      pushSearch: (item) =>
        set((s) => {
          const dedup = s.searchHistory.filter((h) => h.placeName !== item.placeName);
          return {
            searchHistory: [
              { ...item, id: uid(), searchedAt: new Date().toISOString() },
              ...dedup,
            ].slice(0, 20),
          };
        }),
      removeSearch: (id) => set((s) => ({ searchHistory: s.searchHistory.filter((x) => x.id !== id) })),
      clearSearchHistory: () => set({ searchHistory: [] }),

      startSession: (s) =>
        set({ activeSession: { ...s, id: uid(), startedAt: new Date().toISOString() } }),
      endSession: () => set({ activeSession: null }),
    }),
    {
      name: "parkclear-device-v1",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : undefined as any)),
      partialize: (s) => ({
        savedSpots: s.savedSpots,
        favorites: s.favorites,
        searchHistory: s.searchHistory,
        activeSession: s.activeSession,
      }),
    },
  ),
);
