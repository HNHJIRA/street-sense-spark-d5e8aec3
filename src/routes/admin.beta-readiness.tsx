import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getBetaReadiness } from "@/lib/parking/beta.functions";

export const Route = createFileRoute("/admin/beta-readiness")({
  head: () => ({ meta: [{ title: "Admin · Beta readiness" }] }),
  component: BetaReadinessPage,
});

function BetaReadinessPage() {
  const fetchReport = useServerFn(getBetaReadiness);
  const q = useQuery({ queryKey: ["admin", "beta-readiness"], queryFn: () => fetchReport() });

  if (q.isLoading) return <div>Generating readiness report…</div>;
  if (q.error) return <div style={{ color: "crimson" }}>{(q.error as Error).message}</div>;
  const r = q.data!;

  const overallColor =
    r.overall === "ready" ? "#16a34a" : r.overall === "needs_work" ? "#ea580c" : "#dc2626";

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Beta readiness report</h2>
      <p style={{ color: "#475569", fontSize: 13 }}>Generated {new Date(r.generated_at).toLocaleString()}.</p>

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "white", border: "1px solid #e2e8f0", borderRadius: 12, marginTop: 12 }}>
        <div style={{ width: 14, height: 14, borderRadius: "50%", background: overallColor }} />
        <div>
          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1.2 }}>Overall</div>
          <div style={{ fontSize: 22, fontWeight: 800, textTransform: "capitalize" }}>{r.overall.replace("_", " ")}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 12 }}>
        <Stat label="Cities live" value={r.cities_live} />
        <Stat label="Segments" value={r.segments_total} />
        <Stat label="Open reports" value={r.open_reports} />
        <Stat label="Failed syncs (7d)" value={r.failed_syncs_7d} />
        <Stat label="Rule conflicts" value={r.rule_conflicts} />
        <Stat label="Scans (7d)" value={r.scans_last_7d} />
        <Stat label="Low-conf scans (7d)" value={r.low_confidence_scans_7d} />
        <Stat label="Rules total" value={r.segments_with_rules} />
      </div>

      <h3 style={{ marginTop: 24 }}>Findings</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {r.items.map((it, i) => {
          const bg = it.severity === "high" ? "#fef2f2" : it.severity === "medium" ? "#fff7ed" : "#f0fdf4";
          const border = it.severity === "high" ? "#fecaca" : it.severity === "medium" ? "#fed7aa" : "#bbf7d0";
          return (
            <div key={i} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#64748b", fontWeight: 700 }}>
                {it.category} · {it.severity}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{it.title}</div>
              <div style={{ fontSize: 13, color: "#334155", marginTop: 4 }}>{it.detail}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
