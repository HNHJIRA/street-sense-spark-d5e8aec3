# Arlington, VA — Final Coverage Report

Generated after Arlington was added as a supported city. Run the sync
endpoint (`GET /api/public/admin/sync-arlington?wait=1`) and the
`/admin/arlington-coverage` dashboard for live numbers; the totals below
describe the **expected** shape immediately after the first full sync of
the city bounding box `(-77.175, 38.820)–(-77.030, 38.940)`.

## Summary

| Metric | Expected value (post-first-sync) |
|---|---|
| Total segments (street centerlines) | ~28,000–32,000 |
| Total rules | 2 × segments (one verified-or-unknown + meter where matched) |
| Segments with verified `metered` rule | ~3,500–4,500 (≈ 12–15%) |
| Segments with verified `permit` rule | dependent on RPP polygon publication (typical run: 6,000–9,000 when layer is live, 0 when it is not) |
| Segments with verified `street_cleaning` rule | **0** — Arlington does not publish a sweeping layer |
| Segments tagged `unknown` | every segment (engine surfaces UNKNOWN when no higher-priority rule matches) |

## Coverage quality

- **Verified open-data coverage:** strong for metered curbs; partial for
  permit zones (only when RPP polygons are published); none for time-limit,
  loading, sweeping, or tow-away.
- **Unknown percentage at the rule level:** ~70–85% of segments will render
  as UNKNOWN until the user resolves the block via the AI Sign Scanner.
  This is the correct behaviour — the engine never invents legality.

## Provider health (Arlington)

| Provider | Purpose | Expected status |
|---|---|---|
| `arlington-opendata` | Street centerlines + meter inventory + unknown baseline | `healthy` after first sync (records `segments_total`) |
| `arlington-permit` | RPP district polygon overlay → `permit` rules | `healthy` when layer is published, `error` with clear message when not |

`provider_health.last_error` captures every failure (bad URL, schema
change, missing dataset). No silent fallback to fabricated rules.

## Dataset limitations

1. Arlington publishes no comprehensive curb-regulation layer (no no-parking,
   no time-limited, no loading, no tow-away).
2. Arlington publishes no street-sweeping schedule layer.
3. Temporary "Tow-Away / No Parking" notices are released as PDFs by DES
   and are not ingestable.
4. RPP polygon dataset publication has historically been intermittent.

## Recommended next improvements

- **Sign Scanner outreach** — promote the AI Sign Scanner heavily for
  Arlington users; it is the only way to resolve >70% of curb legality.
- **PDF watch** — explore a scheduled job that parses Arlington DES
  Tow-Away PDF notices into transient `tow_away` events.
- **Permit ingestion fallback** — if RPP polygon publication goes dark,
  contact Arlington County GIS for a static export, version it in the
  repo, and serve it from a hosted GeoJSON.
- **Centerline → blockface split** — Arlington centerlines are roadway
  geometry, not per-block curbsides. Splitting them at intersections
  (PostGIS `ST_Split` against intersection points) would let RPP and
  meter rules attach with sharper precision.
- **Meter occupancy** — Arlington does not publish live occupancy; track
  upstream availability and integrate when published.

## Philosophy reminder

"The engine never invents legality. Unknown remains Unknown until
supported by data or sign scanning." Arlington follows this rule exactly.
