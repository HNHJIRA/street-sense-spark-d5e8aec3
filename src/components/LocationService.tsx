// Headless component: starts navigator.geolocation.watchPosition once at the
// app root and pipes every fix into useLocationStore. Renders nothing.
//
// Why a component (not a plain module): we need browser APIs and React's
// mount lifecycle so the watch is cleaned up on hot-reload and we can react
// to permission state changes via the Permissions API where supported.
import { useEffect } from "react";
import { useLocationStore } from "@/stores/location-store";

const WATCH_OPTS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5_000,
  timeout: 15_000,
};

export function LocationService() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const store = useLocationStore.getState;

    if (!("geolocation" in navigator) || !window.isSecureContext) {
      store().setStatus("unavailable");
      return;
    }

    // Track permission state when supported. Safari pre-16.4 lacks
    // navigator.permissions.query for "geolocation" — we handle that
    // silently by falling back to the implicit prompt on first watch.
    let permStatus: PermissionStatus | null = null;
    const onPermChange = () => {
      if (!permStatus) return;
      store().setPermission(permStatus.state);
      if (permStatus.state === "denied") store().setStatus("denied");
    };
    (async () => {
      try {
        // @ts-expect-error — "geolocation" is a valid PermissionName at runtime
        permStatus = await navigator.permissions?.query({ name: "geolocation" });
        if (permStatus) {
          store().setPermission(permStatus.state);
          permStatus.addEventListener?.("change", onPermChange);
        }
      } catch { /* unsupported — ignore */ }
    })();

    store().setStatus("prompting");
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        store().setFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          heading: Number.isFinite(pos.coords.heading ?? NaN) ? pos.coords.heading : null,
          speed: Number.isFinite(pos.coords.speed ?? NaN) ? pos.coords.speed : null,
          timestamp: pos.timestamp || Date.now(),
        });
      },
      (err) => {
        store().setError(err.code, err.message || "Geolocation failed");
        // eslint-disable-next-line no-console
        console.warn("[LocationService] geolocation error", err.code, err.message);
      },
      WATCH_OPTS,
    );

    return () => {
      try { navigator.geolocation.clearWatch(watchId); } catch { /* ignore */ }
      permStatus?.removeEventListener?.("change", onPermChange);
    };
  }, []);

  return null;
}
