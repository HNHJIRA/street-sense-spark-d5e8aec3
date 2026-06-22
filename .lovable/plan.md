# Production-Grade Sync Strategy

Audit-driven plan. Every recommendation below is grounded in what the upstream actually supports — see the per-provider table.

## 1. Per-provider audit & recommended cadence

Highlights from the audit:
- **Only NYC providers** (Socrata) natively support incremental via `:updated_at`.
- **All ArcGIS providers** (Seattle, LA, Santa Monica, WeHo, Pasadena, Arlington, Bellevue) *could* support incremental via `EditDate`, but it is not currently used. High-value ArcGIS incremental targets: `arlington-curb` (~132k rows), `bellevue-signs` (~19.5k rows).
- **LA occupancy** (`cron.sync-la-occupancy.ts`) is the only real-time feed and already runs every 5 min.
- **Seattle has no admin/cron route at all** — gap to fix.
- `seattle-signposts` has a silent pagination truncation bug (single 2k page, no offset loop).
- `bellevue-curb` has a known upstream CRS registration bug — leave as full-only until fixed.

| Provider | Source | Incremental? | Full cadence | Incremental cadence |
|---|---|---|---|---|
| seattle-blockface | ArcGIS | EditDate (add) | Weekly | — |
| seattle-signposts | ArcGIS | EditDate (add) | Weekly (after pagination fix) | — |
| seattle-rpz | ArcGIS | — | Monthly | — |
| ladot | ArcGIS | EditDate (add) | **6h** | — (occupancy already 5m) |
| santa-monica-* | ArcGIS | — | **6h** (sm), Monthly (permit/meters static) | — |
| west-hollywood + permit | ArcGIS | — | **6h** (sweep), Monthly (permit) | — |
| pasadena | ArcGIS | — | **6h** | — |
| arlington (centerlines + meters) | ArcGIS | EditDate (add) | **12h** | — |
| arlington-permit | ArcGIS | — | **12h** | — |
| **arlington-curb** | ArcGIS | EditDate (add) | **12h** | **30m** (Phase 2) |
| bellevue (centerlines + 5 static overlays) | ArcGIS | — | **12h** | — |
| **bellevue-signs** | ArcGIS | EditDate (add) | **12h** | **30m** (Phase 2) |
| bellevue-curb | ArcGIS | blocked (CRS bug) | **12h** | — |
| **nyc-centerline** | Socrata | `:updated_at` ✅ | **6h** | **30m** |
| **nyc-signs** | Socrata | `:updated_at` ✅ | **6h** | **30m** |

The user-requested cadences (LA 6h+30m, NYC 6h+30m, Arlington 12h, Bellevue 12h) are honored. Seattle is added at weekly/monthly because the user did not specify it but the providers are wired.

## 2. Architecture

### Sync orchestrator (new)

`src/lib/parking/sync-orchestrator.server.ts`:
- `runSync({ citySlug, providerId?, mode: "full" | "incremental", trigger: "cron" | "manual" })`
- **Acquires a Postgres advisory lock** on `(city_slug, provider_id, mode)` — duplicate runs return `{ status: "already_running" }` immediately.
- Writes a row to `sync_logs` at start (status=`running`) and updates it on completion.
- Updates `provider_health` with last_started/completed/duration/imported/skipped/error.
- For `mode: "incremental"`, passes `since: provider_health.last_success_at` to the provider; provider chooses whether to honor it.

### Provider contract extension

In `src/lib/parking/providers/types.ts`, extend `ParkingProvider` / `OverlayProvider`:
```ts
fetchSegments(citySlug, bbox, opts?: { since?: Date }): Promise<...>
supportsIncremental?: boolean   // declarative capability
```
NYC providers and (Phase 2) `arlington-curb` + `bellevue-signs` set `supportsIncremental = true` and add `:updated_at` / `EditDate` to their `where` / `$where` clauses when `since` is passed. All other providers ignore `since` and run full — orchestrator transparently degrades incremental → full when unsupported.

### Cron routes (new)

Under `src/routes/api/public/cron/`:
- `cron.sync-la-full.ts` — every 6h, full sync for los-angeles + santa-monica + west-hollywood + pasadena.
- `cron.sync-la-incremental.ts` — every 30m, incremental (degrades to full where unsupported, so effectively a no-op for static LA-region overlays — see Phase 2).
- `cron.sync-nyc-full.ts` — every 6h, full sync.
- `cron.sync-nyc-incremental.ts` — every 30m, Socrata `:updated_at` delta.
- `cron.sync-arlington.ts` — every 12h, full.
- `cron.sync-bellevue.ts` — every 12h, full.
- `cron.sync-seattle.ts` — weekly (Sundays 04:00 UTC), full.

