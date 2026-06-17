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
  initialColor: "green" | "yellow" | "red" | "gray";
  initialLabel: string;
  initialAllowedUntil: string | null;
  initialReason: string | null;
  sourceLabel: string | null;
}

export interface ParkingHistoryEntry extends ParkingSession {
  endedAt: string;       // ISO when session ended
  durationMinutes: number;
  outcome: "completed" | "expired"; // expired = ended after allowed_until
}


export interface NotificationLogItem {
  id: string;
  sessionId: string;
  type: AlertType;
  label: string;
  minutesBefore: number;
  triggerAt: string;        // ISO when the alert was scheduled to fire
  deliveredAt: string;      // ISO when it actually fired
  deliveryStatus: "delivered" | "in_app_only" | "failed";
  reason: string | null;
}

interface DeviceState {
  deviceId: string;
  onboardingCompletedAt: string | null;
  savedSpots: SavedSpot[];
  favorites: FavoritePlace[];
  searchHistory: SearchHistoryItem[];
  activeSession: ParkingSession | null;
  parkingHistory: ParkingHistoryEntry[];


  alertSettings: AlertSettings;
  notificationHistory: NotificationLogItem[];
  // Per-session set of already-fired alert ids — keeps the scheduler idempotent
  // across remounts and tab focuses.
  deliveredAlertIds: string[];

  completeOnboarding: () => void;
  resetOnboarding: () => void;

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
  clearParkingHistory: () => void;


  setAlertSetting: <K extends keyof AlertSettings>(key: K, value: AlertSettings[K]) => void;
  recordNotification: (n: Omit<NotificationLogItem, "id" | "deliveredAt"> & { alertId: string }) => void;
  clearNotificationHistory: () => void;
  hasDeliveredAlert: (alertId: string) => boolean;
}


const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `id_${Math.random().toString(36).slice(2)}_${Date.now()}`);

export const useDeviceStore = create<DeviceState>()(
  persist(
    (set, get) => ({
      deviceId: uid(),
      onboardingCompletedAt: null,
      savedSpots: [],
      favorites: [],
      searchHistory: [],
      activeSession: null,
      parkingHistory: [],


      alertSettings: DEFAULT_ALERT_SETTINGS,
      notificationHistory: [],
      deliveredAlertIds: [],

      completeOnboarding: () => set({ onboardingCompletedAt: new Date().toISOString() }),
      resetOnboarding: () => set({ onboardingCompletedAt: null }),

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
        set({
          activeSession: { ...s, id: uid(), startedAt: new Date().toISOString() },
          deliveredAlertIds: [],
        }),
      endSession: () =>
        set((s) => {
          const active = s.activeSession;
          if (!active) return { activeSession: null, deliveredAlertIds: [] };
          const endedAt = new Date().toISOString();
          const durationMinutes = Math.max(
            1,
            Math.round((Date.parse(endedAt) - Date.parse(active.startedAt)) / 60_000),
          );
          const outcome: ParkingHistoryEntry["outcome"] =
            active.initialAllowedUntil && Date.parse(endedAt) > Date.parse(active.initialAllowedUntil)
              ? "expired"
              : "completed";
          const entry: ParkingHistoryEntry = { ...active, endedAt, durationMinutes, outcome };
          return {
            activeSession: null,
            deliveredAlertIds: [],
            parkingHistory: [entry, ...s.parkingHistory].slice(0, 50),
          };
        }),
      clearParkingHistory: () => set({ parkingHistory: [] }),


      setAlertSetting: (key, value) =>
        set((s) => ({ alertSettings: { ...s.alertSettings, [key]: value } })),

      recordNotification: ({ alertId, ...n }) =>
        set((s) => {
          if (s.deliveredAlertIds.includes(alertId)) return s;
          const entry: NotificationLogItem = {
            ...n,
            id: uid(),
            deliveredAt: new Date().toISOString(),
          };
          return {
            notificationHistory: [entry, ...s.notificationHistory].slice(0, 100),
            deliveredAlertIds: [...s.deliveredAlertIds, alertId].slice(-50),
          };
        }),
      clearNotificationHistory: () => set({ notificationHistory: [] }),
      hasDeliveredAlert: (alertId) => get().deliveredAlertIds.includes(alertId),
    }),
    {
      name: "parkclear-device-v1",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : undefined as any)),
      partialize: (s) => ({
        deviceId: s.deviceId,
        onboardingCompletedAt: s.onboardingCompletedAt,
        savedSpots: s.savedSpots,
        favorites: s.favorites,
        searchHistory: s.searchHistory,
        activeSession: s.activeSession,
        parkingHistory: s.parkingHistory,

        alertSettings: s.alertSettings,
        notificationHistory: s.notificationHistory,
        deliveredAlertIds: s.deliveredAlertIds,
      }),
    },
  ),
);

/** Stable anonymous device id, safe to call from SSR. */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  return useDeviceStore.getState().deviceId;
}

