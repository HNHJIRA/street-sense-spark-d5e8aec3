
# ParkClear Core Completion — Phased Plan

Everything below is **additive**. Seattle provider, rules, forecast, sessions, alerts, and Can-I-Park path stay byte-identical. All decisions continue to flow through `evaluateRulesAt()` — no second engine.

This is a large build. To keep each step shippable and reviewable, I'll deliver it in **4 phases**, pausing after each so you can verify before I continue.

---

## Phase 1 — Decision Core + AI Driver Summary + Timeline/Countdown
Covers **Feature 1 (Advanced Can I Park Here)**, **Feature 4 (Manual Test Mode)**, **Feature 7 (Confidence System)** wiring.

- **New shared module** `src/lib/parking/decision.ts` (pure): given `(segment, restrictionTypes, when, timezone)` produces a `ParkingDecision`:
  - `verdict`: YES | NO | LIMITED | UNKNOWN
  - `status` (existing `evaluateRulesAt` output)
  - `nextRestriction` (scans next 24h of rules+events for the next color change)
  - `timeline` (NOW + up to 6 boundary entries in next 24h)
  - `timeRemainingMs` (until next boundary)
  - `confidence` (reuses `confidence.ts` scoring; surfaces high/medium/low)
- **New component** `src/components/ParkDecisionScreen.tsx`:
  - Status banner (verdict, reason, allowed-until)
  - Live countdown (ticks every 1s when YES/LIMITED)
  - Next Restriction card (label + starts-at + time-until)
  - Parking Timeline (vertical list, NOW marker)
  - Confidence badge
  - **AI Driver Summary** section
  - Street name, data source, permit, max stay
- **AI summary** `src/lib/parking/driver-summary.functions.ts` (new `createServerFn`, Lovable AI Gateway, `google/gemini-3-flash-preview`):
  - Input: structured `ParkingDecision` + segment meta (NOT raw OCR / provider text)
  - Output: `{ summary: string }` via `Output.object` schema
  - Cached client-side via React Query keyed on `(segmentId, rounded-15min when, verdict)`
- **ParkHereButton rewrite** to render `ParkDecisionScreen` as its result view; reuses existing GPS + tap (`pendingCheckSegmentId`) wiring already in place.
- **StreetSheet "Can I park here?"** already triggers manual mode — it will now open the full decision screen.

---

## Phase 2 — Nearest Available + Destination Search + Discovery
Covers **Feature 2**, **Feature 3**, **Feature 9**.

- **Server fn** `findRankedParking({ from, radii: [100,250,500], when, cityId })` in `parking.functions.ts`:
  - Reuses existing `nearest_segments_full` RPC, expands radius until results found
  - Evaluates every candidate via `evaluateRulesAt()` (server-side import of pure engine)
  - Ranks: legality (green>yellow, red excluded) → time-remaining → distance → confidence
  - Returns top N with distance, walking-time (1.33 m/s), decision summary
- **AI recommendation summary** (same gateway fn, different prompt template) — one sentence per top result, batched.
- **`ParkHereButton`** when GPS verdict is NO/UNKNOWN: shows ranked list with "View on map" (drives existing `recommendedHighlight`) and "Navigate" (opens Apple/Google Maps URL).
- **Destination search**: extend `SearchSheet`:
  - On result selection, call `findRankedParking({ from: destCoords })`
  - New `DestinationParkingSheet` shows best spot + alternatives with same card UI
- **Discovery entry point**: small "Where should I park?" CTA on the map overlay → uses current GPS or last map center.

---

## Phase 3 — Sign Scanner Upgrade + Find My Car + Session Auto-fill
Covers **Feature 5**, **Feature 6**, scanner integration into sessions.

- **Sign scanner**: keep existing OCR → `parsed_sign_rules` pipeline. **Add** a synthetic in-memory `StreetSegment` built from parsed rules, run through `evaluateRulesAt()`, then render the same `ParkDecisionScreen` (timeline, countdown, next restriction, AI summary) on the scan result page. OCR remains read-only — engine still decides.
- **Rule Summary card** on scan result: allowed days/hours, max stay, permit, sweeping, tow-away, loading zone — pulled from `parsed_sign_rules` (already structured).
- **Session auto-fill**: when "I parked here" is pressed from scanner or street sheet, prefill `allowed_until`, `max_stay`, `next_restriction`, `reason` from the decision (existing `startSession` already takes most of these; extend `device-store` Session type for `nextRestriction`).
- **Find My Car**: extend active session with stored `coordinates` (already present) + small `FindMyCarCard` on `/session` showing distance from current GPS, bearing arrow, "Navigate" deep link, "Show on map" (flyTo).

---

## Phase 4 — LA Provider Hardening + UNKNOWN Surface
Covers **Feature 8**.

- **Providers**: LADOT, SantaMonica, WestHollywood, Pasadena server files already exist. Audit each, ensure they import published open-data feeds (street sweeping, permit zones, meters, red curbs) and write normalized `parking_rules` + `street_segments`. Add missing fields where provider data supports it. Pasadena/WeHo gaps will be flagged in `provider_health`.
- **No Seattle fallback**: confirm registry routes LA bbox queries to LA providers only; never to `seattle-blockface`.
- **UNKNOWN handling**: when no segment within 50m has rules, decision returns UNKNOWN with copy: *"Parking status cannot be verified. Please verify local signage."* plus a one-tap "Scan the sign" CTA that opens `/scan`.
- **Coverage areas** wired into LA coverage admin page (already exists) so DTLA / Hollywood / Koreatown / etc. each report a status.

---

## Phase 5 (small) — Polish + Confidence Badges Everywhere
- Confidence badge on street sheet, scan result, recommendation cards.
- Memory of design tokens (no hardcoded colors).

---

## Technical Notes

- **No new engine.** `decision.ts` is a thin wrapper over `evaluateRulesAt()` + a forward scan of the same rule set; it never re-interprets restrictions.
- **AI calls** go through `src/lib/ai-gateway.server.ts` (will create if missing) using `LOVABLE_API_KEY` and `google/gemini-3-flash-preview`. Structured output via `Output.object` with tiny schema (single `summary` string) to avoid Gemini state-limit issues.
- **Server fns** live in `src/lib/parking/*.functions.ts` (already the convention). No `createServerFn` in loaders of public routes.
- **Seattle isolation**: no edits to `providers/seattle-blockface.server.ts`, Seattle rule rows, or any Seattle-only code path. New code branches on `cityId` only where city-specific behavior is needed.
- **DB**: no schema changes expected in phases 1–3. Phase 4 may add columns to `provider_health` if needed; will surface as a migration for your approval.

---

## What I'll Do First If You Approve

Phase 1 only — it's the foundation everything else renders on. After you verify the new Can-I-Park screen + AI summary + timeline + countdown work on a tapped LA segment and your current GPS, I'll move to Phase 2.

Reply "go" to start Phase 1, or tell me to reorder phases.
