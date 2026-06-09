// Global location store. Owns the device's last-known GPS fix so that any
// screen (map, scan, session, alerts) can read coordinates without
// re-prompting permission or re-mounting watchPosition.
//
// SOURCE OF TRUTH: this store. MapView's GeolocateControl is now a SINK —
// it pushes every fix into here. Other code (ParkHereButton, scan, session)
// reads from here. When GPS is unavailable, the last-known fix persists
// across reloads via localStorage.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type LocationStatus =
  | "idle"           // service not started yet
  | "prompting"      // browser permission prompt visible
  | "watching"       // watchPosition is active and producing fixes
  | "denied"         // user denied permission
  | "unavailable"    // device has no GPS / not secure context
  | "error";         // last attempt failed (timeout etc.)

export interface DeviceLocation {
  lat: number;
  lng: number;
  accuracy: number | null;   // meters, 1σ radius
  heading: number | null;    // degrees from true north, null if unknown
  speed: number | null;      // m/s, null if unknown
  timestamp: number;         // ms since epoch
}

interface LocationState {
  status: LocationStatus;
  permission: PermissionState | "unknown";
  /** Latest fix (live). */
  current: DeviceLocation | null;
  /** Last fix we ever saw (survives reloads). */
  lastKnown: DeviceLocation | null;
  /** Last geolocation error code (1=denied, 2=unavailable, 3=timeout). */
  lastErrorCode: number | null;
  /** Last error message. */
  lastErrorMessage: string | null;

  setStatus: (s: LocationStatus) => void;
  setPermission: (p: PermissionState | "unknown") => void;
  setFix: (loc: DeviceLocation) => void;
  setError: (code: number, message: string) => void;
}

export const useLocationStore = create<LocationState>()(
  persist(
    (set) => ({
      status: "idle",
      permission: "unknown",
      current: null,
      lastKnown: null,
      lastErrorCode: null,
      lastErrorMessage: null,

      setStatus: (status) => set({ status }),
      setPermission: (permission) => set({ permission }),
      setFix: (loc) =>
        set({
          current: loc,
          lastKnown: loc,
          status: "watching",
          lastErrorCode: null,
          lastErrorMessage: null,
        }),
      setError: (code, message) =>
        set({
          lastErrorCode: code,
          lastErrorMessage: message,
          status:
            code === 1 ? "denied"
            : code === 2 ? "unavailable"
            : "error",
        }),
    }),
    {
      name: "parkclear.location.v1",
      storage: createJSONStorage(() => localStorage),
      // Only persist last-known + permission hint. Never persist `current`
      // as authoritative — stale "live" data is a foot-gun.
      partialize: (s) => ({ lastKnown: s.lastKnown, permission: s.permission }),
    },
  ),
);

// ---- Distance helpers (client-safe) ----

const EARTH_M = 6_371_000;
function toRad(d: number) { return (d * Math.PI) / 180; }

/** Great-circle distance in meters between two [lng,lat] points. */
export function haversineMeters(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Walking time at 1.4 m/s (~5 km/h). Returns whole minutes, min 1. */
export function walkingMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / 1.4 / 60));
}

export function formatLocationAge(ts: number, nowMs = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
