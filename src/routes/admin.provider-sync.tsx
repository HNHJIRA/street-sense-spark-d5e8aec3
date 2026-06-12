import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getProviderHealth, getRecentSyncLogs } from "@/lib/parking/parking.functions";
import { runAdminSync } from "@/lib/parking/admin.functions";

export const Route = createFileRoute("/admin/provider-sync")({
  head: () => ({ meta: [{ title: "Provider Sync · Admin" }] }),
  component: SyncPage,
});

function fmt(ts: string | null) { return ts ? new Date(ts).toLocaleString() : "—"; }

function SyncPage() {
  const qc = useQueryClient();
  const healthFn = useServerFn(getProviderHealth);
  const logsFn = useServerFn(getRecentSyncLogs);
  const runFn = useServerFn(runAdminSync);
  const [msg, setMsg] = useState<string | null>(null);

  const health = useQuery({ queryKey: ["sync-health"], queryFn: () => healthFn() });
  const logs = useQuery({ queryKey: ["sync-logs"], queryFn: () => logsFn({ data: { limit: 50 } }), refetchInterval: 15_000 });

  const run = useMutation({
    mutationFn: (slug: string) => runFn({ data: { citySlug: slug } }),
    onSuccess: (r, slug) => {
      setMsg(r.error ? `Error: ${r.error}` : `Imported ${r.imported}, skipped ${r.skipped}`);
      qc.invalidateQueries({ queryKey: ["sync-logs"] });
      qc.invalidateQueries({ queryKey: ["sync-health"] });
      qc.invalidateQueries({ queryKey: ["admin-dq", "seattle"] });
      // Auto-refresh map data so newly-synced segments (e.g. Pasadena green lines) appear immediately.
      qc.invalidateQueries({ queryKey: ["segments"] });
      qc.invalidateQueries({ queryKey: ["parking", "city", slug] });
      qc.invalidateQueries({ queryKey: ["la-availability-blocks"] });
    },
    onError: (e: Error) => setMsg(`Failed: ${e.message}`),
  });

  const totalImported = (logs.data ?? []).reduce((a, l) => a + (l.imported || 0), 0);
  const successCount = (logs.data ?? []).filter((l) => l.status === "success").length;
  const errorCount = (logs.data ?? []).filter((l) => l.status === "error" || l.status === "partial").length;
  const avgMs = (() => {
    const xs = (logs.data ?? []).filter((l) => l.duration_ms != null).map((l) => l.duration_ms!);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  })();
  const lastImport = (logs.data ?? []).find((l) => l.status === "success")?.finished_at ?? null;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => { setMsg(null); run.mutate("seattle"); }}
            disabled={run.isPending}
            style={{ background: "#0f172a", color: "white", border: "none", padding: "10px 16px", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 14 }}
          >
            {run.isPending ? "Syncing Seattle…" : "Run Seattle SDOT Sync"}
          </button>
          <div style={{ fontSize: 12, color: "#64748b" }}>Pulls full Seattle bbox from SDOT FeatureServer (up to 20,000 blockfaces).</div>
        </div>
        {msg && <div style={{ marginTop: 10, fontSize: 13, color: msg.startsWith("Error") || msg.startsWith("Failed") ? "#b91c1c" : "#166534" }}>{msg}</div>}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <Stat label="Recent runs" value={(logs.data?.length ?? 0).toString()} />
        <Stat label="Successful" value={successCount.toString()} />
        <Stat label="Failed / partial" value={errorCount.toString()} warn={errorCount > 0} />
        <Stat label="Σ imported (window)" value={totalImported.toLocaleString()} />
        <Stat label="Avg duration" value={avgMs != null ? `${(avgMs / 1000).toFixed(1)}s` : "—"} />
        <Stat label="Last successful" value={fmt(lastImport)} />
      </section>

      <section>
        <h2 style={S.h2}>Data Source Statistics</h2>
        <div style={{ overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8, background: "white" }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Provider</th><th style={S.th}>Segments</th>
              <th style={S.th}>Healthy</th><th style={S.th}>Last Success</th><th style={S.th}>Updated</th>
            </tr></thead>
            <tbody>
              {(health.data ?? []).map((r) => (
                <tr key={`${r.provider}-${r.city_slug}`}>
                  <td style={S.td}><b>{r.provider}</b></td>
                  <td style={S.td}>{r.segments_total.toLocaleString()}</td>
                  <td style={S.td}>{r.healthy ? "✅" : "❌"}</td>
                  <td style={S.td}>{fmt(r.last_success_at)}</td>
                  <td style={S.td}>{fmt(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 style={S.h2}>Sync History</h2>
        <div style={{ overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8, background: "white" }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Started</th><th style={S.th}>Provider</th><th style={S.th}>Status</th>
              <th style={S.th}>Imported</th><th style={S.th}>Skipped / Failed</th><th style={S.th}>Duration</th><th style={S.th}>Error</th>
            </tr></thead>
            <tbody>
              {(logs.data ?? []).map((l) => (
                <tr key={l.id}>
                  <td style={S.td}>{fmt(l.started_at)}</td>
                  <td style={S.td}>{l.provider}</td>
                  <td style={S.td}>{l.status}</td>
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

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ background: "white", border: `1px solid ${warn ? "#fca5a5" : "#e2e8f0"}`, padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#64748b" }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 18, marginTop: 4, color: warn ? "#b91c1c" : "#0f172a" }}>{value}</div>
    </div>
  );
}

const S = {
  h2: { fontSize: 13, textTransform: "uppercase" as const, letterSpacing: 1, color: "#475569", margin: "0 0 8px" },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { textAlign: "left" as const, padding: "8px 10px", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  td: { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" as const },
};
