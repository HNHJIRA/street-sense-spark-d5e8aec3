import { useCallback, useEffect, useRef, useState } from "react";
import type * as MapboxGL from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { LocateFixed, Plus, Minus, Globe2, Square } from "lucide-react";
import {
  getSegmentsInBbox,
  importSeattleBlockface,
  type CityInfo,
  type SegmentLite,
} from "@/lib/parking/parking.functions";
import { getAvailabilityBlocksInBbox, type AvailabilityBlock } from "@/lib/parking/la-express.functions";
import type { ParkingColor } from "@/lib/parking/types";
import { useAppStore } from "@/stores/app-store";
import { useLocationStore } from "@/stores/location-store";
import { useMapTypeStore, MAPBOX_STYLE_FOR_TYPE } from "@/stores/map-type-store";
import { MapLayerButton } from "@/components/MapLayerButton";

interface MapViewProps {
  token: string;
  city: CityInfo;
}

const COLOR_HEX: Record<ParkingColor, string> = {
  green: "#22C55E",
  yellow: "#F0CE63",
  red: "#EF4444",
  gray: "#6B7280",
};

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

function metersToPixels(meters: number, lat: number, zoom: number) {
  const safeCos = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  return (meters * 512 * 2 ** zoom) / (EARTH_CIRCUMFERENCE_M * safeCos);
}

function segmentToFeature(s: SegmentLite): Feature<LineString> {
  return {
    type: "Feature",
    id: s.id,
    geometry: { type: "LineString", coordinates: s.coordinates },
    properties: {
      segmentId: s.id,
      name: s.name,
      color: s.color,
      side: s.side,
      label: s.label,
      restriction_code: s.restriction_code,
      sourceType: "legal",
    },
  };
}

function availabilityBlockToFeature(block: AvailabilityBlock): Feature<LineString> {
  const coords = block.coordinates.length >= 2
    ? block.coordinates
    : block.coordinates[0]
      ? [[block.coordinates[0][0] - 0.000035, block.coordinates[0][1]], [block.coordinates[0][0] + 0.000035, block.coordinates[0][1]]] as [number, number][]
      : [];
  return {
    type: "Feature",
    id: block.id,
    geometry: { type: "LineString", coordinates: coords },
    properties: {
      segmentId: block.id,
      name: block.name,
      color: block.color,
      side: "both",
      label: `${block.vacant}/${block.vacant + block.occupied} open`,
      vacant: block.vacant,
      occupied: block.occupied,
      ratio: block.ratio,
      updatedAt: block.updatedAt,
      sourceType: "availability",
    },
  };
}

