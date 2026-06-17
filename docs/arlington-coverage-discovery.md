# Arlington, VA — Parking Data Coverage Discovery Report

This audit catalogs publicly available Arlington County, Virginia
transportation and GIS datasets relevant to curbside parking legality.
It follows the same philosophy used for Los Angeles, Santa Monica, West
Hollywood, and Pasadena: **the engine never invents legality. Anything
Arlington does not publish stays UNKNOWN until resolved by the AI Sign
Scanner.**

## Source registries audited

- Arlington County GIS Open Data Hub — `gisdata-arlgis.opendata.arcgis.com`
- Arlington County ArcGIS Online services —
  `services1.arcgis.com/mVFRs7NF4iFitgbY/arcgis/rest/services`
- Arlington County Department of Environmental Services (DES) — public maps
- WMATA / regional transportation portals (cross-referenced for context only)

## Dataset inventory

| # | Dataset | Source | Provider type | Geometry | Feature count (approx) | Key attributes | Last update | Usable for curb legality? |
|---|---|---|---|---|---|---|---|---|
| 1 | Street Centerlines | Arlington GIS Hub → `Street_Centerlines/FeatureServer/0` | ArcGIS FeatureServer | LineString | ~30,000 | `STREETNAME`, `FULLNAME`, address ranges | Quarterly | **Yes** — base layer for `street_segments` |
| 2 | Parking Meters | Arlington GIS Hub → `Parking_Meters/FeatureServer/0` | ArcGIS FeatureServer | Point | ~4,500 | `METER_ID`, `ZONE`, `RATE`, `TIME_LIMIT`, `HOURS` | Monthly | **Yes** — `metered` rule, snapped to nearest centerline |
| 3 | Residential Permit Parking (RPP) Districts | Arlington GIS Hub → `RPP_Districts/FeatureServer/0` (publication intermittent) | ArcGIS FeatureServer | Polygon | ~30 districts | `DISTRICT`, `ZONE`, `NAME` | Irregular | **Yes (when published)** — `permit_only` polygon overlay |
| 4 | Loading Zones | Not published as a discrete open dataset | — | — | 0 | — | n/a | **UNKNOWN** — must be resolved via sign scan |
| 5 | Time-Limited Curb Parking | Not published | — | — | 0 | — | n/a | **UNKNOWN** — sign scan only |
| 6 | Street Sweeping Routes | Arlington DES does not publish a public schedule layer | — | — | 0 | — | n/a | **UNKNOWN** — sign scan only |
| 7 | Tow-Away / Temporary No Parking | Not published as GIS layer (notices are published by DES in PDF form) | — | — | 0 | — | n/a | **UNKNOWN** — sign scan only |
| 8 | Off-Street Parking Garages & Lots | Arlington GIS Hub → `Parking_Facilities` | ArcGIS FeatureServer | Point / Polygon | ~120 | `NAME`, `TYPE`, `SPACES` | Annual | Off-street, info-only (not on-street legality) |
| 9 | Bike Lanes / Curbside extensions | Arlington Bike Network layer | ArcGIS FeatureServer | LineString | ~600 | `TYPE` | Annual | Indirect — curb may be no-parking adjacent (do **not** infer legality) |

## What Arlington DOES publish (usable today)

1. **Street centerlines** — geometry backbone for `street_segments`.
2. **Parking meter inventory** — directly maps to `metered` rules; `TIME_LIMIT` and `HOURS` carry meter constraints when present.
3. **RPP district polygons** — when the layer is up, supports a polygon overlay producing `permit_only` rules tagged with the district zone.

## What Arlington DOES NOT publish (explicit limitations)

- No comprehensive curb-regulation layer (no per-block no-parking, no time-limited zones, no loading zones, no tow-away signage).
- No street-sweeping schedule layer.
- No machine-readable feed of temporary "Tow-Away — No Parking" notices.

For every street segment lacking a verified rule above, the provider emits
an explicit `unknown` rule. The engine renders these as UNKNOWN and the AI
Sign Scanner is the supported path to resolve them at the curb.

## Endpoint reference

| Purpose | URL |
|---|---|
| Centerlines | `https://services1.arcgis.com/mVFRs7NF4iFitgbY/arcgis/rest/services/Street_Centerlines/FeatureServer/0/query` |
| Parking meters | `https://services1.arcgis.com/mVFRs7NF4iFitgbY/arcgis/rest/services/Parking_Meters/FeatureServer/0/query` |
| RPP districts | `https://services1.arcgis.com/mVFRs7NF4iFitgbY/arcgis/rest/services/RPP_Districts/FeatureServer/0/query` |

All endpoints use ArcGIS REST query semantics: bbox filter via
`geometry`/`geometryType=esriGeometryEnvelope`, paginated with
`resultOffset` / `resultRecordCount`. Failures are recorded in
`provider_health.last_error` and never silently fabricate parking rules.
