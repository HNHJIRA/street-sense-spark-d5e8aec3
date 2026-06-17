# Add Arlington, VA as a supported city

This adds Arlington County, Virginia to the Parking Intelligence platform following the same architecture as Los Angeles, Santa Monica, West Hollywood, and Pasadena. The engine will never invent legality — anything Arlington doesn't publish stays UNKNOWN until resolved by a sign scan.

## Phase 1 — Data Discovery (Arlington GIS Open Data)

Arlington publishes geospatial data primarily through the **Arlington County GIS Open Data Hub** (ArcGIS Hub) and **TransportationGIS** ArcGIS REST services. I'll audit and document:

| # | Dataset | Source (ArcGIS REST / Hub) | Geometry | Usable for curb legality? |
|---|---|---|---|---|
| 1 | Street Centerlines | `gisdata.arlingtonva.us/.../MapServer` | LineString | Yes — base for segments |
| 2 | Parking Meters | Arlington GIS Hub: Parking Meters layer | Point | Yes — `metered` |
| 3 | Residential Permit Parking (RPP) Zones | Hub: RPP District polygons | Polygon | Yes — `permit_only` overlay |
| 4 | Loading Zones | Hub: Curbspace / Loading layer (if published) | Point/Line | Yes — `loading_only` |
| 5 | Time-Limited Parking | Hub: Curb Regulations (if published) | Line | Yes — `time_limited` |
| 6 | Street Sweeping | Hub: DES sweeping routes (if published) | Line | Yes — `street_sweeping` |
| 7 | Tow-away / No-Parking | Hub: signage layer (often absent) | Point | Partial — usually UNKNOWN |
| 8 | Garages & Lots | Hub: Parking Facilities | Point/Polygon | Off-street, info-only |

The discovery report (saved as `docs/arlington-coverage-discovery.md`) will list final URLs, feature counts, last-update dates, and an explicit "UNKNOWN — not published" entry for any dataset Arlington doesn't expose. Datasets not present at sync time are skipped gracefully and logged in `provider_health.notes`.

## Phase 2 — Providers

Following `src/lib/parking/providers/types.ts`:

- `src/lib/parking/providers/arlington.server.ts` — `ArlingtonProvider` (segment-creating, street centerlines + meters baseline).
- `src/lib/parking/providers/arlington-permit.server.ts` — `ArlingtonPermitOverlay` (RPP polygons → `permit_only` rules on segments via PostGIS spatial join, mirroring `weho-permit.server.ts`).
- `src/lib/parking/providers/arlington-loading.server.ts` — overlay for loading zones (if dataset exists).
- `src/lib/parking/providers/arlington-sweeping.server.ts` — overlay for sweeping routes (if dataset exists).

Each registers in `src/lib/parking/providers/registry.server.ts` with `cities: ["arlington"]`, writes to `provider_health`, and participates in `syncProvider` / `syncAllProvidersForCity`.

## Phase 3 — Segment generation

`ArlingtonProvider.fetchSegments` returns `NormalizedSegment[]` from street centerlines, deduped by `external_id = arlington:centerline/<OBJECTID>`. Existing upsert logic in `parking.functions.ts` handles dedup + `data_source` attribution. Side = `both` unless the dataset provides a curb side.

## Phase 4 — Rule mapping

| Arlington dataset | restriction_code |
|---|---|
| Meters | `metered` |
| RPP zone | `permit_only` (+ `permit_zone`) |
| Loading zone | `loading_only` |
| Time-limited curb | `time_limited` (+ `time_limit_minutes`) |
| Sweeping route | `street_sweeping` (+ day/time) |
| Tow-away sign point | `tow_away` |
| No matching data | row omitted → engine returns UNKNOWN |

Priority order matches the existing engine. No legality is fabricated.

## Phase 5 — Admin dashboard

- Add `arlington` to the city list in `src/routes/api/public/admin.sync-la.ts` (or a new `admin.sync-arlington.ts` endpoint mirroring it — I'll add the dedicated route per the task).
- Extend `src/lib/parking/la-coverage.functions.ts` → rename internal helpers to be city-agnostic and add Arlington areas (Rosslyn, Courthouse, Clarendon, Ballston, Crystal City, Pentagon City, Shirlington, Columbia Pike). The existing `/admin/la-coverage` page stays; I'll add `/admin/arlington-coverage` reusing the same component shape.
- Surface Arlington in `admin.accuracy.tsx`, `admin.health.tsx`, `admin.provider-sync.tsx` city pickers.

## Phase 6 — Coverage report

Generate `docs/arlington-coverage-report.md` summarizing segments, rules, rule density, % sweeping / permit / metered / unknown, provider health, dataset limitations, and recommended next steps (e.g. "Arlington does not publish a curb-regulations dataset — resolve via AI Sign Scanner").

## Database changes

One migration:
1. `INSERT INTO public.cities (slug, name, timezone, center, default_zoom)` for `arlington` (timezone `America/New_York`, center near Courthouse `[-77.0852, 38.8903]`).
2. Postgres function `arlington_area_counts(p_city_id, bbox...)` mirroring `la_area_counts` for the coverage dashboard.

No new tables — Arlington reuses `street_segments`, `parking_rules`, `provider_health`, `sync_logs`.

## Technical notes

- All Arlington REST calls use bbox filtering and pagination (`resultOffset` / `resultRecordCount`) like the existing LA providers.
- Network failures or missing datasets set `provider_health.healthy = false` with a clear `last_error`, never throw out of the sync.
- New providers follow the `*.server.ts` naming so they stay out of the client bundle.
- Endpoint: `GET /api/public/admin/sync-arlington?wait=1` runs the bounded city sync (same safety rails as `sync-la`).

## Files to add

- `src/lib/parking/providers/arlington.server.ts`
- `src/lib/parking/providers/arlington-permit.server.ts`
- `src/lib/parking/providers/arlington-loading.server.ts`
- `src/lib/parking/providers/arlington-sweeping.server.ts`
- `src/lib/parking/arlington-coverage.functions.ts`
- `src/routes/admin.arlington-coverage.tsx`
- `src/routes/api/public/admin.sync-arlington.ts`
- `docs/arlington-coverage-discovery.md`
- `docs/arlington-coverage-report.md`

## Files to edit

- `src/lib/parking/providers/registry.server.ts` — register Arlington providers.
- `src/routes/admin.index.tsx` — link to Arlington coverage page.
- One Supabase migration for the `cities` row + `arlington_area_counts` SQL function.

After approval I'll implement Phases 1–6 in that order, starting with the migration.
