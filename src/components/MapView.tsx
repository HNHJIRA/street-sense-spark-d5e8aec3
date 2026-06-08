import { useCallback, useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
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
  green: "#5BE0A4",
  yellow: "#F0CE63",
  red: "#F26A5C",
};

function segmentToFeature(s: SegmentLite): Feature<LineString> {
  return {
    type: "Feature",
    id: s.id,
    geometry: { type: "LineString", coordinates: s.coordinates },
    properties: {
      segmentId: s.id,
      name: s.name,
      color: s.color,
      label: s.label,
      restriction_code: s.restriction_code,
    },
  };
}

export function MapView({ token, city }: MapViewProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const featuresRef = useRef<Map<string, Feature<LineString>>>(new Map());
  const importingRef = useRef(false);
  const lastFetchKeyRef = useRef<string>("");
  const webglOk = typeof window !== "undefined" && mapboxgl.supported();

  const queryClient = useQueryClient();
  const fetchSegments = useServerFn(getSegmentsInBbox);
  const runImport = useServerFn(importOsmStreets);

  const selectSegment = useAppStore((s) => s.selectSegment);
  const flyTo = useAppStore((s) => s.flyTo);
  const setFlyTo = useAppStore((s) => s.setFlyTo);

  const updateSource = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("segments") as mapboxgl.GeoJSONSource | undefined;
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
    if (w * h > 0.05) return; // too zoomed out — skip
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

    // Auto-import once if the area is empty and we're zoomed in enough.
    if (segs.length === 0 && map.getZoom() >= 14 && !importingRef.current) {
      importingRef.current = true;
      const id = toast.loading("Loading real street data for this area…");
      try {
        const res = await runImport({ data: { citySlug: city.slug, minLng, minLat, maxLng, maxLat } });
        toast.success(`Imported ${res.imported} streets`, { id });
        // Force refetch by clearing the key memo.
        lastFetchKeyRef.current = "";
        await loadBbox();
      } catch (e) {
        toast.error((e as Error).message, { id });
      } finally {
        importingRef.current = false;
      }
    }
  }, [city.id, city.slug, fetchSegments, queryClient, runImport, updateSource]);

  // Init map once
  useEffect(() => {
    if (!container.current || mapRef.current || !webglOk) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: container.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: city.center,
      zoom: Math.max(15, city.default_zoom),
      attributionControl: false,
      pitchWithRotate: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
    map.addControl(new mapboxgl.GeolocateControl({ trackUserLocation: true, showUserHeading: true }), "top-right");

    let moveTimer: number | undefined;

    map.on("load", () => {
      map.addSource("segments", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "segments-line-casing",
        type: "line",
        source: "segments",
        paint: {
          "line-color": "#0b1020",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 4, 16, 9, 19, 16],
          "line-opacity": 0.7,
        },
      });
      map.addLayer({
        id: "segments-line",
        type: "line",
        source: "segments",
        paint: {
          "line-color": [
            "match",
            ["get", "color"],
            "green", COLOR_HEX.green,
            "yellow", COLOR_HEX.yellow,
            "red", COLOR_HEX.red,
            "#7c8597",
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 6, 19, 11],
          "line-opacity": 0.95,
        },
      });
      map.on("click", "segments-line", (e) => {
        const f = e.features?.[0];
        const id = f?.properties?.segmentId as string | undefined;
        if (id) selectSegment(id);
      });
      map.on("mouseenter", "segments-line", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "segments-line", () => { map.getCanvas().style.cursor = ""; });

      // Initial load
      void loadBbox();
    });

    map.on("moveend", () => {
      window.clearTimeout(moveTimer);
      moveTimer = window.setTimeout(() => { void loadBbox(); }, 350);
    });

    mapRef.current = map;
    return () => {
      window.clearTimeout(moveTimer);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, city.id]);

  // Fly to from search
  useEffect(() => {
    if (!flyTo || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom: flyTo.zoom ?? 16,
      duration: 1200,
    });
    setFlyTo(null);
  }, [flyTo, setFlyTo]);

  return (
    <>
      <div ref={container} className="absolute inset-0" />
      {!webglOk && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background p-6 text-center">
          <div className="max-w-sm">
            <h2 className="font-display text-lg font-bold">Map can't render here</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your browser or this preview iframe has WebGL disabled. Open the preview in a new tab
              (or use Chrome / Safari with hardware acceleration on) to see the parking map.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
