# Bellevue RPZ Layer-98 Coverage Audit

## Question
Should `bellevue-rpz` migrate from `TIMS_Reference / MapServer / 10`
(16 zone polygons) to `Enterprise_Transportation / MapServer / 98`
(984 sub-polygons)?

## Findings

| Property | Layer 10 (current) | Layer 98 (candidate) |
|---|---|---|
| Endpoint | `TIMS_Reference/MapServer/10` | `Enterprise_Transportation/MapServer/98` |
| Polygon count | 16 | 984 |
| Distinct RPZ_IDs | 16 | 16 (RPZ_IDs 1–18 minus 5/12/13/17) |
| `RPZ_Type` field | – | `Regular` / `Temporary` |
| `CODENO` (zone label) | yes | – |
| Coverage shape | one polygon per zone (entire neighborhood) | one polygon per block / sub-region |
| Permit hours | – | – (hours only on Layer 97 polylines) |
| Geometry CRS | EPSG:4326 | EPSG:4326 |

Both layers carry the same logical zoning (RPZ_ID 1..18 minus a few
unassigned IDs). Layer 98 is the same data subdivided into smaller
polygons — no new zones, no new attributes beyond `RPZ_Type`.

## Coverage impact

`bellevue-rpz` (Layer 10) currently produces **166 permit rules**, one
per Bellevue street_segment whose centroid intersects an RPZ polygon.

Layer 10's 16 polygons fully envelop their RPZ neighborhoods; every
street segment that lies inside Bellevue's published residential permit
zones is already matched. Switching to Layer 98 cannot increase the
number of matched segments because:

1. Layer 98 polygons are STRICT SUBSETS of the equivalent Layer 10
   polygon (same RPZ_ID, smaller geometry).
2. Any segment that intersects Layer 98 also intersects Layer 10.
3. The reverse is not true — segments inside an RPZ neighborhood that
   are not on a published RPZ block-face DROP OUT under Layer 98.

Net effect: Layer 98 produces the same 166 rules at most, more likely
**fewer** than 166. It would tighten precision (fewer false positives
on non-RPZ blocks inside an RPZ neighborhood) at the cost of recall.

The block-face precision gain that Layer 98 would offer is already
delivered with explicit hours by **Layer 97** (`bellevue-rpz-streets`,
118 polylines with parsed `Restriction` text). Layer 97 is the correct
upgrade for precision; Layer 98 is redundant with Layer 10 + Layer 97.

## Recommendation

**Keep current implementation.** Do NOT migrate `bellevue-rpz` to
Layer 98.

- Layer 10 (16 polygons) → broad zone coverage (166 rules, no hours).
- Layer 97 (118 polylines) → block-face precision with parsed hours.
- Layer 98 (984 polygons) → no incremental coverage; would shrink recall.

Revisit only if Bellevue starts publishing per-block hours / `RPZ_Type`
enforcement schedules on Layer 98. Today it is geometry-only.
