import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getFreshness, runSync, type FreshnessRow } from "@/lib/parking/sync-orchestrator.functions";

export const Route = createFileRoute("/admin/freshness")({
  head: () => ({ meta: [{ title: "Sync Freshness · Admin" }] }),
  component: FreshnessPage,
});

function fmt(ts: string | null) { return ts ? new Date(ts).toLocaleString() : "—"; }
function fmtMs(ms: number | null | undefined) {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  healthy: { bg: "#dcfce7", fg: "#166534", label: "Healthy" },
  warning: { bg: "#fef3c7", fg: "#92400e", label: "Warning" },
  failed:  { bg: "#fee2e2", fg: "#991b1b", label: "Failed" },
  running: { bg: "#dbeafe", fg: "#1e40af", label: "Running" },
  unknown: { bg: "#e2e8f0", fg: "#475569", label: "Unknown" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.unknown;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999,
      fontSize: 11, fontWeight: 700, background: s.bg, color: s.fg,
    }}>{s.label}</span>
  );
}

function FreshnessPage() {
  const qc = useQueryClient();
  const fn = useServerFn(getFreshness);
  const syncFn = useServerFn(runSync);
  const [msg, setMsg] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["freshness"],
    queryFn: () => fn(),
    refetchInterval: 10_000,
  });

  const trigger = useMutation({
    mutationFn: (row: FreshnessRow) => syncFn({
      data: {
        citySlug: row.city_slug ?? "",
        mode: "full",
        trigger: "manual",
        providerId: row.provider,
      },
    }),
    onSuccess: (r) => {
      setMsg(
        r.status === "already_running" ? "Sync already in progress."
        : r.status === "completed" ? `Imported ${r.imported}, skipped ${r.skipped} in ${fmtMs(r.duration_ms)}.`
        : `Error: ${r.message}`,
      );
      qc.invalidateQueries({ queryKey: ["freshness"] });
      qc.invalidateQueries({ queryKey: ["sync-health"] });
      qc.invalidateQueries({ queryKey: ["sync-logs"] });
    },
    onError: (e: Error) => setMsg(`Failed: ${e.message}`),
  });

  const rows = q.data ?? [];
  const counts = rows.reduce(
    (a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section>
        <h1 style={{ margin: 0, fontSize: 22 }}>Sync Freshness</h1>
        <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
          Live status of every parking provider. Auto-refreshes every 10s.
        </p>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        {(["healthy", "warning", "failed", "running"] as const).map((s) => (
          <div key={s} style={{
            background: "white", border: "1px solid #e2e8f0",
            padding: 12, borderRadius: 8,
          }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#64748b" }}>
              {STATUS_STYLE[s].label}
            </div>
            <div style={{ fontWeight: 800, fontSize: 22, marginTop: 4, color: STATUS_STYLE[s].fg }}>
              {counts[s] ?? 0}
            </div>
          </div>
        ))}
      </section>

      {msg && (
        <div style={{
          background: "white", border: "1px solid #e2e8f0",
          borderRadius: 8, padding: 10, fontSize: 13,
        }}>{msg}</div>
      )}

      <section style={{ overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8, background: "white" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {["Provider", "City", "Status", "Last success", "Last started", "Last completed", "Records", "Duration", "Incremental?", "Last error", ""].map((h) => (
                <th key={h} style={{
                  textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0",
                  color: "#64748b", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.provider}-${r.city_slug}`}>
                <td style={td}><b>{r.provider}</b></td>
                <td style={td}>{r.city_name ?? r.city_slug ?? "—"}</td>
                <td style={td}><StatusBadge status={r.status} /></td>
                <td style={td}>{fmt(r.last_success_at)}</td>
                <td style={td}>{fmt(r.last_sync_started_at)}</td>
                <td style={td}>{fmt(r.last_sync_completed_at)}</td>
                <td style={td}>↓{r.records_imported.toLocaleString()} · skip {r.records_skipped.toLocaleString()}</td>
                <td style={td}>{fmtMs(r.duration_ms)}</td>
                <td style={td}>
                  {r.supports_incremental
                    ? <span style={{ color: "#166534" }}>✓ {fmt(r.last_incremental_at)}</span>
                    : <span style={{ color: "#94a3b8" }}>full only</span>}
                </td>
                <td style={{ ...td, color: "#dc2626", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.last_error ?? ""}
                </td>
                <td style={td}>
                  <button
                    onClick={() => { setMsg(null); trigger.mutate(r); }}
                    disabled={trigger.isPending || r.status === "running" || !r.city_slug}
                    style={{
                      background: "#0f172a", color: "white", border: "none",
                      padding: "4px 10px", borderRadius: 6, fontSize: 11,
                      cursor: trigger.isPending ? "not-allowed" : "pointer",
                      opacity: trigger.isPending || r.status === "running" ? 0.5 : 1,
                    }}
                  >Sync</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={11} style={{ ...td, color: "#94a3b8", textAlign: "center", padding: 20 }}>
                {q.isLoading ? "Loading…" : "No provider health rows yet."}
              </td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const td: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
};
