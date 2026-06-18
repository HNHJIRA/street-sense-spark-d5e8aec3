# Bellevue Deep Discovery Report (Phase 2)

Goal: find the Bellevue equivalent of Arlington's `Curb_Management_Data`
dataset and bring Bellevue coverage quality close to Arlington's.

**Read-only audit**, no code changes. Numbers below come from live ArcGIS
REST probes on 2026-06-18 against the public service directories.

## A. Sources Discovered

### A.1 ArcGIS service directories enumerated

| Host | Status | Notes |
|---|---|---|
| `services1.arcgis.com/EYzEZbDhXZjURPbP` (Hub / `cobgis`) | 320 services | Anonymous read |
| `gis-web.bellevuewa.gov/gisext/rest/services` | 19 folders | Anonymous read; Transportation folder is rich |
| `gisweb.bellevuewa.gov` / `maps.bellevuewa.gov` | DNS NXDOMAIN | Do not exist |

### A.2 Top candidate layers (parking-relevant)

| # | Source | URL | Geometry | Features | Public | Parking usability | Est. coverage gain |
|---|---|---|---|---|---|---|---|
| 1 | **Curb_Space_Typology / L23 `curb_typology_existing`** | `services1.arcgis.com/EYzEZbDhXZjURPbP/.../Curb_Space_Typology/FeatureServer/23` | polyline | **926** | yes | **HIGH** — the Bellevue CDS-equivalent. Each polyline carries `side_of_street`, `main_street`, `street_start/end`, and seven boolean typology flags: `typ_m_auto/bike/transit` (Movement), `typ_a` (Access), `typ_p` (Place), `typ_s_auto/transit` (Storage). `typ_s_auto=1` ⇒ on-street auto storage (i.e. parking allowed). | ⚠️ **BelRed neighborhood only** — every feature has `neighborhood='BelRed'`. ~5–8% of city centerlines. |
| 2 | TIMS_Reference / **L10 `RPZ`** | `gis-web.bellevuewa.gov/gisext/rest/services/Transportation/TIMS_Reference/MapServer/10` | polygon | **16** | yes | **HIGH** — official Residential Parking Zone polygons with `RPZ_ID`, `CODENO`. Snap to street centerlines → permit rules. | ~5–10% of city (residential blocks adjacent to downtown / hospital district). |
| 3 | `Signs_Merge / L0` | `services1.arcgis.com/.../Signs_Merge/FeatureServer/0` | point | **315** | yes | LOW (volume), MEDIUM (schema). Real sign-asset table: `SignTypeDescription`, `OnStreet`, `Facing`, `SideOfRoad`, `StreetSegmentID`. Sample row is a speed-limit sign — this is a curated subset, NOT the citywide sign inventory. | <1% on its own. |
| 4 | `No_Parking_Sign / L6` | `services1.arcgis.com/.../No_Parking_Sign/FeatureServer/6` | point | **17** | yes | NEAR-ZERO. Schema is bare (`OBJECTID`, `GlobalID`, audit fields only). Likely a Survey123 placeholder. | negligible. |
| 5 | `BlockParty_No_Parking` | `services1.arcgis.com/.../BlockParty_No_Parking/FeatureServer/0` | (not probed in detail) | small | yes | Temporary block-party closures, NOT recurring rules. | irrelevant for steady-state coverage. |
| 6 | `Streets / L10` (already imported) | `services1.arcgis.com/.../Streets/FeatureServer/10` | polyline | ~10,629 | yes | base map | 100% gray today |
| 7 | `Arterial_Sweeping_Routes` | `services1.arcgis.com/.../Arterial_Sweeping_Routes/FeatureServer/0` | polyline | 1,758 | yes | NONE — frequency code only, no day-of-week, no time-of-day. **Refuse to infer schedule.** | 0 |
| 8 | `Public_ROW` / `Streetscapes` / `Road_Centerlines` | hub | polyline | various | yes | redundant w/ Streets | 0 |
| 9 | `Transportation/StreetSignMaintenanceRO` | gisext | various | base map only | yes | NO sign features in published layers (just Bellevue boundary, parcels, maintenance districts). The actual citywide sign asset table appears to be on a non-public layer. | 0 |
| 10 | `Transportation/TransMgmtDataMaintenanceRO` | gisext | base layers | yes | same — base only | 0 |
| 11 | `Transportation/ROWPermits` | gisext | polygon/point/polyline | small | yes | construction/right-of-way permits — temporary closures. Not recurring parking rules. | 0 (steady-state) |
| 12 | `CurbType_*` shadow layers (StoreAutoExist, MoveAutoExist, …) | hub | polyline | 15 each | yes | These are the **per-typology slices** of the BelRed dataset (counts of 15 = top-level styling rows, not actual segments). The authoritative dataset is L23 above. | duplicate |
| 13 | `Curb_Space_Typology` other layers (L0 Project Area, L17 POI, L22 CMP project boundaries, L24 future) | hub | polygon/point/polyline | small/duplicate | yes | L24 = future-state typology (planning, not enforceable today). L22 = pilot expansion polygons. | future expansion only |
| 14 | `Curb Space Management Viewing` web map (`ce3a9eae…`) + Viewer2 app (`00ce98d4…`) | AGOL | container | n/a | yes | Confirms L23 is the authoritative dataset; the published viewer references the same layers we found. | n/a |

### A.3 RPZ portal investigation — `rpz.bellevuewa.gov`

- Returns an **ASP.NET Web Forms application** (`/Start`, `__VIEWSTATE`,
  jQuery 3.7, Bootstrap). Title: "Request a Parking Permit – City of
  Bellevue Transportation".