export function MapView({ token, city }: MapViewProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxGL.Map | null>(null);
  const geolocateRef = useRef<MapboxGL.GeolocateControl | null>(null);
  const markerCtorRef = useRef<any>(null);
  const userMarkerRef = useRef<MapboxGL.Marker | null>(null);
  const accuracyMarkerRef = useRef<MapboxGL.Marker | null>(null);
  const lastLocationRef = useRef<{ lng: number; lat: number; accuracy: number | null; heading: number | null } | null>(null);
  const globeFrameRef = useRef<number | null>(null);
  const featuresRef = useRef<Map<string, Feature<LineString>>>(new Map());
  const importingRef = useRef(false);
  const lastFetchKeyRef = useRef<string>("");
  const [mapError, setMapError] = useState(false);
  const [ready, setReady] = useState(false);
  const [globeMode, setGlobeMode] = useState(false);
  const [topView, setTopView] = useState(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const mapType = useMapTypeStore((s) => s.mapType);
  // Latest mapType captured at init time so the effect that creates the map
  // doesn't need to depend on it (we don't want to recreate the map on switch).
  const initialMapTypeRef = useRef(mapType);

  const queryClient = useQueryClient();
  const fetchSegments = useServerFn(getSegmentsInBbox);
  const fetchAvailabilityBlocks = useServerFn(getAvailabilityBlocksInBbox);
  const runImport = useServerFn(importSeattleBlockface);

  const selectSegment = useAppStore((s) => s.selectSegment);
  const flyTo = useAppStore((s) => s.flyTo);
  const setFlyTo = useAppStore((s) => s.setFlyTo);
  const setMapCenter = useAppStore((s) => s.setMapCenter);
  const forecastAt = useAppStore((s) => s.forecastAt);
  const forecastAtIso = forecastAt ? forecastAt.toISOString() : null;
  const mapMode = useAppStore((s) => s.mapMode);
  const locationFix = useLocationStore((s) => s.current ?? s.lastKnown);
  const recommendedHighlight = useAppStore((s) => s.recommendedHighlight);


  const syncUserLocationMarker = useCallback((loc: { lng: number; lat: number; accuracy: number | null; heading: number | null } | null) => {
    const map = mapRef.current;
    const MarkerCtor = markerCtorRef.current as any;
    if (!map || !MarkerCtor || !loc) return;

    lastLocationRef.current = loc;
    const lngLat: [number, number] = [loc.lng, loc.lat];

    if (!accuracyMarkerRef.current) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.borderRadius = "9999px";
      el.style.background = "rgba(37, 99, 235, 0.14)";
      el.style.border = "2px solid rgba(37, 99, 235, 0.32)";
      el.style.pointerEvents = "none";
      el.style.transform = "translate(-50%, -50%)";
      el.style.zIndex = "40";
      accuracyMarkerRef.current = new MarkerCtor({ element: el, anchor: "center" }).setLngLat(lngLat).addTo(map);
    }

    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.style.position = "relative";
      el.style.width = "24px";
      el.style.height = "24px";
      el.style.borderRadius = "9999px";
      el.style.background = "#2563eb";
      el.style.border = "4px solid white";
      el.style.boxShadow = "0 0 0 2px rgba(37,99,235,.35), 0 8px 24px rgba(15,23,42,.35)";
      el.style.pointerEvents = "none";
      el.style.zIndex = "50";

      const heading = document.createElement("div");
      heading.dataset.heading = "true";
      heading.style.position = "absolute";
      heading.style.left = "50%";
      heading.style.top = "-15px";
      heading.style.width = "0";
      heading.style.height = "0";
      heading.style.borderLeft = "6px solid transparent";
      heading.style.borderRight = "6px solid transparent";
      heading.style.borderBottom = "15px solid #2563eb";
      heading.style.transform = "translateX(-50%)";
      heading.style.filter = "drop-shadow(0 1px 1px rgba(15,23,42,.35))";
      el.appendChild(heading);

      userMarkerRef.current = new MarkerCtor({ element: el, anchor: "center", rotationAlignment: "map" }).setLngLat(lngLat).addTo(map);
    }

    const radius = metersToPixels(Math.max(10, loc.accuracy ?? 30), loc.lat, map.getZoom());
    const diameter = Math.max(28, Math.min(260, radius * 2));
    const accuracyMarker = accuracyMarkerRef.current;
    const userMarker = userMarkerRef.current;
    if (!accuracyMarker || !userMarker) return;

    const accuracyEl = accuracyMarker.getElement();
    accuracyEl.style.width = `${diameter}px`;
    accuracyEl.style.height = `${diameter}px`;
    accuracyMarker.setLngLat(lngLat);

    const dotEl = userMarker.getElement();
    const headingEl = dotEl.querySelector<HTMLElement>("[data-heading='true']");
    if (headingEl) headingEl.style.display = typeof loc.heading === "number" ? "block" : "none";
    userMarker.setLngLat(lngLat);
    userMarker.setRotation(typeof loc.heading === "number" ? loc.heading : 0);
  }, []);

  const updateSource = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("segments") as MapboxGL.GeoJSONSource | undefined;
    if (!src) return;
    const data: FeatureCollection<LineString> = {
      type: "FeatureCollection",
      features: Array.from(featuresRef.current.values()),
    };
    src.setData(data);
  }, []);

  const loadBbox = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    if (!b) return;
    const minLng = b.getWest(), minLat = b.getSouth();
    const maxLng = b.getEast(), maxLat = b.getNorth();
    const w = maxLng - minLng, h = maxLat - minLat;
    if (w * h > 0.05) return;
    // Include mode + forecastAt in the cache key so changing either repaints.
    const key = `${mapMode}|${minLng.toFixed(3)},${minLat.toFixed(3)},${maxLng.toFixed(3)},${maxLat.toFixed(3)}|${forecastAtIso ?? "live"}`;
    if (key === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = key;

    if (mapMode === "available") {
      const blocks = city.slug === "los-angeles" ? await queryClient.fetchQuery({
        queryKey: ["la-availability-blocks", key],
        queryFn: () => fetchAvailabilityBlocks({ data: { minLng, minLat, maxLng, maxLat } }),
        staleTime: 30_000,
      }) : [];
      featuresRef.current.clear();
      for (const block of blocks) featuresRef.current.set(block.id, availabilityBlockToFeature(block));
      updateSource();
      return;
    }

    const segs = await queryClient.fetchQuery({
      queryKey: ["segments", city.id, key],
      queryFn: () => fetchSegments({
        data: {
          cityId: city.id, minLng, minLat, maxLng, maxLat,
          at: forecastAtIso, timezone: city.timezone,
        },
      }),
      staleTime: 60_000,
    });
    // Replace, don't merge — forecast time change must repaint every segment.
    featuresRef.current.clear();
    for (const s of segs) featuresRef.current.set(s.id, segmentToFeature(s));
    updateSource();

    if (segs.length === 0 && map.getZoom() >= 14 && !importingRef.current) {
      importingRef.current = true;
      const id = toast.loading("Loading real street data for this area…");
      try {
        const res = await runImport({ data: { citySlug: city.slug, minLng, minLat, maxLng, maxLat } });
        if (res.error) { toast.message(res.error, { id }); return; }
        toast.success(`Loaded ${res.imported} blockfaces`, { id });
        lastFetchKeyRef.current = "";
        await queryClient.invalidateQueries({ queryKey: ["segments", city.id] });
        await loadBbox();
      } catch (e) {
        toast.error((e as Error).message, { id });
      } finally {
        importingRef.current = false;
      }
    }
  }, [city.id, city.slug, city.timezone, fetchAvailabilityBlocks, fetchSegments, forecastAtIso, mapMode, queryClient, runImport, updateSource]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let disposed = false;
    let moveTimer: number | undefined;

    (async () => {
      try {
        // mapbox-gl v3 requires WebGL2. Some sandboxed iframes only expose
        // WebGL1 — detect ahead of construction and show fallback UI.
        try {
          const probe = document.createElement("canvas");
          const gl2 = probe.getContext("webgl2");
          if (!gl2) {
            console.warn("[MapView] WebGL2 unavailable in this context");
            setMapError(true);
            return;
          }
        } catch {
          setMapError(true);
          return;
        }

        const mod = await import("mapbox-gl");
        const mapboxgl = mod.default;
        if (!container.current || mapRef.current || disposed) return;

        mapboxgl.accessToken = token;


        let map: MapboxGL.Map;
        try {
          map = new mapboxgl.Map({
            container: container.current,
            style: MAPBOX_STYLE_FOR_TYPE[initialMapTypeRef.current],
            center: city.center as [number, number],
            zoom: Math.max(15.5, city.default_zoom),
            pitch: 60,
            bearing: -18,
            minZoom: 12,
            maxZoom: 20,
            attributionControl: false,
            antialias: true,
          });
          markerCtorRef.current = mapboxgl.Marker;
          map.dragRotate.enable();
          map.touchZoomRotate.enable();
          map.touchZoomRotate.enableRotation();
          if ((map as any).touchPitch?.enable) (map as any).touchPitch.enable();
          map.keyboard.enable();
          // Persistent user-location: blue dot + accuracy ring, driven by watchPosition.
          const geolocate = new mapboxgl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true, timeout: 8000 },
            trackUserLocation: true,
            showUserHeading: true,
            showAccuracyCircle: false,
            fitBoundsOptions: { maxZoom: 17 },
          });
          map.addControl(geolocate, "bottom-right");
          geolocateRef.current = geolocate;
          geolocate.on("error", (e: GeolocationPositionError) => {
            const msg =
              e?.code === 1 ? "Location permission denied. Enable it in your browser settings."
              : e?.code === 2 ? "Location unavailable on this device."
              : e?.code === 3 ? "Location request timed out."
              : "Couldn't get your location";
            toast.error(msg);
          });
          geolocate.on("geolocate", (pos: GeolocationPosition) => {
            // Mirror fixes into the global store so non-map screens can read
            // them. Global LocationService is the primary writer; this is a
            // belt-and-suspenders update for when the user actively triggers
            // GeolocateControl.
            useLocationStore.getState().setFix({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
              heading: Number.isFinite(pos.coords.heading ?? NaN) ? pos.coords.heading : null,
              speed: Number.isFinite(pos.coords.speed ?? NaN) ? pos.coords.speed : null,
              timestamp: pos.timestamp || Date.now(),
            });
          });
        } catch (err) {
          // WebGL2 unavailable in this preview iframe → surface fallback UI.
          console.error("[MapView] mapbox-gl init failed", err);
          setMapError(true);
          return;
        }

        map.on("error", (e: any) => {
          console.error("[MapView] mapbox error", e?.error ?? e);
        });

        map.on("style.load", () => {
          try {
            const layers = map.getStyle()?.layers ?? [];
            const labelLayer = layers.find(
              (l: any) => l.type === "symbol" && l.layout?.["text-field"],
            ) as any;
            const labelId = labelLayer?.id as string | undefined;

            // 3D buildings (best-effort — skip if style schema differs).
            try {
              if (map.getSource("composite") && !map.getLayer("3d-buildings")) {
                map.addLayer(
                  {
                    id: "3d-buildings",
                    source: "composite",
                    "source-layer": "building",
                    filter: ["==", "extrude", "true"],
                    type: "fill-extrusion",
                    minzoom: 14,
                    paint: {
                      "fill-extrusion-color": "#E8E1D6",
                      "fill-extrusion-height": [
                        "interpolate", ["linear"], ["zoom"],
                        14, 0, 15.5, ["get", "height"],
                      ],
                      "fill-extrusion-base": [
                        "interpolate", ["linear"], ["zoom"],
                        14, 0, 15.5, ["get", "min_height"],
                      ],
                      "fill-extrusion-opacity": 0.85,
                    },
                  },
                  labelId,
                );
              }
            } catch (err) {
              console.warn("[MapView] 3d-buildings layer skipped", err);
            }

            if (!map.getSource("segments")) {
              map.addSource("segments", {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
                promoteId: "segmentId",
              });
            }

            const colorExpr: any = [
              "match", ["get", "color"],
              "green", COLOR_HEX.green,
              "yellow", COLOR_HEX.yellow,
              "red", COLOR_HEX.red,
              "gray", COLOR_HEX.gray,
              COLOR_HEX.gray,
            ];
            const widthExpr: any = [
              "interpolate", ["linear"], ["zoom"],
              13, 1.8, 15, 3.5, 16, 4.5, 17, 6, 18, 8, 19, 11,
            ];
            // line-offset cannot wrap a zoom interpolate in a multiplication —
            // zoom must be the TOP-LEVEL input. Build sign-baked offsets instead.
            const offsetFor = (sign: 1 | -1): any => [
              "interpolate", ["linear"], ["zoom"],
              13, 2 * sign,
              15, 5 * sign,
              16, 7 * sign,
              17, 10 * sign,
              18, 14 * sign,
              19, 20 * sign,
            ];

            const addSeg = (id: string, side: "left" | "right", sign: 1 | -1) => {
              if (map.getLayer(id)) return;
              const layer: any = {
                id,
                type: "line",
                source: "segments",
                filter: ["any", ["==", ["get", "side"], side], ["==", ["get", "side"], "both"]],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                  "line-color": colorExpr,
                  "line-width": widthExpr,
                  "line-offset": offsetFor(sign),
                  "line-opacity": 1,
                },
              };
              if (labelId && map.getLayer(labelId)) map.addLayer(layer, labelId);
              else map.addLayer(layer);
            };
            addSeg("seg-left", "left", -1);
            addSeg("seg-right", "right", 1);

            // Recommended-parking highlight + connector line
            if (!map.getSource("rec-highlight")) {
              map.addSource("rec-highlight", {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
              });
              map.addLayer({
                id: "rec-highlight-line",
                type: "line",
                source: "rec-highlight",
                filter: ["==", ["get", "kind"], "segment"],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: { "line-color": "#2563eb", "line-width": 8, "line-opacity": 0.9 },
              });
              map.addLayer({
                id: "rec-highlight-connector",
                type: "line",
                source: "rec-highlight",
                filter: ["==", ["get", "kind"], "connector"],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                  "line-color": "#2563eb",
                  "line-width": 3,
                  "line-opacity": 0.85,
                  "line-dasharray": [2, 2],
                },
              });
            }



            // Register interaction handlers only ONCE per map instance —
            // style.load fires again after each setStyle() call, but Mapbox
            // keeps map-level event handlers across style swaps.
            if (!mapRef.current) {
              map.on("click", ["seg-left", "seg-right"] as any, (e: any) => {
                const f = e.features?.[0];
                const id = f?.properties?.segmentId as string | undefined;
                if (f?.properties?.sourceType === "availability") {
                  toast.message(f.properties.label ?? "Live meter availability");
                  return;
                }
                if (id) selectSegment(id);
              });

              for (const id of ["seg-left", "seg-right"]) {
                map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
                map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
              }
            }

            mapRef.current = map;
            setReady(true);
            // Bump version so dependent effects (rec-highlight, etc.) re-run
            // after style swaps that wipe user-added sources/data.
            setStyleVersion((v) => v + 1);
            // Force resize in case the container measured 0px during construction
            // (e.g., suspense fallback flicker). Tiles only fetch once sized.
            window.requestAnimationFrame(() => map.resize());
            window.setTimeout(() => map.resize(), 250);
            syncUserLocationMarker(lastLocationRef.current);
            updateSource();
            void loadBbox();

          } catch (err) {
            console.error("[MapView] style.load handler failed", err);
            setMapError(true);
          }
        });


        map.on("moveend", () => {
          const c = map.getCenter();
          setMapCenter({ lng: c.lng, lat: c.lat });
          window.clearTimeout(moveTimer);
          moveTimer = window.setTimeout(() => { void loadBbox(); }, 350);
        });
        // Seed map center for tap-to-query fallback before any move occurs.
        const c0 = map.getCenter();
        setMapCenter({ lng: c0.lng, lat: c0.lat });
        // Note: an additional non-fatal error logger is wired earlier; the
        // 401 token failure surfaces a friendly fallback UI.
        map.on("error", (e: any) => {
          if (e?.error?.status === 401) setMapError(true);
        });

      } catch {
        if (!disposed) setMapError(true);
      }
    })();

    return () => {
      disposed = true;
      window.clearTimeout(moveTimer);
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, city.id]);

  // Fly to from search
  useEffect(() => {
    if (!flyTo || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom: flyTo.zoom ?? 16.5,
      pitch: 60,
      duration: 1400,
      essential: true,
    });
    setFlyTo(null);
  }, [flyTo, setFlyTo]);

  // Forecast time or map mode changed → repaint the current bbox.
  useEffect(() => {
    if (!ready) return;
    lastFetchKeyRef.current = "";
    void loadBbox();
  }, [forecastAtIso, mapMode, ready, loadBbox]);

  useEffect(() => {
    if (!ready || !locationFix) return;
    syncUserLocationMarker({
      lng: locationFix.lng,
      lat: locationFix.lat,
      accuracy: locationFix.accuracy,
      heading: locationFix.heading,
    });
  }, [locationFix, ready, syncUserLocationMarker]);

  // Mode 4: recommended-parking highlight + connector line
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource("rec-highlight") as MapboxGL.GeoJSONSource | undefined;
    if (!src) return;
    if (!recommendedHighlight || recommendedHighlight.coordinates.length < 2) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const mid = recommendedHighlight.coordinates[Math.floor(recommendedHighlight.coordinates.length / 2)];
    const data: FeatureCollection<LineString> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: recommendedHighlight.coordinates },
          properties: { kind: "segment" },
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [recommendedHighlight.from.lng, recommendedHighlight.from.lat],
              mid,
            ],
          },
          properties: { kind: "connector" },
        },
      ],
    };
    src.setData(data);
  }, [ready, recommendedHighlight, styleVersion]);

  // Map-type switch: swap the underlying base style without recreating the
  // map. The existing style.load handler re-adds custom sources/layers, and
  // featuresRef preserves segment geometry so nothing refetches.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const targetStyle = MAPBOX_STYLE_FOR_TYPE[mapType];
    // Mapbox normalizes the style URL; compare by setting unconditionally
    // only when the requested type changes (skip the initial render).
    if (initialMapTypeRef.current === mapType) {
      initialMapTypeRef.current = mapType; // no-op, keep ref aligned
      return;
    }
    initialMapTypeRef.current = mapType;
    try {
      map.setStyle(targetStyle);
    } catch (err) {
      console.warn("[MapView] setStyle failed", err);
    }
  }, [mapType, ready]);


  useEffect(() => {
    const map = mapRef.current as any;
    if (!ready || !map) return;
    if (globeFrameRef.current) window.cancelAnimationFrame(globeFrameRef.current);

    if (!globeMode) {
      map.setProjection?.({ name: "mercator" });
      map.setFog?.(null);
      globeFrameRef.current = null;
      return;
    }

    map.setProjection?.({ name: "globe" });
    map.setFog?.({ color: "rgb(236, 232, 226)", "high-color": "rgb(186, 210, 235)", "horizon-blend": 0.02 });
    map.easeTo({ zoom: Math.max(15.5, map.getZoom()), pitch: 60, duration: 500 });

    const rotate = () => {
      map.rotateTo((map.getBearing() + 0.12) % 360, { duration: 0 });
      globeFrameRef.current = window.requestAnimationFrame(rotate);
    };
    globeFrameRef.current = window.requestAnimationFrame(rotate);
    return () => {
      if (globeFrameRef.current) window.cancelAnimationFrame(globeFrameRef.current);
      globeFrameRef.current = null;
    };
  }, [city.center, globeMode, locationFix, ready]);

  const zoomIn = () => mapRef.current?.zoomIn();
  const zoomOut = () => mapRef.current?.zoomOut();
  const toggleGlobe = () => setGlobeMode((v) => !v);
  const locate = () => {
    const loc = useLocationStore.getState().current ?? useLocationStore.getState().lastKnown;
    if (geolocateRef.current) {
      geolocateRef.current.trigger();
    }
    if (loc && mapRef.current) {
      syncUserLocationMarker({ lng: loc.lng, lat: loc.lat, accuracy: loc.accuracy, heading: loc.heading });
      
      mapRef.current.flyTo({ center: [loc.lng, loc.lat], zoom: 17, pitch: 60, duration: 1200, essential: true });
      return;
    }
    if (useLocationStore.getState().status === "denied") {
      toast.error("Location permission is denied. Enable location for this site in browser settings.");
      return;
    }
    if (!navigator.geolocation || !mapRef.current) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        useLocationStore.getState().setFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          heading: Number.isFinite(pos.coords.heading ?? NaN) ? pos.coords.heading : null,
          speed: Number.isFinite(pos.coords.speed ?? NaN) ? pos.coords.speed : null,
          timestamp: pos.timestamp || Date.now(),
        });
        mapRef.current?.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 17, pitch: 60, duration: 1200,
        });
      },
      () => toast.error("Couldn't get your location"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  return (
    <>
      <div ref={container} className="absolute inset-0 z-0 h-full w-full" />

      {ready && (
        <div
          className="pointer-events-none absolute right-0 z-20 flex flex-col items-end gap-2 px-3"
          style={{ top: "calc(var(--safe-top) + 4.5rem)" }}
        >
          <MapBtn onClick={zoomIn} ariaLabel="Zoom in"><Plus className="h-4 w-4" /></MapBtn>
          <MapBtn onClick={zoomOut} ariaLabel="Zoom out"><Minus className="h-4 w-4" /></MapBtn>
          <div className="h-1" />
          <MapBtn onClick={toggleGlobe} ariaLabel="Rotate globe"><Globe2 className="h-4 w-4" /></MapBtn>
          <MapBtn onClick={locate} ariaLabel="My location"><LocateFixed className="h-4 w-4" /></MapBtn>
          <MapLayerButton className="relative" />
        </div>
      )}

      {mapError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background p-6 text-center">
          <div className="max-w-sm">
            <h2 className="font-display text-lg font-bold">Map can't render here</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Mapbox failed to load. Check the token or try a different browser.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function MapBtn({
  children, onClick, ariaLabel,
}: { children: React.ReactNode; onClick: () => void; ariaLabel: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-800 shadow-lg ring-1 ring-black/5 transition hover:bg-neutral-50 active:scale-95"
    >
      {children}
    </button>
  );
}
