import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  getArlingtonCoverage,
  type ArlingtonAreaCoverage,
} from "@/lib/parking/arlington-coverage.functions";
import { runAdminSync } from "@/lib/parking/admin.functions";
import { useState } from "react";

export const Route = createFileRoute("/admin/arlington-coverage")({
  head: () => ({ meta: [{ title: "Arlington Coverage · Admin" }] }),
  component: ArlingtonCoveragePage,
});

function pct(part: number, total: number) {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

function classify(a: ArlingtonAreaCoverage): { label: string; color: string } {
  if (!a.provider_id) return { label: "NO PROVIDER", color: "#dc2626" };
  if (a.segments === 0) return { label: "NOT IMPORTED", color: "#94a3b8" };
  const verifiedRatio = (a.sweeping + a.permit + a.metered) / Math.max(1, a.segments);
  if (verifiedRatio > 0.6) return { label: "PARTIAL — Verified", color: "#16a34a" };
  if (a.unknown > 0) return { label: "PARTIAL — Mostly Unknown", color: "#eab308" };
  return { label: "IMPORTED", color: "#0ea5e9" };
}

function ArlingtonCoveragePage() {
  const fn = useServerFn(getArlingtonCoverage);
  const sync = useServerFn(runAdminSync);
  const [syncing, setSyncing] = useState(false);
  const q = useQuery({
    queryKey: ["arlington-coverage"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });

  async function runSync() {
    setSyncing(true);
    try {
      await sync({ data: { citySlug: "arlington" } });
      await q.refetch();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Arlington, VA Coverage</h2>
        <p style={{ color: "#475569", fontSize: 13, marginTop: 4, maxWidth: 720 }}>
          Verified open-data coverage across Arlington County neighborhoods.
          Arlington publishes street centerlines and a parking meter inventory,
          but does not publish a comprehensive curb-regulation layer — segments
          without posted sign data carry an explicit <strong>UNKNOWN</strong>{" "}
          status. The parking engine never invents legality; use the AI Sign
          Scanner to resolve unknown blocks at the curb.
        </p>
      </header>

      <section style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={runSync}
          disabled={syncing}
          style={{
            padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1",
            background: syncing ? "#e2e8f0" : "white", fontSize: 12, fontWeight: 600,
            cursor: syncing ? "wait" : "pointer",
          }}
        >
          {syncing ? "Syncing…" : "Sync Arlington"}
        </button>
      </section>

      <section style={{ overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8, background: "white" }}>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead style={{ background: "#f8fafc" }}>
            <tr>
              {["Area", "Provider", "Segments", "Sweeping", "Permit", "Metered", "Unknown", "Status"].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(q.data?.areas ?? []).map((a) => {
              const c = classify(a);
              return (
                <tr key={a.area} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={td}><strong>{a.area}</strong></td>
                  <td style={td}>{a.provider_id ?? "—"}</td>
                  <td style={td}>{a.segments.toLocaleString()}</td>
                  <td style={td}>{a.sweeping} <span style={muted}>({pct(a.sweeping, a.segments)})</span></td>
                  <td style={td}>{a.permit} <span style={muted}>({pct(a.permit, a.segments)})</span></td>
                  <td style={td}>{a.metered} <span style={muted}>({pct(a.metered, a.segments)})</span></td>
                  <td style={td}>{a.unknown} <span style={muted}>({pct(a.unknown, a.segments)})</span></td>
                  <td style={td}>
                    <span style={{ background: c.color, color: "white", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                      {c.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Provider Health (Arlington)</h3>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "white", overflow: "auto" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead style={{ background: "#f8fafc" }}>
              <tr>{["Provider", "Status", "Last Success", "Last Error / Note", "Imported"].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {(q.data?.provider_health ?? []).map((p: any, i: number) => (
                <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={td}>{p.provider}</td>
                  <td style={td}>{p.status}</td>
                  <td style={td}>{p.last_success_at ? new Date(p.last_success_at).toLocaleString() : "—"}</td>
                  <td style={{ ...td, color: p.last_error ? "#dc2626" : "#475569" }}>
                    {p.last_error ?? p.notes ?? "—"}
                  </td>
                  <td style={td}>{p.segments_imported ?? 0}</td>
                </tr>
              ))}
              {!(q.data?.provider_health ?? []).length && (
                <tr><td style={td} colSpan={5}><em>No provider health records yet — run a sync above.</em></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p style={{ fontSize: 11, color: "#64748b", maxWidth: 720 }}>
        Source datasets: Arlington County GIS Hub — Street Centerlines,
        Parking Meters, and (when published) RPP Districts. Posted-sign curb
        regulations (no-parking, time-limited, loading, tow-away) are not
        comprehensively published by Arlington County, so Forecast and
        Can-I-Park-Here will return UNKNOWN for blocks without verified rules.
        The AI Sign Scanner is the supported path to resolve them.
      </p>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", fontSize: 11, color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 };
const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
const muted: React.CSSProperties = { color: "#94a3b8", fontSize: 11 };
