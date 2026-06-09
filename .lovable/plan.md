# Data Completeness Sprint — Plan

No new consumer-facing features. Every change is plumbing, providers, or admin-only dashboards.

## P1 — Seattle Restriction Layering

Today the `SeattleBlockfaceProvider` writes exactly one rule per blockface from `PARKING_CATEGORY`. To get to 3–5 rules/segment we layer additional SDOT datasets and write them as additional `parking_rules` rows attached to the **same** `street_segments` (matched by spatial proximity to the blockface centerline).

New providers (additive, each in its own `*.server.ts`):

1. `SeattleSignpostsProvider` — SDOT Signposts FeatureService (point dataset of every posted sign). Parse the sign text into restrictions (no parking, time-limit, tow-away, loading zone) using the existing `sign-ai`/`scan-summary` rule extractor. Snap each sign to the nearest blockface within ~25 m and append rules.
2. `SeattleStreetCleaningProvider` — SDOT Street Sweeping routes. Append `street_cleaning` rules with day-of-week + time windows.
3. `SeattleRpzProvider` — SDOT Restricted Parking Zones (RPZ) polygons. For every blockface intersecting an RPZ polygon, append a `permit` rule with `permit_zone = <zone#>`.
4. `SeattleTemporaryRestrictionsProvider` — SDOT Temporary No-Parking permits. Append rules with `effective_from`/`effective_to` set so the engine auto-expires them.

Sync orchestration:

- New `syncCityAllProviders(citySlug, bbox)` server fn that runs every provider registered for the city in series and **appends** rules instead of replacing the whole rule set (current `syncProvider` deletes-then-inserts — change it to delete only rules whose `data_source` matches the provider being synced, by adding a `data_source` column to `parking_rules`).
- `registry.server.ts` returns an array of providers per city (not single).

Schema migration:

- `ALTER TABLE parking_rules ADD COLUMN data_source TEXT;` + index on `(street_segment_id, data_source)`.

## P2 — LA Coverage Expansion

Today `SantaMonicaProvider`, `PasadenaProvider`, `WestHollywoodProvider` exist but have **0 segments synced** because nobody has triggered a sync for their bboxes. Two fixes:

1. **Trigger initial sync.** Extend the admin LA sync endpoint (`/api/public/admin/sync-la`) to call `syncProvider` for each of `santa-monica`, `pasadena`, `west-hollywood` using each city's full bbox (computed from the existing `cities.center` + a sensible radius per city). Also enroll them in the same daily provider re-sync that LADOT uses.
2. **Add real datasets** beyond street sweeping where they exist:
   - Santa Monica: Preferential Parking Zones (permit polygons), Metered Parking inventory.
   - Pasadena: Preferential Parking Districts, Metered Zones.
   - West Hollywood: Permit Parking Districts (already partially wired), Time-Limited Zones.

Each new dataset goes into the same `*.server.ts` provider as additional `fetchSegments` calls; rules are appended to the same blockfaces.

## P3 — Occupancy Verification

Cron already runs `/api/public/cron/sync-la-occupancy` every 5 minutes. Add:

- `getOccupancyHealth()` server fn returning `{ rowCount, freshestEventAgeMin, last5RunDurations, last5RunErrors }` from `la_meter_occupancy` + `sync_logs`.
- New `/api/public/cron/health-check` endpoint that:
  - Asserts `freshestAgeMin < 15`
  - Asserts `rowCount > 0`
  - Inserts a `usage_events` row tagged `provider_health` on failure for alerting.
- Surface freshness in the existing `/admin/accuracy` dashboard (already partially present; add per-cron last-run + error rate).

## P4 — Scanner Validation QA

Programmatic test harness, NOT a UI feature.

- New server fn `runScannerSelfTest()` that submits 5 synthetic scans per city:
  - inside a known segment (expect `matched`)
  - 10 m off a segment with conflicting OCR text (expect `conflict`)
  - 5 km from any segment (expect `out_of_range`)
  - no GPS provided (expect `no_gps`)
  - inside a segment with no posted rule (expect `unmatched`)
- Persist results to `scan_validation_results` tagged `source = 'self_test'`.
- Surface pass/fail matrix on `/admin/accuracy` ("Scanner QA" card per city).

## P5 — Accuracy Dashboard Expansion

Extend `getAccuracyReport()` and `/admin/accuracy` to add:

- **Rule depth histogram per city** (1/2/3/4/5+ rules per segment).
- **Provider completeness matrix** — rows = providers, columns = (segments synced, rules contributed, last run, last error).
- **Occupancy panel** — rowCount, freshness, last 5 cron run durations.
- **Scanner QA panel** — pass/fail matrix from P4.
- **Multi-rule coverage** — % of segments with ≥2 overlapping rules per city (target ≥80% Seattle, ≥50% LA).

## Technical Details

Files added:

- `src/lib/parking/providers/seattle-signposts.server.ts`
- `src/lib/parking/providers/seattle-street-cleaning.server.ts`
- `src/lib/parking/providers/seattle-rpz.server.ts`
- `src/lib/parking/providers/seattle-temp-restrictions.server.ts`
- `src/lib/parking/scanner-self-test.functions.ts`
- `src/routes/api/public/cron.health-check.ts`

Files changed:

- `src/lib/parking/providers/registry.server.ts` — return `ParkingProvider[]` per city.
- `src/lib/parking/parking.functions.ts` — `syncProvider` becomes provider-scoped rule replace (uses new `data_source` column); add `syncCityAllProviders`.
- `src/lib/parking/providers/santa-monica.server.ts`, `pasadena.server.ts`, `west-hollywood.server.ts` — add permit/meter datasets.
- `src/routes/api/public/admin.sync-la.ts` — sync all 4 LA cities, not just LADOT.
- `src/lib/parking/accuracy.functions.ts` + `src/routes/admin.accuracy.tsx` — new panels (rule depth, provider matrix, scanner QA, occupancy panel).
- `supabase` migration: add `parking_rules.data_source TEXT` + index.

## Out of Scope

- No new end-user UI.
- No changes to the parking decision engine ranking logic itself.
- No mobile / CarPlay work.
- ML-based predictive availability (Phase 5+).

## Success Criteria

- Seattle `rulesPerSegment` ≥ 3 average; `twoPlusRuleSegments / segments` ≥ 0.8.
- Santa Monica, Pasadena, West Hollywood each have ≥ 500 segments and ≥ 1 rule/segment.
- Occupancy cron health-check green; freshness < 15 min.
- Scanner self-test produces ≥ 1 example of each verdict (`matched`, `conflict`, `unmatched`, `out_of_range`, `no_gps`) per city.
- Accuracy dashboard shows all five new panels with live data.
