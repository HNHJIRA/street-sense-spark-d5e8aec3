import { useCallback, useEffect, useRef, useState } from "react";
import type * as MapboxGL from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Sliders, Info, LocateFixed, Plus, Minus } from "lucide-react";
import {
  getSegmentsInBbox,
  importOsmStreets,
  type CityInfo,
  type SegmentLite,
} from "@/lib/parking/parking.functions";
import type { ParkingColor } from "@/lib/parking/types";
import { useAppStore } from "@/stores/app-store";

interface MapViewProps {
  token: string;
  city: CityInfo;
}

const COLOR_HEX: Record<ParkingColor, string> = {
  green: "#22C55E",
  yellow: "#F0CE63",
  red: "#EF4444",
};

// Seattle parking-area bounds (SW, NE).
const BOUNDS: [[number, number], [number, number]] = [
  [-122.459, 47.481],
  [-122.224, 47.734],
];

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
    },
  };
}

export function MapView({ token, city }: MapViewProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxGL.Map | null>(null);
  const featuresRef = useRef<Map<string, Feature<LineString>>>(new Map());
  const importingRef = useRef(false);
  const lastFetchKeyRef = useRef<string>("");
  const [mapError, setMapError] = useState(false);
  const [ready, setReady] = useState(false);

  const queryClient = useQueryClient();
  const fetchSegments = useServerFn(getSegmentsInBbox);
  const runImport = useServerFn(importOsmStreets);

  const selectSegment = useAppStore((s) => s.selectSegment);
  const flyTo = useAppStore((s) => s.flyTo);
  const setFlyTo = useAppStore((s) => s.setFlyTo);

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
    const key = `${minLng.toFixed(3)},${minLat.toFixed(3)},${maxLng.toFixed(3)},${maxLat.toFixed(3)}`;
    if (key === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = key;

    const segs = await queryClient.fetchQuery({
      queryKey: ["segments", city.id, key],
      queryFn: () => fetchSegments({ data: { cityId: city.id, minLng, minLat, maxLng, maxLat } }),
      staleTime: 60_000,
    });
    for (const s of segs) featuresRef.current.set(s.id, segmentToFeature(s));
    updateSource();

    if (segs.length === 0 && map.getZoom() >= 14 && !importingRef.current) {
      importingRef.current = true;
      const id = toast.loading("Loading real street data for this area…");
      try {
        const res = await runImport({ data: { citySlug: city.slug, minLng, minLat, maxLng, maxLat } });
        if (res.error) { toast.message(res.error, { id }); return; }
        toast.success(`Imported ${res.imported} streets`, { id });
        lastFetchKeyRef.current = "";
        await queryClient.invalidateQueries({ queryKey: ["segments", city.id] });
        await loadBbox();
      } catch (e) {
        toast.error((e as Error).message, { id });
      } finally {
        importingRef.current = false;
      }
    }
  }, [city.id, city.slug, fetchSegments, queryClient, runImport, updateSource]);

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
            style: "mapbox://styles/mapbox/streets-v12",
            center: city.center as [number, number],
            zoom: Math.max(15.5, city.default_zoom),
            pitch: 60,
            bearing: -18,
            maxBounds: BOUNDS,
            minZoom: 12,
            maxZoom: 20,
            attributionControl: false,
            antialias: true,
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
              if (!map.getLayer("3d-buildings")) {
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
              COLOR_HEX.green,
            ];
            const widthExpr: any = [
              "interpolate", ["linear"], ["zoom"],
              13, 1.8, 15, 3.5, 16, 4.5, 17, 6, 18, 8, 19, 11,
            ];
            const offsetBase: any = [
              "interpolate", ["linear"], ["zoom"],
              13, 2, 15, 5, 16, 7, 17, 10, 18, 14, 19, 20,
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
                  "line-offset": sign === -1 ? ["*", offsetBase, -1] : offsetBase,
                  "line-opacity": 1,
                },
              };
              if (labelId && map.getLayer(labelId)) map.addLayer(layer, labelId);
              else map.addLayer(layer);
            };
            addSeg("seg-left", "left", -1);
            addSeg("seg-right", "right", 1);

            map.on("click", ["seg-left", "seg-right"] as any, (e: any) => {
              const f = e.features?.[0];
              const id = f?.properties?.segmentId as string | undefined;
              if (id) selectSegment(id);
            });

            for (const id of ["seg-left", "seg-right"]) {
              map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
              map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
            }

            mapRef.current = map;
            setReady(true);
            // Force resize in case the container measured 0px during construction
            // (e.g., suspense fallback flicker). Tiles only fetch once sized.
            window.requestAnimationFrame(() => map.resize());
            window.setTimeout(() => map.resize(), 250);
            updateSource();
            void loadBbox();

          } catch (err) {
            console.error("[MapView] style.load handler failed", err);
            setMapError(true);
          }
        });


        map.on("moveend", () => {
          window.clearTimeout(moveTimer);
          moveTimer = window.setTimeout(() => { void loadBbox(); }, 350);
        });
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

  const zoomIn = () => mapRef.current?.zoomIn();
  const zoomOut = () => mapRef.current?.zoomOut();
  const locate = () => {
    if (!navigator.geolocation || !mapRef.current) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
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
          style={{ top: "calc(var(--safe-top) + 8rem)" }}
        >
          <MapBtn onClick={zoomIn} ariaLabel="Zoom in"><Plus className="h-5 w-5" /></MapBtn>
          <MapBtn onClick={zoomOut} ariaLabel="Zoom out"><Minus className="h-5 w-5" /></MapBtn>
          <div className="h-1" />
          <MapBtn onClick={() => toast.message("Map settings coming soon")} ariaLabel="Map settings">
            <Sliders className="h-5 w-5" />
          </MapBtn>
          <MapBtn onClick={() => toast.message("Tap any colored line for details")} ariaLabel="Info">
            <Info className="h-5 w-5" />
          </MapBtn>
          <MapBtn onClick={locate} ariaLabel="My location"><LocateFixed className="h-5 w-5" /></MapBtn>
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
      className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-neutral-800 shadow-lg ring-1 ring-black/5 transition hover:bg-neutral-50 active:scale-95"
    >
      {children}
    </button>
  );
}
