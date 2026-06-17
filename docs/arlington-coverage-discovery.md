# Arlington Coverage Discovery Sprint

Goal: bring Arlington UNKNOWN coverage as close to Los Angeles as possible
using only **verified public datasets**. No heuristics, no AI-generated
parking rules.

## Source inventory

All endpoints were probed live on 2026-06-17 via:
- `https://arlgis.arlingtonva.us/arcgis/rest/services/Open_Data` (folder listing)
- `https://arlgis.arlingtonva.us/arcgis/rest/services/Project_Services` (folder listing)
- `https://gisdata-arlgis.opendata.arcgis.com/` (ArcGIS Hub)
- `https://data.virginia.gov/organization/arlington-gis-portal`

### Usable datasets (wired into the parking engine)

| Dataset | URL | Features | Geometry | Provider | Restriction codes generated | Est. coverage gain |
|---|---|---:|---|---|---|---|
| **Curb Management Data — Curb Zone Policies (CDS-format)** | `Project_Services/Curb_Management_Data/FeatureServer/0` | **132,140** | polyline (WGS84) | `arlington-curb` (new) | `allowed`, `no_parking`, `no_standing`, `loading_zone`, `commercial_loading`, `passenger_loading`, `metered`, `permit`, `time_limited`, `taxi_zone`, `bus_zone` | **Massive** — first source of verified `allowed` (green) for Arlington; covers every classified Arlington curb |
| Street Network (centerlines) | `Open_Data/od_Street_Network/FeatureServer/0` | ~8,157 (in bbox) | polyline | `arlington-opendata` | `unknown` baseline | Already integrated — creates every street segment |
| Parking Meter Points | `Open_Data/od_Parking_Meter_Points/FeatureServer/0` | ~1,579 | point | `arlington-opendata` | `metered` | Already integrated |
| Residential Permit Parking (RPP) | `Open_Data/od_Permit_Parking/FeatureServer/0` | 1,350 | polyline | `arlington-permit` | `permit` | Already integrated (~1,308 matched segments) |

### Curb Management Data — schema summary

`Curb Zone Policies` (layer 0) is the denormalised join of curb-zone
geometry and the curb policy that applies to it. Key fields:

```
street_name, street_side, cross_street_start_name, cross_street_end_name,
curb_policy_id, activity, user_classes, max_stay, max_stay_unit, rate,
days_of_week, time_of_day_start, time_of_day_end, num_spaces,
parking_angle, length
```

Activity distribution from the first 2,000 sampled policies:

```
533  parking      (with rate/max_stay/user_classes variants)
148  no parking   (often "FIRE HYDRANT", "DRIVEWAY", etc. in user_classes)
 11  loading
  4  other        — skipped
  1  no loading
  1  standing
  1  no standing
 35  null         — skipped
```

Activity → restriction_code mapping (see
`src/lib/parking/providers/arlington-curb.server.ts::classify`):

| Source | Conditions | Code | Priority |
|---|---|---|---:|
| `no parking` | (any) | `no_parking` | 30 |
| `no loading` | (any) | `no_parking` | 30 |
| `no standing` | (any) | `no_standing` | 30 |
| `loading` | `user_classes` includes commercial/truck/freight | `commercial_loading` | 40 |
| `loading` | `user_classes` includes passenger/psgr | `passenger_loading` | 40 |
| `loading` | else | `loading_zone` | 40 |
| `standing` | (any) | `passenger_loading` | 40 |
| `parking` | `user_classes` includes permit/rpp/zoneN | `permit` (with zone) | 50 |
| `parking` | `rate > 0` | `metered` | 40 |
| `parking` | `max_stay > 0` | `time_limited` (with minutes) | 60 |
| `parking` | else (standard) | `allowed` | 200 |
| (any) | `user_classes` includes bus | `bus_zone` | 40 |
| (any) | `user_classes` includes taxi | `taxi_zone` | 40 |
| `other` / blank | — | (skipped — never fabricated) | — |

### Datasets reviewed but NOT usable

