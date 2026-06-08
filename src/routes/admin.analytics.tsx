import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getUsageStats } from "@/lib/parking/beta.functions";

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({ meta: [{ title: "Admin · Beta analytics" }] }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const fetchStats = useServerFn(getUsageStats);
  const q = useQuery({ queryKey: ["admin", "usage-stats"], queryFn: () => fetchStats() });

  if (q.isLoading) return <div>Loading analytics…</div>;
  if (q.error) return <div style={{ color: "crimson" }}>{(q.error as Error).message}</div>;
  const data = q.data!;

  const cardStyle: React.CSSProperties = { background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Beta usage analytics</h2>
      <p style={{ color: "#475569", fontSize: 13 }}>Anonymous device events from the last 7 days.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 16 }}>
        <Stat label="Events (7d)" value={data.totalEvents7d} />
        <Stat label="Unique devices (7d)" value={data.totalDevices7d} />
        <Stat label="Event types" value={data.totals.length} />
      </div>

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Events by feature</h3>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ padding: "6px 4px" }}>Event</th>
              <th>7d</th><th>24h</th><th>Devices</th>
            </tr>
          </thead>
          <tbody>
            {data.totals.map((t) => (
              <tr key={t.event_name} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "6px 4px", fontWeight: 600 }}>{t.event_name}</td>
                <td>{t.count_7d}</td><td>{t.count_24h}</td><td>{t.unique_devices_7d}</td>
              </tr>
            ))}
            {data.totals.length === 0 && <tr><td colSpan={4} style={{ padding: 12, color: "#94a3b8" }}>No events yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Daily total</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>
          {data.daily.map((d) => (
            <li key={d.day} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #f1f5f9" }}>
              <span>{d.day}</span><span style={{ fontWeight: 700 }}>{d.total}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1.2 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
