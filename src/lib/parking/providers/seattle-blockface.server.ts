// Seattle SDOT Blockface provider — production source for Seattle.
// Pulls every on-street blockface (with PARKING_CATEGORY) from Seattle's
// official ArcGIS FeatureServer and normalizes it through the shared layer.
//
// Marked .server.ts so the bundler refuses to ship this to the client.

import { normalizeCategory, normalizeSide, resolveRuleConflicts } from "./normalize";
import type { NormalizedSegment, ParkingProvider, SyncBbox } from "./types";

const ENDPOINT =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Parking_Categories/FeatureServer/0/query";

interface SdotProps {
  OBJECTID?: number;
  UNITDESC?: string | null;
  SIDE?: string | null;
  PARKING_CATEGORY?: string | null;
  TOTAL_SPACES?: number | null;
}

interface SdotFeature {
  type: "Feature";
  geometry:
    | { type: "LineString"; coordinates: [number, number][] }
    | { type: "MultiLineString"; coordinates: [number, number][][] };
  properties: SdotProps;
}

async function fetchPage(bbox: SyncBbox, offset: number, pageSize: number) {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "OBJECTID,UNITDESC,SIDE,PARKING_CATEGORY,TOTAL_SPACES",
    geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
    resultRecordCount: String(pageSize),
    resultOffset: String(offset),
    f: "geojson",
  });
  const res = await fetch(`${ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`SDOT FeatureServer responded ${res.status}`);
  return (await res.json()) as {
    features?: SdotFeature[];
    properties?: { exceededTransferLimit?: boolean };
  };
}

function pickLongestPart(coords: [number, number][][]): [number, number][] {
  return coords.reduce((a, b) => (b.length > a.length ? b : a), coords[0] ?? []);
}

export const SeattleBlockfaceProvider: ParkingProvider = {
  id: "sdot",
  name: "Seattle SDOT Blockface",
  cities: ["seattle"],

  async fetchSegments(_citySlug, bbox) {
    const features: SdotFeature[] = [];
    const pageSize = 2000;
    for (let offset = 0; offset < 20000; offset += pageSize) {
      const json = await fetchPage(bbox, offset, pageSize);
      const batch = json.features ?? [];
      features.push(...batch);
      if (batch.length < pageSize && !json.properties?.exceededTransferLimit) break;
    }

    const out: NormalizedSegment[] = [];
    for (const f of features) {
      const p = f.properties ?? {};
      const oid = p.OBJECTID;
      if (!oid) continue;

      let coords: [number, number][] = [];
      if (f.geometry.type === "LineString") coords = f.geometry.coordinates;
      else if (f.geometry.type === "MultiLineString") coords = pickLongestPart(f.geometry.coordinates);
      if (!coords || coords.length < 2) continue;

      const classified = normalizeCategory(p.PARKING_CATEGORY);

      const rules = resolveRuleConflicts([
        {
          priority: classified.priority,
          restriction_code: classified.code,
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          time_start: null,
          time_end: null,
          permit_zone: null,
          time_limit_minutes: null,
          effective_from: null,
          effective_to: null,
          notes: classified.notes,
        },
      ]);

      out.push({
        external_id: `sdot:blockface/${oid}`,
        name: (p.UNITDESC ?? "Unnamed block").toString(),
        side: normalizeSide(p.SIDE),
        coordinates: coords,
        metadata: {
          parking_category: p.PARKING_CATEGORY ?? null,
          total_spaces: p.TOTAL_SPACES ?? null,
          sdot_side: p.SIDE ?? null,
          sdot_objectid: oid,
          source_provider: "Seattle SDOT Blockface",
        },
        rules,
      });
    }
    return out;
  },
};
