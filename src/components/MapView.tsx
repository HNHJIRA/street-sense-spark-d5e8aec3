import { useEffect, useMemo, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Feature, FeatureCollection, LineString } from "geojson";
import type { CityBundle, ParkingColor } from "@/lib/parking/types";
import { computeStatus } from "@/lib/parking/engine";
import { useAppStore } from "@/stores/app-store";

interface MapViewProps {
  token: string;
  bundle: CityBundle;
  now: Date;
}

const COLOR_HEX: Record<ParkingColor, string> = {
  green: "#5BE0A4",
  yellow: "#F0CE63",
  red: "#F26A5C",
};

export function MapView({ token, bundle, now }: MapViewProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const selectSegment = useAppStore((s) => s.selectSegment);
  const flyTo = useAppStore((s) => s.flyTo);
  const setFlyTo = useAppStore((s) => s.setFlyTo);

  // Build GeoJSON with computed color per segment
  const data = useMemo<FeatureCollection<LineString>>(() => {
    const features: Feature<LineString>[] = bundle.segments.map((seg) => {
      const status = computeStatus(seg, bundle.restrictionTypes, now, bundle.city.timezone);
      return {
        type: "Feature",
        id: seg.id,
        geometry: { type: "LineString", coordinates: seg.coordinates },
        properties: {
          segmentId: seg.id,
          name: seg.name,
          color: status.color,
          label: status.label,
        },
      };
    });
    return { type: "FeatureCollection", features };
  }, [bundle, now]);

  // Init map once
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: container.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: bundle.city.center,
      zoom: bundle.city.default_zoom,
      attributionControl: false,
      pitchWithRotate: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
    map.addControl(new mapboxgl.GeolocateControl({ trackUserLocation: true, showUserHeading: true }), "top-right");

    map.on("load", () => {
      map.addSource("segments", { type: "geojson", data });
      map.addLayer({
        id: "segments-line-casing",
        type: "line",
        source: "segments",
        paint: {
          "line-color": "#0b1020",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 5, 16, 11, 19, 18],
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
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 7, 19, 12],
          "line-opacity": 0.95,
        },
      });
      map.on("click", "segments-line", (e) => {
        const f = e.features?.[0];
        const id = f?.properties?.segmentId as string | undefined;
        if (id) selectSegment(id);
      });
      map.on("mouseenter", "segments-line", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "segments-line", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Update source data when colors recompute
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("segments") as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(data);
  }, [data]);

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

  return <div ref={container} className="absolute inset-0" />;
}