| Dataset | URL | Why skipped |
|---|---|---|
| Taxi Stands | `Open_Data/od_Transportation_Layers/FeatureServer/0` | 43 points; CDS layer already encodes taxi zones in `user_classes`. Will revisit if CDS coverage misses them. |
| Bus Stops | `Open_Data/od_Bus_Stop_Points/FeatureServer/0` | 1,144 points; bus stops are not the same as bus *zones* (no-parking). CDS encodes bus zones via `user_classes`. |
| Commercial Street Sweeping (`Public_Maps/gctx_public/MapServer/109`) | 2,154 polylines | Layer documents which roads receive commercial sweeping, **not a schedule**. Arlington publishes no street-sweeping schedule layer (confirmed: "Arlington does not publish a sweeping layer"). Without a schedule the engine cannot generate timed `street_cleaning` rules. |
| Street Sweeping group | `Public_Maps/gctx_public/MapServer/126` | Group layer (no geometry). Subllayers are commercial-only. |
| Pavement Markings | `Open_Data/od_DES_Pavement_Markings/FeatureServer/0` | Geometry of paint stripes; not interpretable as parking legality without sign correlation. |
| Tow-Away PDFs | DES website | Posted as PDFs only, not as a dataset. Future: schedule a PDF parser. |
| Sign Points | `Open_Data/od_Sign_Points/FeatureServer/0` | Inventory of physical signs without parsed regulation text. Sign Scanner handles this case via on-device OCR. |
| Snow / Refuse / Maintenance Zones | various | Operational layers, no parking regulation. |
| Curb Zone Policy tbl (layer 3, 133,855) + Curb Policy tbl (layer 2, 734) | `Curb_Management_Data/FeatureServer/2,3` | Same data as layer 0 in normalised form. Layer 0 is already denormalised so we read it directly. |

## Final pipeline (post-sprint)

```
arlington-opendata    → 8,157 segments + 251 metered points    (UNKNOWN baseline + meter overlay)
arlington-permit      → 1,308 segments matched ← 1,350 RPP lines (verified permit)
arlington-curb (NEW)  → up to ~60,000 lines snapped per sync    (verified allowed / no_parking / loading / time_limited / metered / permit / standing)
```

The curb-overlay RPC `apply_curb_zone_polyline_overlay` snaps each polyline
to its nearest street_segment within 15 m, requires partial street-name
match, and is chunked at 4,000 lines per call to stay under the 180s
statement timeout. Up to 60,000 curb-zone lines are processed per sync run
(MAX_LINES); a follow-up run extends coverage further.

## How to run

```
GET /api/public/admin/sync-arlington?wait=1
```

The response now reports three providers; the `arlington-curb` entry shows
`features_fetched`, `lines_input/parsed`, `candidate_pairs`,
`matched_segments`, `rows_updated`, and the timeout stage. The
`/admin/arlington-coverage` dashboard re-aggregates per neighborhood
after the sync.

## LA vs Arlington (expected after first full curb-overlay sync)

| Metric | Los Angeles (verified) | Arlington (verified, post-sprint) |
|---|---:|---:|
| Total segments | ~430,000 | ~8,157 |
| Metered | LADOT meters | meters + curb-overlay `parking` rows with rate>0 |
| Permit | WeHo + LADOT preferential | RPP polylines + curb-overlay `user_classes=permit` |
| Street cleaning | LADOT sweeping schedule | **0** (Arlington publishes no schedule) |
| No parking | LADOT signs + WeHo overlay | curb-overlay `activity=no parking` |
| Tow-away | LADOT tow-away signs | **0** (only PDFs upstream) |
| Loading | LADOT loading zones | curb-overlay `activity=loading`/`standing` |
| Time-limited | LADOT signs | curb-overlay `parking + max_stay` |
| Allowed (green) | LADOT verified parking | curb-overlay `activity=parking, standard` |
| Unknown % | varies by zone, ~10–40% | depends on curb-zone coverage in bbox; expected drop from 100% to **near LA range** in covered areas |

## Philosophy reminder

> "The engine never invents legality. Unknown remains Unknown until
> supported by data or sign scanning."

Every rule the `arlington-curb` provider emits comes from a single,
attributable Arlington County DES curb-zone row. Anything Arlington has
not published (sweeping schedules, dynamic tow-aways) continues to render
as gray UNKNOWN.
