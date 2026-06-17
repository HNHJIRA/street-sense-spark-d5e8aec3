# Bellevue, WA — Parking Data Discovery Report

_Last updated: 2026-06-17_

## Summary

Bellevue's published parking data is fundamentally thinner than Arlington's.
The City of Bellevue Open Data Hub publishes a single authoritative streets
centerline layer, but does **not** publish curb regulations, sign inventory,
RPZ (permit) block-face data, or paid-parking rate areas as machine-readable
open data.

Implication: Bellevue is bootstrapped at "Arlington Phase 1" parity (street
network + explicit `unknown` rules), but cannot reach Arlington Phase 2
parity (curb data import) until the City publishes that data.

## Phase 1 — Dataset Inventory (verified live)

### Used by `bellevue-opendata` (segment provider)

| Dataset | URL | Geometry | Features | Used | Notes |
|---|---|---|---|---|---|
| Streets | `services1.arcgis.com/EYzEZbDhXZjURPbP/.../Streets/FeatureServer/10` | Polyline (EPSG:3857) | 10,629 | ✅ | Base centerline network. Imports as `street_segments`; emits one `unknown` (priority 900) per segment. Filtered to `LifeCycleStatus = 'Active'`, excludes `IsPrivate`. |

### Probed but **not** consumed (no actionable schedule)

| Dataset | URL | Geometry | Features | Used | Reason |
|---|---|---|---|---|---|
| Arterial Sweeping Routes | `.../Arterial_Sweeping_Routes/FeatureServer/0` | Polyline | 1,758 | ❌ | Schema only contains `ArterialSweepingFrequencyCode` (values: `BikeHigh`, `ArterialsMedium`, `ArterialsLow`, etc.). **No day-of-week, no time-of-day.** Cannot be turned into a `street_cleaning` window without inferring a schedule from a frequency bucket — explicitly out of scope. |
| Arterial Classification | `.../Arterial_Classification/FeatureServer` | Polyline | ~3k | ❌ | Functional class only. We do not derive parking legality from arterial class (would require a verified ordinance citation). |
| Snow Routes | `.../SnowRoutes/FeatureServer` | Polyline | — | ❌ | Only restricts parking during declared snow emergencies, not a standing rule. |
| Streetscapes | `.../streetscapes` | Polyline / polygon | — | ❌ | Urban-design styling (trees, planters). Not parking. |
| Street Lights (Small Wireless) | `.../Street_Lights_Small_Wireless_Facilities/FeatureServer` | Point | — | ❌ | Pole assets only. |

### Confirmed absent (verified with `q=…` against the Hub search API)

| Looked for | Result | Implication |
|---|---|---|
| `q=curb` | 0 hits | No equivalent of Arlington's CDS curb-zone layer. |
| `q=sign` | 0 hits | No equivalent of Seattle's `Street_Signs` inventory. |
| `q=loading` | 0 hits | Cannot map loading / commercial loading / passenger loading. |
| `q=parking` | 4 hits, all parks/trails (not curb parking) | No GIS for any curb regulation. |
| RPZ / Permit Parking GIS | None | `rpz.bellevuewa.gov` is a permit purchase app; no zone polygons exposed. |
| Metered / paid parking | Not operational | Council approved paid street parking 2026-05-28. Pilot rollout; no rate-area GIS published yet. |

## Phase 2 — Coverage Comparison

| Capability | LA | Santa Monica | Arlington | **Bellevue** |
|---|---|---|---|---|
| Base centerlines | ✅ | ✅ | ✅ | ✅ Streets/10 |
| Metered parking | ✅ | ✅ | ✅ | ❌ doesn't exist yet |
| Permit (RPZ) | ✅ | — | ✅ | ⚠ not as GIS |
| Curb regulations (CDS) | ✅ | ⚠ partial | ✅ 59k rules | ❌ none |
| Sign inventory | ✅ | — | — | ❌ |
| Street sweeping | ✅ | ✅ | — | ⚠ frequency code only, no schedule |
| Loading / bus / taxi | ✅ | partial | ✅ via curb | ❌ |
| No-parking / tow-away | ✅ | partial | ✅ via curb | ❌ |

Expected Bellevue counts at end of Phase 1:

| Bucket | Estimate |
|---|---|
| Total segments | ~10,000 (≤10,629 Streets features, minus private + non-active) |
| 🟢 green (allowed) | 0 |
| 🟡 yellow (metered/permit/loading/time-limited) | 0 |
| 🔴 red (no_parking/sweeping/tow_away) | 0 |
| ⚪ gray (unknown) | ~100% |

## Phase 3 — Future Data Sources (tracked, not built)

1. **Bellevue paid-parking GIS** — Council approved 2026-05-28; rate areas
   currently exist only in PDF (`bellevue-curb-pricing-implementation
   -strategy_final.pdf`, Nov 2025). When the City publishes the rate areas
   as a FeatureServer layer, add a `bellevue-paid-parking` overlay
   provider with restriction `metered`.
2. **Bellevue RPZ block-face GIS** — Only available behind the permit
   purchase app today. If/when the City publishes the authoritative zone
   polygons, add a `bellevue-rpz` overlay with restriction `permit`. **Do
   not scrape** without an open-data license.
3. **Bellevue Curb Management / CDS** — 2023 Curb Management Plan
   commits to data-sharing pilots. If a CDS-format curb feed appears, add
   a `bellevue-curb` overlay mirroring `arlington-curb.server.ts`.
4. **Authoritative sweeping schedule** — If `Arterial Sweeping Routes`
   ever gains day-of-week / time-of-day fields, or a separate
   `Street_Sweeping_Schedule` layer is published, add a
   `bellevue-sweeping` overlay with restriction `street_cleaning`.

## Phase 1 — Architecture

```
City of Bellevue Open Data Hub
    └── Streets (FeatureServer/10, 10,629 polylines)
            │
            ▼
   bellevue-opendata (segment provider)
            │
            ▼
   street_segments  + parking_rules
                       └── { restriction_code: "unknown", priority: 900 }
```

Identical to Arlington's pre-curb bootstrap. No overlay providers are
registered today.

## Anti-goals (explicit)

- **No invented parking rules.** Every Bellevue segment carries `unknown`
  until verified curb data is published.
- **No inference from arterial classification.** A street being a
  "principal arterial" is not a legal basis for `no_parking`.
- **No inference from sweeping frequency.** "ArterialsMedium" is not a
  schedule.
- **No RPZ scraping.** RPZ zone definitions belong to the City; we wait
  for the open-data publication.

## Operational endpoints

- Sync: `GET /api/public/admin/sync-bellevue?wait=1`
- Coverage dashboard: `/admin/bellevue-coverage`
- Provider in registry: `bellevue-opendata`
- City bbox: `-122.235 / 47.520 → -122.080 / 47.680`
- Timezone: `America/Los_Angeles`