- No JSON/REST API, no GeoJSON, no MapServer, no embedded ArcGIS layer.
  Network requests are `.aspx` postbacks driving a wizard for residents
  to apply for a permit.
- **The geographic layer for RPZ lives in TIMS_Reference / L10 above**,
  not in the rpz.bellevuewa.gov app. The web app is a forms front-end.

### A.4 Paid Parking program (2025–2026 rollout)

- Council approved **2026-05-28**; pilot in Downtown / Wilburton / BelRed.
- Source-of-truth documents are PDFs only (`Bellevue_CMP.pdf`,
  `bellevue-curb-pricing-implementation-strategy_final.pdf`,
  `Bellevue_CMP_AppendixB.pdf`).
- **No GIS feed yet** — searched `cobgis` Hub for *paid parking*, *meter*,
  *rate area*, *pricing zone*: zero matches. ArcGIS Online portal-wide
  search returned only the curb-typology web map and storm-system layers.
- This will appear in the cobgis Hub once meters are deployed; not before.

### A.5 Sign data — citywide inventory not public

- `Signs_Merge` (315 points) is a curated subset — the schema reveals
  Bellevue **does** maintain a real Cartegraph-style sign-asset database
  (`SignTypeDescription` like `R2-1_SPEED LIMIT`, `AssetNumber`,
  `OnStreet`, `Facing`, `SideOfRoad`, `StreetSegmentID`, `MaintainedBy`).
- That full inventory is not exposed as a public FeatureServer. The
  `gisext/Transportation/StreetSignMaintenanceRO` MapService publishes
  base layers only (boundaries, parcels, maintenance districts) — the
  sign asset layer is restricted.
- A direct request to City of Bellevue ITD/Transportation is the path
  to obtain it.

### A.6 Street sweeping schedules

- Bellevue does **not** publish day-of-week or time-of-day sweeping
  schedules in any public dataset, PDF, or calendar feed I could find.
- `Arterial_Sweeping_Routes` carries only a frequency *code* (BikeHigh,
  ArterialsMedium, …). Without time-of-day, **do not** synthesize a
  street_cleaning rule.

## B. Coverage Potential Estimate

### B.1 What we can build with discovered data only

| Provider | Source | Output | Segments affected |
|---|---|---|---|
| `bellevue-opendata` (DONE) | Streets | unknown | all 8,137 |
| `bellevue-curb` (NEW) | `Curb_Space_Typology/23` | `allowed` (typ_s_auto=1), `bus_zone`/`taxi`/`loading` from movement/access flags, `no_parking` (no storage flags set on a curb segment) | ~926 polylines, BelRed only |
| `bellevue-rpz` (NEW) | `TIMS_Reference/10` | `permit` (snap polygon → centerline) | est. 600–1,200 segments inside the 16 RPZ polygons |
| `bellevue-no-parking` (probe) | `No_Parking_Sign/6` | `no_parking` (point→nearest segment) | 17 (negligible) |

### B.2 Achievable color mix (Phase 2, all integrated)

Of 8,137 Bellevue segments:

| | today | after Phase 2 |
|---|---|---|
| 🟢 green | 0 | ~700 (BelRed `typ_s_auto=1` + non-RPZ allowed) ≈ **8–9%** |
| 🟡 yellow | 0 | ~1,000 (RPZ permit + BelRed loading/transit/access) ≈ **12–13%** |
| 🔴 red | 0 | ~150 (BelRed bus/movement-only curb + 17 NP signs) ≈ **2%** |
| ⚪ gray | 100% | ~6,300 ≈ **77%** |

**Arlington today**: green 55%, yellow 20%, red 5%, gray 20%.
**Bellevue ceiling without new sources: ~23% non-gray**. That's the
honest answer: Bellevue does not currently publish a citywide CDS layer,
so we cannot match Arlington with public data alone.

### B.3 What would close the gap

The Bellevue equivalent of Arlington's `Curb_Management_Data` does not
yet exist as open data. Three paths to parity:

1. **Wait for the paid-parking rollout** — the CMP / curb-pricing
   strategy explicitly commits to extending curb typology citywide and
   publishing rate-area GIS once meters go live. Realistic horizon: late
   2026 / 2027.
2. **Direct data request** to City of Bellevue ITD/Transportation for:
   - the full StreetSignMaintenanceRO sign inventory (not just the 315
     in Signs_Merge),
   - the Cartegraph curb-asset layer if one exists,
   - sweeping schedule with day/time fields.
3. **AI Sign Scanner** for user-driven block-by-block resolution
   (already in the app).

## C. Recommended Phase 2 Implementation Order

Only build providers where verified, time-resolved data exists.

1. **bellevue-rpz** (overlay) — TIMS_Reference/10 → 16 polygons → snap
   to existing Bellevue street_segments → emit `permit` rules at
   priority 600 with `permit_zone = CODENO`. Highest value-per-effort:
   the only citywide-shaped Bellevue parking dataset.
2. **bellevue-curb** (segment-or-overlay) — Curb_Space_Typology/23 →
   926 polylines → match by `main_street` + `street_start/end` +
   `side_of_street` to existing centerlines, or attach as a side-keyed
   overlay. Translation:
   - `typ_s_auto=1` and no movement/access flag → `allowed` (priority 700)
   - `typ_a=1` only → `loading_zone` (priority 500)
   - `typ_m_transit=1` → `bus_zone` (priority 400)
   - all storage flags 0 and any movement flag 1 → `no_parking` (priority 300)
3. **bellevue-no-parking** — only if `No_Parking_Sign/6` schema gets
   real fields. Currently skip.
4. **DO NOT build** sweeping, paid-parking, or sign-derived providers
   yet. Document the gap and pursue direct data outreach.

No code changes in this turn. Awaiting approval to implement Phase 2 in
the order above.