All routes go through the orchestrator → automatic locking, logging, health updates. They authenticate via the documented `apikey: <anon-key>` pattern.

### pg_cron schedule

Inserted via `supabase--insert` (data, not schema):
```
la-full          0 */6 * * *
la-incremental   */30 * * * *
nyc-full         15 */6 * * *     -- offset to spread load
nyc-incremental  */30 * * * *
arlington        0 */12 * * *
bellevue         30 */12 * * *
seattle          0 4 * * 0
la-occupancy     */5 * * * *      -- already exists, unchanged
health-check     */15 * * * *     -- already exists, unchanged
```

### Smart refresh (map reads)

Already correct — `getSegmentDetails` and the map queries read only from PostGIS. **Add a guard**: orchestrator is the only call site for `syncAllProvidersForCity` from production paths; map / session / scan code must never trigger it. Add an ESLint rule or a lint comment + a runtime assertion that throws if called outside an orchestrator/admin/cron path.

### Sync locking

Postgres advisory lock keyed by hash of `city_slug:provider_id:mode`:
```sql
SELECT pg_try_advisory_lock(hashtext($1));
```
If `false`, orchestrator returns `{ status: "already_running", message: "Sync already in progress" }` with HTTP 409 from the cron/admin route. Lock is released in `finally`.

### Monitoring schema

Extend `provider_health` (migration) with the fields the user requested:
- `last_sync_started_at timestamptz`
- `last_sync_completed_at timestamptz`
- `records_imported int`
- `records_skipped int`
- `duration_ms int`
- `provider_status text` (`healthy` | `warning` | `failed` | `running`)
- `provider_error text`
- `next_scheduled_at timestamptz` (computed from cron schedule)
- `supports_incremental boolean`
- `last_incremental_at timestamptz`

`sync_logs` already has most of this — keep it as the historical run log; `provider_health` is the current-state row.

### Freshness Dashboard

New tab in `src/routes/admin.provider-sync.tsx` (or a sibling route `admin.freshness.tsx`):
- Table: provider, last successful sync, next scheduled sync, records imported (last run), supports_incremental?, status badge (Healthy/Warning/Failed).
- Status thresholds: Healthy if last_success within 2× expected cadence, Warning within 4×, Failed beyond.
- Existing manual sync buttons stay; add per-provider and per-borough/neighborhood buttons that call the orchestrator with `providerId` / `providerParams`.

### Manual sync buttons

Existing admin buttons get rewired through the orchestrator (so they share locking + logging). UI gains:
- Full city sync (existing).
- Per-provider sync (new dropdown).
- Per-borough sync for NYC (existing `?boroughs=` param surfaced as UI).

### Future real-time mode

The orchestrator's provider contract (`fetchSegments(..., { since })` + `supportsIncremental`) is the seam:
- **Webhook**: an external service POSTs to a new `/api/public/hooks/sync-<city>` route that calls `runSync({ mode: "incremental", since: webhookPayload.cursor })`. No core changes.
- **CDC**: a polling worker can call the same orchestrator at any cadence — 5 min, 1 min — with no contract changes; locking prevents pile-ups.
- **Per-provider real-time opt-in**: providers declare `realtimeCapable = true` and the orchestrator picks them up for higher-frequency runs.

## 3. Implementation phases

**Phase 1 — Framework (this PR):**
1. Migration: extend `provider_health` columns.
2. New `sync-orchestrator.server.ts` with advisory locking + logging.
3. Extend provider types with `since` + `supportsIncremental` (default false everywhere — no behavior change).
4. New cron routes wired through the orchestrator.
5. New `admin.sync-seattle.ts` to close the gap.
6. pg_cron schedule via `supabase--insert`.
7. Freshness dashboard route + rewire existing admin buttons through the orchestrator.

**Phase 2 — Incremental adapters (follow-up PR per provider):**
1. `nyc-centerline` and `nyc-signs`: add `:updated_at` to `$where` when `since` is passed; flip `supportsIncremental = true`.
2. `arlington-curb`: add `EditDate` filter.
3. `bellevue-signs`: add `EditDate` filter.
4. Fix `seattle-signposts` pagination bug while we're in there.

Splitting these prevents one risky provider change from blocking the framework. Phase 1 alone already gives the user the requested schedule, locking, monitoring, and dashboard — incremental mode just degrades to full on the providers that haven't been adapted yet.

## 4. Out of scope (call out for the user)

- `bellevue-curb` CRS bug — upstream issue, ticket Bellevue.
- Switching LA occupancy off its current 5-min cadence (it's already correct).
- Real webhook/CDC integrations — only the architectural seam is delivered.
