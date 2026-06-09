// Seattle SDOT Signposts provider — additive layer on top of blockfaces.
// Pulls every posted sign (point dataset) and snaps it to the nearest
// existing blockface segment (within ~30 m). The snap happens at sync time
// inside syncCityAllProviders; here we only emit virtual segments whose
// external_id targets the *segment* that should receive the layered rule.
//
// Because the registry sync layer keys on `external_id`, signpost rules
// piggyback by reusing the underlying blockface's external_id.
//
// Marked .server.ts so the bundler refuses to ship this to the client.

import { fetchArcgis } from "./_la-shared.server";
import type { NormalizedRule, NormalizedSegment, ParkingProvider } from "./types";

// SDOT Sign Posts dataset (point features with CURRENT_STATUS_DATE, CATEGORY, etc.).
// Public ArcGIS feature service hosted by the City of Seattle.
const ENDPOINT =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Signs/FeatureServer/0/query";

interface SignAttrs {
  OBJECTID?: number;
  UNITDESC?: string | null;
  CATEGORY?: string | null;
  CUSTOMTEXT?: string | null;
  SIGN_TYPE?: string | null;
  TEXT?: string | null;
  COMPKEY?: number | null; // SDOT street segment key — used for snapping
}

interface PointGeom {
  x: number;
  y: number;
}

/** Heuristic OCR-style rule extractor from posted-sign text. */
function extractRules(text: string): NormalizedRule[] {
  const t = text.toUpperCase();
  const rules: NormalizedRule[] = [];

  if (/(NO PARK|NO STOPPING|TOW ?AWAY)/.test(t)) {
    rules.push({
      priority: 10,
      restriction_code: "no_parking",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      time_start: null, time_end: null,
      permit_zone: null, time_limit_minutes: null,
      effective_from: null, effective_to: null,
      notes: `SDOT posted sign: ${text}`,
    });
  }
  const timeLimit = t.match(/(\d{1,2})\s*(HR|HOUR)/);
  if (timeLimit) {
    rules.push({
      priority: 40,
      restriction_code: "time_limited",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      time_start: null, time_end: null,
      permit_zone: null,
      time_limit_minutes: parseInt(timeLimit[1], 10) * 60,
      effective_from: null, effective_to: null,
      notes: `SDOT posted ${timeLimit[1]}-hour limit.`,
    });
  }
  const zone = t.match(/ZONE\s*(\d{1,3})/);
  if (zone) {
    rules.push({
      priority: 50,
      restriction_code: "permit",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      time_start: null, time_end: null,
      permit_zone: zone[1],
      time_limit_minutes: null,
      effective_from: null, effective_to: null,
      notes: `RPZ Zone ${zone[1]} (posted).`,
    });
  }
  if (/LOAD(ING)?\s*ZONE/.test(t)) {
    rules.push({
      priority: 20,
      restriction_code: "no_parking",
      days_of_week: [1, 2, 3, 4, 5],
      time_start: "07:00", time_end: "18:00",
      permit_zone: null, time_limit_minutes: null,
      effective_from: null, effective_to: null,
      notes: "Loading zone (commercial vehicles only weekdays 7a–6p).",
    });
  }
  return rules;
}

export const SeattleSignpostsProvider: ParkingProvider = {
  id: "sdot-signposts",
  name: "Seattle SDOT Signposts",
  cities: ["seattle"],

  async fetchSegments(_citySlug, bbox) {
    const out: NormalizedSegment[] = [];
    try {
      const json = await fetchArcgis(ENDPOINT, {
        geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        resultRecordCount: "2000",
      });
      for (const f of (json.features ?? [])) {
        const a = f.attributes as SignAttrs;
        const g = f.geometry as PointGeom | undefined;
        if (!g || typeof g.x !== "number" || typeof g.y !== "number") continue;
        const text = [a.CUSTOMTEXT, a.TEXT, a.CATEGORY, a.SIGN_TYPE].filter(Boolean).join(" ");
        if (!text) continue;
        const rules = extractRules(text);
        if (rules.length === 0) continue;

        // Emit as a point-segment; the sync layer will spatially snap to the
        // nearest blockface within ~30 m and merge these rules onto it.
        out.push({
          external_id: `sdot-sign:${a.OBJECTID ?? `${g.x},${g.y}`}`,
          name: (a.UNITDESC ?? text).toString().slice(0, 200),
          side: "both",
          coordinates: [[g.x, g.y], [g.x + 1e-6, g.y + 1e-6]],
          metadata: {
            source_provider: "Seattle SDOT Signposts",
            sdot_compkey: a.COMPKEY ?? null,
            sign_text: text,
            geometry_kind: "sign_point",
          },
          rules,
        });
      }
    } catch (e) {
      console.warn("[SeattleSignposts] fetch failed:", (e as Error).message);
    }
    return out;
  },
};
