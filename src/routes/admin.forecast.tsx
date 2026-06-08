// Forecast accuracy testing — runs multiple weekly time slots against the engine.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listDebugSegments } from "@/lib/parking/debug.functions";
import { getForecastMatrix } from "@/lib/parking/admin.functions";

export const Route = createFileRoute("/admin/forecast")({
  head: () => ({ meta: [{ title: "Forecast Accuracy · Admin" }] }),
  component: ForecastPage,
});

function ForecastPage() {
  const listFn = useServerFn(listDebugSegments);
  const matrixFn = useServerFn(getForecastMatrix);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expected, setExpected] = useState<Record<string, string>>({});
  const [tz, setTz] = useState("America/Los_Angeles");

  const listQ = useQuery({
    queryKey: ["fc-list", search],
    queryFn: () => listFn({ data: { citySlug: "seattle", limit: 100, search: search || null } }),
  });
  const matrixQ = useQuery({
    queryKey: ["fc-matrix", selectedId, tz],
    queryFn: () => matrixFn({ data: { segmentId: selectedId!, timezone: tz } }),
    enabled: !!selectedId,
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16 }}>
      <aside style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search street…"
          style={{ width: "100%", padding: 8, border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, marginBottom: 8 }} />
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>{listQ.data?.length ?? 0} segments</div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>
          {(listQ.data ?? []).map((s) => (
            <button key={s.id} onClick={() => { setSelectedId(s.id); setExpected({}); }} style={{
              display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
              border: "none", borderBottom: "1px solid #f1f5f9",
              background: selectedId === s.id ? "#dbeafe" : "white", cursor: "pointer", fontSize: 12,
            }}>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <div style={{ color: "#64748b", fontSize: 10 }}>{s.data_source} · {s.side}</div>
            </button>
          ))}
        </div>
      </aside>

      <main>
        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <label style={{ fontSize: 12 }}>Timezone:&nbsp;
            <select value={tz} onChange={(e) => setTz(e.target.value)} style={{ padding: 6, border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }}>
              <option>America/Los_Angeles</option>
              <option>America/New_York</option>
              <option>America/Chicago</option>
            </select>
          </label>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#64748b" }}>
            Select an "Expected" color for each slot to flag engine discrepancies.
          </p>
        </section>

        {!selectedId && <div style={{ padding: 30, textAlign: "center", color: "#64748b" }}>Select a segment to run the forecast suite.</div>}

        {matrixQ.data && (
          <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>{matrixQ.data.segment_name}</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>
                <th style={S.th}>Slot</th><th style={S.th}>Evaluated at</th>
                <th style={S.th}>Engine color</th><th style={S.th}>Engine status</th>
                <th style={S.th}>Expected</th><th style={S.th}>Match</th>
              </tr></thead>
              <tbody>
                {matrixQ.data.slots.map((s) => {
                  const exp = expected[s.label] ?? "";
                  const match = !exp ? null : exp === s.color;
                  return (
                    <tr key={s.label} style={{ background: match === false ? "#fef2f2" : undefined }}>
                      <td style={S.td}><b>{s.label}</b></td>
                      <td style={S.td}>{new Date(s.iso).toLocaleString()}</td>
                      <td style={S.td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color === "green" ? "#16a34a" : s.color === "yellow" ? "#eab308" : "#dc2626" }} />
                          {s.color}
                        </span>
                      </td>
                      <td style={S.td}>{s.status_label}</td>
                      <td style={S.td}>
                        <select value={exp} onChange={(e) => setExpected({ ...expected, [s.label]: e.target.value })}
                          style={{ padding: 4, border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 12 }}>
                          <option value="">—</option>
                          <option value="green">green</option>
                          <option value="yellow">yellow</option>
                          <option value="red">red</option>
                        </select>
                      </td>
                      <td style={S.td}>{match === null ? "—" : match ? "✅" : "❌ mismatch"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}

const S = {
  th: { textAlign: "left" as const, padding: "8px 10px", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  td: { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" as const },
};
