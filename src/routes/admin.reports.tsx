import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listReports } from "@/lib/parking/beta.functions";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({ meta: [{ title: "Admin · User reports" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const fetchList = useServerFn(listReports);
  const q = useQuery({ queryKey: ["admin", "reports"], queryFn: () => fetchList({ data: { limit: 100 } }) });

  if (q.isLoading) return <div>Loading reports…</div>;
  if (q.error) return <div style={{ color: "crimson" }}>{(q.error as Error).message}</div>;
  const rows = q.data ?? [];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>User reports</h2>
      <p style={{ color: "#475569", fontSize: 13 }}>Anonymous reports from beta testers — incorrect results, bad sign reads, wrong street data.</p>

      <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, marginTop: 12 }}>
        {rows.length === 0 && <div style={{ padding: 16, color: "#94a3b8" }}>No reports yet.</div>}
        {rows.map((r) => (
          <div key={r.id} style={{ padding: 14, borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b" }}>
              <span style={{ textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>{r.report_type.replace(/_/g, " ")} · {r.surface}</span>
              <span>{new Date(r.created_at).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 14, marginTop: 4 }}>{r.message}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
              device {r.device_id.slice(0, 8)}…
              {r.segment_name ? ` · ${r.segment_name}` : ""}
              {r.scan_id ? ` · scan ${r.scan_id.slice(0, 8)}` : ""}
              {` · status: ${r.status}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
