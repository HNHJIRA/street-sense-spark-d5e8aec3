// Direct ArcGIS self-test for Arlington providers. Hits each FeatureServer
// layer with the simplest possible read (`where=1=1`, no geometry filter)
// and reports endpoint URL, layer ID, declared geometry type, total feature
// count, and the first raw feature. No DB writes, no normalization — this
// confirms the upstream service is reachable and serving data.

import { createFileRoute } from "@tanstack/react-router";

interface LayerProbe {
  label: string;
  service_url: string;
  layer_id: number;
  query_url: string;
  query_params: Record<string, string>;
  layer_metadata: unknown;
  feature_count: number | null;
  first_raw_feature: unknown;
  error: string | null;
}

const LAYERS = [
  {
    label: "arlington-opendata · Street Network",
    service: "https://arlgis.arlingtonva.us/arcgis/rest/services/Open_Data/od_Street_Network/FeatureServer",
    layerId: 0,
  },
  {
    label: "arlington-opendata · Parking Meter Points",
    service: "https://arlgis.arlingtonva.us/arcgis/rest/services/Open_Data/od_Parking_Meter_Points/FeatureServer",
    layerId: 0,
  },
  {
    label: "arlington-permit · Permit Parking",
    service: "https://arlgis.arlingtonva.us/arcgis/rest/services/Open_Data/od_Permit_Parking/FeatureServer",
    layerId: 0,
  },
];

async function probe(label: string, service: string, layerId: number): Promise<LayerProbe> {
  const queryUrl = `${service}/${layerId}/query`;
  const params: Record<string, string> = {
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    f: "json",
    resultRecordCount: "1",
  };
  const out: LayerProbe = {
    label,
    service_url: service,
    layer_id: layerId,
    query_url: queryUrl,
    query_params: params,
    layer_metadata: null,
    feature_count: null,
    first_raw_feature: null,
    error: null,
  };
  try {
    // Layer metadata (verifies layer exists + is public)
    const metaRes = await fetch(`${service}/${layerId}?f=json`);
    out.layer_metadata = metaRes.ok ? await metaRes.json() : { http: metaRes.status };

    // Feature count (no geometry filter — proves the dataset is non-empty)
    const countRes = await fetch(`${queryUrl}?where=1%3D1&returnCountOnly=true&f=json`);
    const countJson = countRes.ok ? await countRes.json() as { count?: number } : null;
    out.feature_count = countJson?.count ?? null;

    // First raw feature, full schema
    const qs = new URLSearchParams(params);
    const fRes = await fetch(`${queryUrl}?${qs.toString()}`);
    if (!fRes.ok) throw new Error(`HTTP ${fRes.status}`);
    const fJson = await fRes.json() as { features?: unknown[]; error?: unknown };
    if ((fJson as { error?: unknown }).error) {
      out.error = JSON.stringify((fJson as { error: unknown }).error);
    } else {
      out.first_raw_feature = fJson.features?.[0] ?? null;
    }
  } catch (e) {
    out.error = (e as Error).message;
  }
  return out;
}

export const Route = createFileRoute("/api/public/admin/arlington-self-test")({
  server: {
    handlers: {
      GET: async () => {
        const probes = await Promise.all(LAYERS.map((l) => probe(l.label, l.service, l.layerId)));
        return new Response(JSON.stringify({ ok: true, probes }, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
