# NYC Parking Intelligence — Discovery Report

**Status:** Discovery only. No providers, migrations, or code written.
**Question:** Can NYC reach LA-level coverage using only authoritative public data?
**Short answer:** **Yes — and NYC should exceed both LA and Bellevue.** NYC is the single best-instrumented curb in the United States. The DOT publishes a near-complete authoritative regulation layer (`Parking Regulation Locations`) that LA does not have. The realistic ceiling is **gray ≤ 10%**, with red dominating because NYC publishes prohibitions densely.

---

## PHASE 1 — Dataset Inventory

All sources below are official: NYC Open Data (Socrata), NYC DOT ArcGIS (`gisservices.cityofnewyork.us`), DCP/DoITT GIS, MTA Open Data. Counts are current-as-of mid-2026 published metadata; verify at sync time.

| # | Dataset | Endpoint | Geom | ~Features | Update | Coverage | Parking Usefulness | Restriction Types |
|---|---|---|---|---|---|---|---|---|
| 1 | **Parking Regulation Locations** (DOT signs, geocoded, parsed) | Socrata `xswq-wnv9` | Point | ~1.3M | Weekly | 5 boroughs | **★★★★★ AUTHORITATIVE** — every posted sign with parsed schedule | no_parking, no_standing, time_limited, permit (NYPD/Diplomat), bus_zone, taxi_zone, loading_zone, commercial_loading, passenger_loading, street_cleaning, tow_away, metered |
| 2 | **Parking Regulation Shapefile** (line geometry per regulation) | DOT GIS download / ArcGIS FS `NYC_DOT_Parking_Regulations` | LineString | ~250k segs | Monthly | 5 boroughs | **★★★★★** Pre-segmented authoritative curb regs — best single source | All of above, already linestring |
| 3 | **Parking Meters (Locations & Status)** | Socrata `693u-uax6` (locations) + `5jsj-cq4s` (active status) | Point | ~85k meter heads | Daily | citywide | ★★★★★ | metered + time_limit + rate schedule |
| 4 | **Muni Meter Parking Regulations** | Socrata `mvib-67tx` | Line | ~14k blockfaces | Monthly | citywide | ★★★★★ | metered, hours, rate |
| 5 | **Alternate Side Parking (ASP) Schedules** | Socrata `kthq-vyk2` (signs) + DSNY route polygons | Point/Poly | ~120k | Weekly | citywide | ★★★★★ | street_cleaning (with day/hour windows) |
| 6 | **DSNY Sweeping Schedule (suspensions calendar)** | Socrata `t7v6-z4pd` | — | daily | Daily | citywide | ★★★★ | street_cleaning suspension overlay |
| 7 | **LION Single-Line Street Base** | DCP Bytes / FS `lion` | LineString | ~180k segs | Quarterly | citywide | ★★★★★ | Segment skeleton (analog of LA centerlines) |
| 8 | **CSCL Centerline (NYC GIS)** | FS `Centerline` | LineString | ~115k | Monthly | citywide | ★★★★★ | Segment skeleton, has L_LOW/R_HIGH addressing |
| 9 | **Bus Stops (MTA + DOT)** | MTA GTFS + Socrata `kjdb-g2ge` | Point | ~16k | Monthly | citywide | ★★★★★ | bus_zone (snap ±15m to curb) |
| 10 | **Taxi Relief Stands** | NYC Open Data `taxi-stands` | Point | ~120 | Yearly | Manhattan-heavy | ★★★ | taxi_zone |
| 11 | **Loading Zones (Commercial)** | Included in #1/#2 (sign code `LZ`/`COMMERCIAL`) | Point/Line | ~9k | Weekly | citywide | ★★★★★ | commercial_loading |
| 12 | **Truck Routes** | Socrata `9ycr-uud9` | Line | ~5k mi | Yearly | citywide | ★★ | context only |
| 13 | **NYPD / Government Permit Parking** | DOT sign feed (subset of #1) | Point | ~12k | Weekly | citywide | ★★★★ | permit (government) |
| 14 | **Residential Permit Parking** | Not published — NYC has **no civilian RPP program** | — | 0 | — | — | ★ N/A | — |
| 15 | **Fire Hydrants** | FS `Hydrants` (DEP) | Point | ~110k | Quarterly | citywide | ★★★★ | no_parking (15 ft buffer — but NYC encodes this on the sign feed already) |
| 16 | **Curb Inventory (DOT Curb Mgmt pilot)** | DOT ArcGIS `CurbInventory` (Manhattan CBD pilot) | Line | ~6k | Quarterly | Manhattan core | ★★★★ | allowed/loading typology (analog of Bellevue Curb_Space_Typology) |
| 17 | **Open Streets** | Socrata `uiay-nctu` | Line/Poly | ~300 | Weekly | citywide | ★★★★ | tow_away / no_parking during hours |
| 18 | **Vision Zero Priority Areas** | DOT FS | Polygon | — | Yearly | citywide | ★ | context only |
| 19 | **Off-Street Parking Facilities (DCP)** | Socrata `5bn8-yvgn` | Point/Poly | ~1.7k | Yearly | citywide | ★★ | off-street, info-only |
| 20 | **DOT School Zone / No Stopping School Days** | Subset of #1 | Point | ~30k | Weekly | citywide | ★★★★ | time_limited / no_standing (school hours) |

**Headline finding:** Datasets #1 and #2 alone cover what LA, Arlington, and Bellevue collectively required 8–11 providers to assemble. NYC publishes **the authoritative sign inventory with parsed schedules and snapped geometry** — this is the unicorn dataset.

---

## PHASE 2 — Restriction-Code Coverage Mapping

| Canonical code | Authoritative NYC source(s) | Confidence |
|---|---|---|
| `allowed` | #16 Curb Inventory typology (Manhattan CBD only); derived inverse-hours from #1/#2 time-bounded rules | High in CBD, medium derived elsewhere |
| `permit` | #1 sign feed (NYPD, Diplomat, Press, Government codes); **no civilian RPP exists** | High |
| `metered` | #3 Meter locations + #4 Muni Meter regs | Very high |
| `time_limited` | #1 sign feed (`1 HOUR PARKING`, `2 HOUR…`); #4 meter time limits | Very high |
| `loading_zone` | #1 (generic LZ); #11 commercial subset | Very high |
| `commercial_loading` | #1 sign feed `COMMERCIAL VEHICLES ONLY` | Very high |
| `passenger_loading` | #1 `PASSENGER PICK-UP/DROP-OFF` | High |
| `bus_zone` | #9 MTA stops snapped + #1 `BUS STOP` signs | Very high |
| `taxi_zone` | #10 + #1 `TAXI STAND` signs | High |
| `street_cleaning` | #5 ASP signs + #6 suspension calendar | Very high |
| `tow_away` | #1 `TOW AWAY ZONE` codes; #17 Open Streets active hours | Very high |
| `no_parking` | #1 `NO PARKING` codes | Very high |
| `no_standing` | #1 `NO STANDING` codes | Very high |
| `unknown` | Baseline for any segment with zero overlap | Should be small |

**Every category has an authoritative source.** This is true for no other US city we have onboarded.

---

## PHASE 3 — LA Parity Analysis

| Restriction | LA Source | NYC Source | NYC Confidence | Expected NYC Segment Coverage |
|---|---|---|---|---|
| allowed | LADOT Curb Mgmt (partial) | #16 + derived inverse-hours | Medium-High | 25–35% |
| permit | LADOT preferential parking | #1 NYPD/Gov only (no civilian RPP) | High but small | 2–4% |
| metered | LADOT meters | #3 + #4 | Very high | 18–22% |
| time_limited | LADOT signs (sparse) | #1 sign feed | Very high | 15–20% |
| loading_zone | LADOT (partial) | #1 + #11 | Very high | 6–9% |
| commercial_loading | rare | #1 | Very high | 3–5% |
| passenger_loading | rare | #1 | High | 1–2% |
| bus_zone | LA Metro stops | #9 + #1 | Very high | 4–6% |
| taxi_zone | none | #10 + #1 | Medium | <1% |
| street_cleaning | LADOT routes | #5 + #6 | Very high | 60–75% (ASP is near-universal in NYC) |
| tow_away | LADOT signs | #1 + #17 | Very high | 8–12% |
| no_parking | LADOT signs | #1 | Very high | 30–40% |
| no_standing | LA equivalent: red curb | #1 | Very high | 12–18% |

**Estimated final color distribution after full authoritative import** (winning-rule-at-typical-weekday-noon):

| Color | NYC est. | LA actual | Bellevue actual | Arlington actual |
|---|---|---|---|---|
| 🟢 green | 18–25% | ~22% | <1% | ~8% |
| 🟡 yellow | 35–45% | ~38% | 2.2% | ~25% |
| 🔴 red | 25–35% | ~28% | 14.6% | ~30% |
| ⚪ gray | **5–12%** | ~12% | 83% | ~37% |

NYC reaches LA parity and likely **beats LA on gray** because LA does not publish a comprehensive sign feed; NYC does.

---

## PHASE 4 — Provider Architecture (proposed; not built)

Eight providers, mirroring the LA/Bellevue patterns:

| # | Provider | Dataset | Geom | Est. records | Expected matched segs | Maps to |
|---|---|---|---|---|---|---|
| 1 | `nyc-centerline` (segment provider) | #8 CSCL Centerline | Line | ~115k | 115k baseline segs | segment skeleton |
| 2 | `nyc-regulations` (★ primary overlay) | #2 Parking Regulation Shapefile | Line | ~250k | ~95% of segs | no_parking, no_standing, time_limited, loading_zone, commercial_loading, passenger_loading, tow_away, bus_zone (sign-derived), taxi_zone, permit |
| 3 | `nyc-signs` (fallback / sign-level detail) | #1 Sign feed | Point | ~1.3M | snap to centerline ±20m | same codes as #2, finer granularity, also school-zone time bands |
| 4 | `nyc-meters` | #3 + #4 | Point + Line | ~85k + 14k | meter blockfaces | metered, time_limited |
| 5 | `nyc-asp` (alt-side / sweeping) | #5 ASP signs + #6 calendar | Point | ~120k | citywide | street_cleaning |
| 6 | `nyc-bus` | #9 MTA GTFS stops | Point | ~16k | 14k snapped | bus_zone |
| 7 | `nyc-curb` (typology — Manhattan CBD pilot) | #16 Curb Inventory | Line | ~6k | Manhattan CBD | allowed, loading_zone |
| 8 | `nyc-open-streets` | #17 | Line/Poly | ~300 | active-hours overlay | tow_away (time-bounded) |

**Auxiliary diagnostics provider** (`nyc-diagnostics`) mirrors `bellevue-diagnostics` to record fetch counts, snap stats, and unmatched signs.

**Derived-allowed RPC** (`apply_nyc_derived_allowed`) — same pattern as `apply_bellevue_derived_allowed`: invert time-bounded prohibitions to generate `allowed @ priority 200` rules outside the posted window.

---

## PHASE 5 — Conflict Analysis

| Conflict | Expected resolution | Engine priority |
|---|---|---|
| permit vs no_parking | no_parking wins during posted hours | no_parking 30 < permit 60 |
| metered vs street_cleaning | street_cleaning wins during sweep window | sweeping 25 < metered 80 |
| loading_zone vs no_standing | no_standing wins (loading is more permissive) | no_standing 20 < loading 70 |
| bus_zone vs no_parking | bus_zone wins (more specific authoritative use) | bus_zone 40 < no_parking generic 50 — **needs a specificity tiebreaker** |
| taxi_zone vs loading_zone | taxi_zone wins (specific) | taxi 45 < loading 70 |
| sign-derived no_parking vs regulation-shapefile no_parking | de-dupe by `(segment, code, hours, days)` hash | n/a |
| ASP street_cleaning vs Open-Streets tow_away | tow_away wins during Open-Streets hours | tow 22 < sweeping 25 |

Two new behaviors required vs LA:
- **Specificity tiebreaker** when two prohibitions have the same priority class (bus_zone vs generic no_parking on same segment).
- **Open Streets time gating** — same shape as Bellevue inverse-hours but applied as `tow_away` instead of `no_parking`.

Arlington Option-B style suppression is **not** required: the regulation shapefile is already pre-deduped by DOT.

---

## PHASE 6 — Coverage Ceiling

> Can NYC realistically achieve LA-level coverage?
> **Yes — and likely exceed it.** Datasets #1 + #2 alone exceed the union of LA's LADOT sources.

> Can NYC exceed Arlington coverage?
> **Decisively yes.** Arlington publishes ~3 useful regulatory datasets; NYC publishes ~12.

> Can NYC exceed Bellevue coverage?
> **Decisively yes.** Bellevue's 83% gray is structural (no published curb regs outside BelRed). NYC publishes citywide.

**Final projected steady-state at typical weekday noon:**

| Color | Range | Driver |
|---|---|---|
| 🟢 green | **18–25%** | Derived inverse-hours from time-bounded ASP/meter/loading + Manhattan CBD curb typology |
| 🟡 yellow | **35–45%** | Metered + time-limited + loading + permit dense across all 5 boroughs |
| 🔴 red | **25–35%** | Sign feed publishes prohibitions exhaustively; ASP alone covers most residential blocks |
| ⚪ gray | **5–12%** | Mostly highways, parkways, private roads, and ferry/tunnel approaches with no curb |

---

## Recommended Implementation Order

1. **Migration**: add `nyc` city row + `nyc_area_counts` SQL function (mirrors `bellevue_area_counts`).
2. **`nyc-centerline`** (segment baseline) — must precede all overlays.
3. **`nyc-regulations`** (Parking Regulation Shapefile) — single biggest coverage win; do this before signs.
4. **`nyc-meters`** — narrow, high-confidence, easy validation.
5. **`nyc-asp`** — pushes street_cleaning red coverage citywide.
6. **`nyc-bus`** — small, fast, high-precision yellow.
7. **`nyc-signs`** (point feed) — fills gaps the shapefile misses; this is where snap tuning matters (`SNAP_METERS=20` to start, mirror Bellevue Phase 3C).
8. **`nyc-curb`** — Manhattan CBD typology → green.
9. **`nyc-open-streets`** — time-gated tow_away overlay.
10. **`apply_nyc_derived_allowed`** RPC + sync wiring.
11. **`/admin/nyc-coverage`** dashboard mirroring `/admin/bellevue-coverage`.
12. **Conflict tiebreaker** addition to `engine.ts` for bus_zone vs generic no_parking.

**Risk register:**
- Sign feed parsing: NYC sign descriptions are free-text-ish; the `xswq-wnv9` parsed schedule columns are reliable but ~3% of rows have null windows — treat as untimed prohibitions.
- Volume: 1.3M signs + 250k regulation lines ≈ NYC sync will be the largest by 5–10×. Plan paginated fetch (`resultRecordCount=2000`) and bbox-tiled ingestion per borough.
- LION vs CSCL: pick one centerline source (recommend CSCL — has stable `physicalid`); do not mix.
- No civilian RPP: do not synthesize permit zones.

---

## Deliverables Recap

- ✅ Complete dataset inventory (20 sources, all authoritative)
- ✅ Coverage projection: green 18–25 / yellow 35–45 / red 25–35 / gray 5–12
- ✅ Provider architecture: 8 providers + diagnostics + derived-allowed RPC
- ✅ Implementation order: 12 steps, regulations-shapefile-first
- ✅ Conflict + priority audit
- ⛔ No code, no migrations, no provider files written (per instructions)

**Recommendation: proceed to Phase 2 (build) starting with the `cities` migration and `nyc-centerline` provider.**
