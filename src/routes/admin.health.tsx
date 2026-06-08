import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getProviderHealth, getRecentSyncLogs } from "@/lib/parking/parking.functions";
import { getDataQualityMetrics, getMultiCityReadiness } from "@/lib/parking/admin.functions";

export const Route = createFileRoute("/admin/health")({
  head: () => ({ meta: [{ title: "Provider Health · Admin" }] }),
  component: HealthPage,
});

function fmt(ts: string | null) {
  return ts ? new Date(ts).toLocaleString() : "—";
}
function ago(ts: string | null) {
  if (!ts) return "never";
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function HealthPage() {
  const healthFn = useServerFn(getProviderHealth);
  const logsFn = useServerFn(getRecentSyncLogs);
  const dqFn = useServerFn(getDataQualityMetrics);
  const mcFn = useServerFn(getMultiCityReadiness);

  const health = useQuery({ queryKey: ["admin-health"], queryFn: () => healthFn(), refetchInterval: 30_000 });
  const logs = useQuery({ queryKey: ["admin-logs"], queryFn: () => logsFn({ data: { limit: 25 } }), refetchInterval: 30_000 });
  const dq = useQuery({ queryKey: ["admin-dq", "seattle"], queryFn: () => dqFn({ data: { citySlug: "seattle" } }) });
  const mc = useQuery({ queryKey: ["admin-mc"], queryFn: () => mcFn() });

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section>
        <h2 style={S.h2}>Provider Health</h2>
        <div style={{ overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8, background: "white" }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Provider</th><th style={S.th}>City</th><th style={S.th}>Status</th>
              <th style={S.th}>Last Success</th><th style={S.th}>Last Error</th>
              <th style={S.th}>Segments</th><th style={S.th}>Freshness</th><th style={S.th}>Error</th>
            </tr></thead>
            <tbody>
              {(health.data ?? []).map((r) => (
                <tr key={`${r.provider}-${r.city_slug}`}>
                  <td style={S.td}><b>{r.provider}</b></td>
                  <td style={S.td}>{r.city_name ?? r.city_slug ?? "—"}</td>
                  <td style={S.td}>
                    <span style={{ ...S.pill, background: r.healthy ? "#dcfce7" : "#fee2e2", color: r.healthy ? "#166534" : "#991b1b" }}>
                      {r.healthy ? "Healthy" : "Unhealthy"}
                    </span>
                  </td>
                  <td style={S.td}>{fmt(r.last_success_at)}</td>
                  <td style={S.td}>{fmt(r.last_error_at)}</td>
                  <td style={S.td}>{r.segments_total.toLocaleString()}</td>
                  <td style={S.td}>{ago(r.last_success_at)}</td>
                  <td style={{ ...S.td, color: "#dc2626", fontSize: 11 }}>{r.last_error ?? ""}</td>
                </tr>
              ))}
              {health.data?.length === 0 && (
                <tr><td colSpan={8} style={{ ...S.td, color: "#64748b" }}>No provider runs yet. Trigger a sync.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 style={S.h2}>Data Quality (Seattle)</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <DQCard label="Total segments" value={dq.data?.total_segments ?? "—"} />
          <DQCard label="Missing rules" value={dq.data?.segments_missing_rules ?? "—"} warn={(dq.data?.segments_missing_rules ?? 0) > 0} />
          <DQCard label="Missing geometry" value={dq.data?.segments_missing_geometry ?? "—"} />
          <DQCard label="Invalid time windows" value={dq.data?.invalid_time_windows ?? "—"} warn={(dq.data?.invalid_time_windows ?? 0) > 0} />
          <DQCard label="Rule conflicts" value={dq.data?.rule_conflicts ?? "—"} warn={(dq.data?.rule_conflicts ?? 0) > 0} />
          <DQCard label="Failed normalizations" value={dq.data?.failed_normalizations ?? "—"} warn={(dq.data?.failed_normalizations ?? 0) > 0} />
          <DQCard label="Import errors (24h)" value={dq.data?.provider_import_errors_24h ?? "—"} warn={(dq.data?.provider_import_errors_24h ?? 0) > 0} />
        </div>
      </section>

      <section>
        <h2 style={S.h2}>Multi-City Readiness</h2>
        <div style={{ overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8, background: "white" }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>City</th><th style={S.th}>Timezone</th><th style={S.th}>Provider</th>
              <th style={S.th}>Segments</th><th style={S.th}>Status</th>
            </tr></thead>
            <tbody>
              {(mc.data?.cities ?? []).map((c) => (
                <tr key={c.slug}>
                  <td style={S.td}><b>{c.name}</b><div style={{ fontSize: 11, color: "#64748b" }}>{c.slug}</div></td>
                  <td style={S.td}>{c.timezone}</td>
                  <td style={S.td}>{c.provider_name ?? "—"}</td>
                  <td style={S.td}>{c.segment_count.toLocaleString()}</td>
                  <td style={S.td}>
                    <span style={{ ...S.pill,
                      background: c.status === "live" ? "#dcfce7" : c.status === "ready" ? "#fef9c3" : "#e2e8f0",
                      color: c.status === "live" ? "#166534" : c.status === "ready" ? "#854d0e" : "#475569" }}>
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 style={S.h2}>Recent Sync Logs</h2>
        <div style={{ overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8, background: "white" }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Started</th><th style={S.th}>Provider</th><th style={S.th}>Status</th>
              <th style={S.th}>Imported</th><th style={S.th}>Skipped</th><th style={S.th}>Duration</th><th style={S.th}>Error</th>
            </tr></thead>
            <tbody>
              {(logs.data ?? []).map((l) => (
                <tr key={l.id}>
                  <td style={S.td}>{fmt(l.started_at)}</td>
                  <td style={S.td}>{l.provider}</td>
                  <td style={S.td}>
                    <span style={{ ...S.pill, background: l.status === "success" ? "#dcfce7" : l.status === "started" ? "#dbeafe" : "#fee2e2", color: l.status === "success" ? "#166534" : l.status === "started" ? "#1e40af" : "#991b1b" }}>
                      {l.status}
                    </span>
                  </td>
                  <td style={S.td}>{l.imported}</td>
                  <td style={S.td}>{l.skipped}</td>
                  <td style={S.td}>{l.duration_ms != null ? `${(l.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                  <td style={{ ...S.td, color: "#dc2626", fontSize: 11 }}>{l.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DQCard({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div style={{ border: `1px solid ${warn ? "#fca5a5" : "#e2e8f0"}`, background: warn ? "#fef2f2" : "white", padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#64748b" }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 22, marginTop: 4, color: warn ? "#b91c1c" : "#0f172a" }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
    </div>
  );
}

const S = {
  h2: { fontSize: 13, textTransform: "uppercase" as const, letterSpacing: 1, color: "#475569", margin: "0 0 8px" },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { textAlign: "left" as const, padding: "8px 10px", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  td: { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" as const },
  pill: { display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700 },
};
