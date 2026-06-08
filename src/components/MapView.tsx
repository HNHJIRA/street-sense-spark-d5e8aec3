import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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
  void token;
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const segmentLayerRef = useRef<L.GeoJSON<LineString> | null>(null);
  const featuresRef = useRef<Map<string, Feature<LineString>>>(new Map());
  const importingRef = useRef(false);
  const lastFetchKeyRef = useRef<string>("");
  const [mapError, setMapError] = useState(false);

  const queryClient = useQueryClient();
  const fetchSegments = useServerFn(getSegmentsInBbox);
  const runImport = useServerFn(importOsmStreets);

  const selectSegment = useAppStore((s) => s.selectSegment);
  const flyTo = useAppStore((s) => s.flyTo);
  const setFlyTo = useAppStore((s) => s.setFlyTo);

  const updateSource = useCallback(() => {
    const layer = segmentLayerRef.current;
    if (!layer) return;
    const data: FeatureCollection<LineString> = {
      type: "FeatureCollection",
      features: Array.from(featuresRef.current.values()),
    };
    layer.clearLayers();
    layer.addData(data);
  }, []);

  const loadBbox = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
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
        await queryClient.invalidateQueries({ queryKey: ["segments", city.id] });
        await loadBbox();
      } catch (e) {
        toast.error((e as Error).message, { id });
      } finally {
        importingRef.current = false;
      }
    }
  }, [city.id, city.slug, fetchSegments, queryClient, runImport, updateSource]);

  // Init map once with raster tiles so it works without WebGL.
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let map: L.Map;
    try {
      map = L.map(container.current, {
        center: [city.center[1], city.center[0]],
        zoom: Math.max(15, city.default_zoom),
        zoomControl: false,
        attributionControl: false,
      });
    } catch {
      setMapError(true);
      return;
    }

    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer(
      `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/512/{z}/{x}/{y}@2x?access_token=${token}`,
      { tileSize: 512, zoomOffset: -1, maxZoom: 20 },
    ).addTo(map);

    segmentLayerRef.current = L.geoJSON(undefined, {
      style: (feature) => ({
        color: COLOR_HEX[(feature?.properties?.color as ParkingColor | undefined) ?? "green"],
        weight: 7,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      }),
      onEachFeature: (feature, layer) => {
        layer.on("click", () => {
          const id = feature.properties?.segmentId as string | undefined;
          if (id) selectSegment(id);
        });
      },
    }).addTo(map) as L.GeoJSON<LineString>;

    let moveTimer: number | undefined;
    map.on("moveend", () => {
      window.clearTimeout(moveTimer);
      moveTimer = window.setTimeout(() => { void loadBbox(); }, 350);
    });

    mapRef.current = map;
    window.setTimeout(() => {
      map.invalidateSize();
      void loadBbox();
    }, 0);

    return () => {
      window.clearTimeout(moveTimer);
      map.remove();
      mapRef.current = null;
      segmentLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, city.id]);

  // Fly to from search
  useEffect(() => {
    if (!flyTo || !mapRef.current) return;
    mapRef.current.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? 16, { duration: 1.2 });
    setFlyTo(null);
  }, [flyTo, setFlyTo]);

  return (
    <>
      <div ref={container} className="absolute inset-0" />
      {mapError && (
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
