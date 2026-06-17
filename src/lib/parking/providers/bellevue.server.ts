// Bellevue, WA — open-data segment provider.
//
// VERIFIED OPEN DATA: City of Bellevue Open Data Hub publishes a single
// authoritative streets layer (Streets, FeatureServer layer 10, 10,629
// polylines as of 2026-06). This provider imports those centerlines as
// street_segments and attaches an explicit `unknown` rule per segment.
//
// Why no parking rules are attached:
//   - Bellevue does NOT publish a curb-regulation layer (no CDS feed).
//   - Bellevue does NOT publish a sign inventory.
//   - Bellevue's permit (RPZ) zones are administered through
//     rpz.bellevuewa.gov, not exposed as a GIS layer.
//   - Bellevue's paid-parking program was approved 2026-05-28 and is in
//     pilot rollout; no rate-area GIS feed exists yet.
//   - The Arterial Sweeping Routes layer carries a frequency *code*
//     ("BikeHigh", "ArterialsMedium", etc.) but NO day-of-week or
//     time-of-day field, so it cannot be turned into a `street_cleaning`
//     window without inferring legality — explicitly out of scope.
//
// Until any of the above publish machine-readable schedules, every
// Bellevue segment honestly reports `unknown` (priority 900). The Sign
// Scanner is the supported path to resolve individual blocks.
//
// See docs/bellevue-coverage-discovery.md for the full discovery report.

import { normalizeSide, resolveRuleConflicts } from "./normalize";
import { arcgisPolyline, fetchArcgis, unknownRule } from "./_la-shared.server";
import type { NormalizedRule, NormalizedSegment, ParkingProvider } from "./types";

// Bellevue Streets layer lives on layer 10 of the Streets FeatureServer
// (layers 0-9 are related sub-layers). 10,629 polylines, EPSG:3857 source —
// fetchArcgis forces outSR=4326 so we receive lng/lat back.
const STREETS_ENDPOINT =
  "https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Streets/FeatureServer/10/query";

interface StreetAttrs {
  ObjectID?: number;
  OBJECTID?: number;
  StreetSegmentID?: number;
  OfficialStreetName?: string;
  LifeCycleStatus?: string;
  FromAddressLeft?: number;
  ToAddressLeft?: number;
  FromAddressRight?: number;
  ToAddressRight?: number;
  IsPrivate?: string;
  IsAccessRoad?: string;
  StreetBlockNumber?: number;
  FunctionClassDescription?: string;
  ArterialClassification?: string;
}

async function fetchAllPaginated<T>(
  endpoint: string,
  params: Record<string, string>,
): Promise<Array<{ attributes: T; geometry?: unknown }>> {
  const PAGE = 2000;
  let offset = 0;
  let more = true;
  const out: Array<{ attributes: T; geometry?: unknown }> = [];
  while (more) {
    const json = (await fetchArcgis(endpoint, {
      ...params,
      resultRecordCount: String(PAGE),
      resultOffset: String(offset),
    })) as {
      features?: Array<{ attributes: T; geometry?: unknown }>;
      exceededTransferLimit?: boolean;
    };
    const feats = json.features ?? [];
    out.push(...feats);
    more = !!json.exceededTransferLimit && feats.length > 0;
    offset += feats.length;
    if (offset > 50_000) break; // hard safety cap
  }
  return out;
}

function pickName(a: StreetAttrs): string {
  const name = a.OfficialStreetName?.trim();
  if (name) return name;
  const oid = a.ObjectID ?? a.OBJECTID;
  return oid != null ? `Bellevue centerline ${oid}` : "Bellevue street";
}

function isPrivate(a: StreetAttrs): boolean {
  const p = (a.IsPrivate ?? "").toString().trim().toLowerCase();
  return p === "y" || p === "yes" || p === "true" || p === "1";
}

export const BellevueProvider: ParkingProvider = {
  id: "bellevue-opendata",
  name: "City of Bellevue Open Data",
  cities: ["bellevue"],

  async fetchSegments(_citySlug, bbox) {
    const feats = await fetchAllPaginated<StreetAttrs>(STREETS_ENDPOINT, {
      geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
    });

    const out: NormalizedSegment[] = [];
    for (const f of feats) {
      const a = f.attributes;
      const oid = a.ObjectID ?? a.OBJECTID;
      if (oid == null) continue;
      // Skip retired records: only "Active" lifecycle status counts as
      // currently published street geometry.
      const status = (a.LifeCycleStatus ?? "").toString().trim().toLowerCase();
      if (status && status !== "active") continue;
      // Skip clearly non-curb-parking geometry (private drives, access roads).
      if (isPrivate(a)) continue;

      const coords = arcgisPolyline(f.geometry);
      if (coords.length < 2) continue;

      const rules: NormalizedRule[] = [
        unknownRule(
          "Bellevue does not currently publish curb regulations, sign inventory, or RPZ block-face data as open data. " +
            "Paid parking was approved 2026-05-28 and is in pilot rollout. " +
            "Use the AI Sign Scanner to resolve posted rules at the curb.",
        ),
      ];

      out.push({
        external_id: `bellevue:streets/${oid}`,
        name: pickName(a),
        side: normalizeSide(null),
        coordinates: coords,
        metadata: {
          source_provider: "City of Bellevue Open Data",
          dataset: "Streets",
          layer_id: 10,
          street_segment_id: a.StreetSegmentID ?? null,
          arterial_classification: a.ArterialClassification ?? null,
          function_class: a.FunctionClassDescription ?? null,
          sweeping_frequency_code: undefined, // present in upstream but unused; see provider header
          posted_restrictions: "unknown",
        },
        rules: resolveRuleConflicts(rules),
      });
    }

    return out;
  },
};
