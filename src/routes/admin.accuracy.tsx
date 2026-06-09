import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getAccuracyReport, type AccuracyReport } from "@/lib/parking/accuracy.functions";

const accuracyQuery = queryOptions({
  queryKey: ["admin", "accuracy"],
  queryFn: () => getAccuracyReport(),
  staleTime: 30_000,
});

export const Route = createFileRoute("/admin/accuracy")({
  loader: ({ context }) => context.queryClient.ensureQueryData(accuracyQuery),
  component: AccuracyPage,
  errorComponent: ({ error }) => <div style={{ padding: 24 }}>Failed to load accuracy report: {String(error)}</div>,
  notFoundComponent: () => <div style={{ padding: 24 }}>Not found.</div>,
});

const card: React.CSSProperties = {
  background: "white", border: "1px solid #e2e8f0", borderRadius: 12,
  padding: 16, boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
};
const h2: React.CSSProperties = { margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#0f172a", textTransform: "uppercase", letterSpacing: 0.6 };
const kvRow: React.CSSProperties = { display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px dashed #f1f5f9", fontSize: 13 };
const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums", fontWeight: 600 };

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }
function fmtMin(m: number | null) {
  if (m == null) return "—";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function KV({ label, value, danger }: { label: string; value: React.ReactNode; danger?: boolean }) {
  return (
    <div style={kvRow}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <span style={{ ...num, color: danger ? "#dc2626" : "#0f172a" }}>{value}</span>
    </div>
  );
}

function AccuracyPage() {
  const { data } = useSuspenseQuery(accuracyQuery);
  const r: AccuracyReport = data;

  const matchRateBad = r.scans.total > 0 && r.scans.matchRate < 0.5;
  const occBad = r.occupancy.rows === 0 || (r.occupancy.freshestAgeMinutes != null && r.occupancy.freshestAgeMinutes > 30);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 16 }}>
      <section style={card}>
        <h2 style={h2}>Scan Match Rate</h2>
        <KV label="Total scans" value={r.scans.total} />
        <KV label="Match rate" value={pct(r.scans.matchRate)} danger={matchRateBad} />
        <KV label="With verdict persisted" value={`${r.scans.withVerdictPersisted} / ${r.scans.total}`} />
        <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>Match status</div>
        {Object.entries(r.scans.byMatchStatus).map(([k, v]) => (
          <KV key={k} label={k} value={v} danger={k === "out_of_range" || k === "no_gps"} />
        ))}
      </section>

      <section style={card}>
        <h2 style={h2}>Verdict Distribution</h2>
        {Object.keys(r.scans.byVerdict).length === 0 && <div style={{ fontSize: 13, color: "#94a3b8" }}>No verdicts yet.</div>}
        {Object.entries(r.scans.byVerdict).map(([k, v]) => (
          <KV key={k} label={k} value={v} />
        ))}
        <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>Validation outcomes</div>
        {Object.entries(r.scans.byOutcome).map(([k, v]) => (
          <KV key={k} label={k} value={v} danger={k === "no_sdot" || k === "out_of_range"} />
        ))}
      </section>

      <section style={card}>
        <h2 style={h2}>Provider Freshness</h2>
        {r.providers.length === 0 && <div style={{ fontSize: 13, color: "#94a3b8" }}>No providers registered.</div>}
        {r.providers.map((p) => (
          <KV
            key={p.id}
            label={`${p.id} · ${p.status}`}
            value={fmtMin(p.ageMinutes)}
            danger={p.status !== "healthy" || (p.ageMinutes != null && p.ageMinutes > 24 * 60)}
          />
        ))}
      </section>

      <section style={card}>
        <h2 style={h2}>LA Occupancy Freshness</h2>
        <KV label="Spaces loaded" value={r.occupancy.spaces.toLocaleString()} />
        <KV label="Occupancy rows" value={r.occupancy.rows.toLocaleString()} danger={r.occupancy.rows === 0} />
        <KV label="Freshest event" value={fmtMin(r.occupancy.freshestAgeMinutes)} danger={occBad} />
        <div style={{ marginTop: 10, fontSize: 12, color: occBad ? "#dc2626" : "#64748b" }}>
          {r.occupancy.rows === 0
            ? "Pipeline empty — cron starts populating within 5 min of deploy."
            : "Cron syncs every 5 minutes via pg_cron → /api/public/cron/sync-la-occupancy."}
        </div>
      </section>

      <section style={card}>
        <h2 style={h2}>Rule Coverage by City</h2>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>
              <th>City</th><th>Segs</th><th>Rules</th><th>Avg</th><th>1-rule</th><th>0-rule</th>
            </tr>
          </thead>
          <tbody>
            {r.rules.byCity.map((c) => (
              <tr key={c.city} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={{ padding: "6px 0" }}>{c.city}</td>
                <td style={num}>{c.segments}</td>
                <td style={num}>{c.rules}</td>
                <td style={num}>{c.rulesPerSegment}</td>
                <td style={{ ...num, color: c.oneRuleSegments / Math.max(1, c.segments) > 0.9 ? "#dc2626" : undefined }}>{c.oneRuleSegments}</td>
                <td style={{ ...num, color: c.zeroRuleSegments > 0 ? "#dc2626" : undefined }}>{c.zeroRuleSegments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h2 style={h2}>Restriction Distribution</h2>
        {r.rules.byRestriction.slice(0, 10).map((r2) => (
          <KV key={r2.restriction_code} label={r2.restriction_code} value={r2.count.toLocaleString()} />
        ))}
      </section>

      <section style={card}>
        <h2 style={h2}>Seattle Rule Coverage Audit</h2>
        <KV label="Total segments" value={r.seattleAudit.segments} />
        <KV
          label="Segments with only 1 rule"
          value={`${r.seattleAudit.oneRuleSegments} (${pct(r.seattleAudit.oneRuleSegments / Math.max(1, r.seattleAudit.segments))})`}
          danger={r.seattleAudit.oneRuleSegments / Math.max(1, r.seattleAudit.segments) > 0.9}
        />
        <KV label="Segments with 2+ overlapping rules" value={r.seattleAudit.twoPlusRuleSegments} danger={r.seattleAudit.twoPlusRuleSegments === 0} />
        <KV label="Permit coverage (segments)" value={r.seattleAudit.permitSegments} />
        <KV label="Time-limited coverage (segments)" value={r.seattleAudit.timeLimitedSegments} danger={r.seattleAudit.timeLimitedSegments < 100} />
        <KV label="Street-cleaning coverage" value={r.seattleAudit.cleaningSegments} danger={r.seattleAudit.cleaningSegments === 0} />
        <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>
          Reality is 3–5 rules per block (cleaning + permit + time-limit + tow). Current SDOT pull is shallow — each blockface gets one PARKING_CATEGORY rule. Needs a deeper provider (e.g. SDOT signposts dataset) to layer street-cleaning and permit windows.
        </div>
      </section>

      <section style={card}>
        <h2 style={h2}>Report Generated</h2>
        <div style={{ fontSize: 12, color: "#64748b" }}>{new Date(r.generatedAt).toLocaleString()}</div>
      </section>
    </div>
  );
}
