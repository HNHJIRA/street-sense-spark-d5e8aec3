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

interface DebugSync {
  status: number;
  durationMs: number;
  startedAt: string;
  body: any;
}

function ArlingtonCoveragePage() {
  const fn = useServerFn(getArlingtonCoverage);
  const sync = useServerFn(runAdminSync);
  const [syncing, setSyncing] = useState(false);
  const [debugSyncing, setDebugSyncing] = useState(false);
  const [debug, setDebug] = useState<DebugSync | null>(null);
  const [debugError, setDebugError] = useState<string | null>(null);
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

  async function runDebugSync() {
    setDebugSyncing(true);
    setDebugError(null);
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    try {
      const res = await fetch("/api/public/admin/sync-arlington?wait=1", { method: "GET" });
      const text = await res.text();
      let body: any = text;
      try { body = JSON.parse(text); } catch { /* keep raw */ }
      setDebug({ status: res.status, durationMs: Math.round(performance.now() - t0), startedAt, body });
      await q.refetch();
    } catch (e) {
      setDebugError((e as Error).message);
    } finally {
      setDebugSyncing(false);
    }
  }

  const pr = debug?.body?.providerRun;
  const providersRun: any[] = Array.isArray(pr?.results) ? pr.results : Array.isArray(pr?.providers) ? pr.providers : Array.isArray(pr) ? pr : [];
  const imported = providersRun.reduce((s, p) => s + (p?.imported ?? p?.segments_imported ?? 0), 0);
  const skipped = providersRun.reduce((s, p) => s + (p?.skipped ?? 0), 0);
  const diagnostics: any[] = Array.isArray(debug?.body?.diagnostics) ? debug!.body.diagnostics : [];

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
        <button
          onClick={runDebugSync}
          disabled={debugSyncing}
          style={{
            padding: "8px 12px", borderRadius: 8, border: "1px solid #0f172a",
            background: debugSyncing ? "#334155" : "#0f172a", color: "white",
            fontSize: 12, fontWeight: 600, cursor: debugSyncing ? "wait" : "pointer",
          }}
        >
          {debugSyncing ? "Running…" : "Run Sync Now (debug)"}
        </button>
      </section>

      <section style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "white", padding: 14 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.6, color: "#0f172a" }}>
          Sync Debug Panel
        </h3>
        {!debug && !debugError && (
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Click <strong>Run Sync Now (debug)</strong> to hit{" "}
            <code>/api/public/admin/sync-arlington?wait=1</code> and inspect the raw response.
          </div>
        )}
        {debugError && <div style={{ color: "#dc2626", fontSize: 13 }}>Error: {debugError}</div>}
        {debug && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
              <Stat label="HTTP Status" value={debug.status} danger={debug.status >= 400} />
              <Stat label="Duration" value={`${debug.durationMs} ms`} />
              <Stat label="Providers Run" value={providersRun.length} />
              <Stat label="Imported" value={imported} />
              <Stat label="Skipped" value={skipped} />
              <Stat label="Started" value={new Date(debug.startedAt).toLocaleTimeString()} />
            </div>

            {providersRun.length > 0 && (
              <div style={{ overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>{["Provider", "Imported", "Skipped", "Last Error", "Notes"].map((h) => (
                      <th key={h} style={th}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {providersRun.map((p, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={td}>{p?.provider ?? p?.id ?? `#${i}`}</td>
                        <td style={td}>{p?.imported ?? p?.segments_imported ?? 0}</td>
                        <td style={td}>{p?.skipped ?? 0}</td>
                        <td style={{ ...td, color: p?.last_error || p?.error ? "#dc2626" : "#475569" }}>
                          {p?.last_error ?? p?.error ?? "—"}
                        </td>
                        <td style={{ ...td, color: "#475569" }}>{p?.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <details open>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#0f172a" }}>
                Raw response JSON
              </summary>
              <pre style={{
                marginTop: 8, background: "#0f172a", color: "#e2e8f0", padding: 12,
                borderRadius: 8, fontSize: 11, maxHeight: 360, overflow: "auto",
              }}>
                {JSON.stringify(debug.body, null, 2)}
              </pre>
            </details>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", textTransform: "uppercase", letterSpacing: 0.6 }}>
                Per-Stage Diagnostics {diagnostics.length === 0 && <span style={{ color: "#dc2626", textTransform: "none", fontWeight: 500 }}>— none returned by endpoint</span>}
              </div>
              {debug.body?.diagnosticsError && (
                <div style={{ color: "#dc2626", fontSize: 12 }}>
                  diagnosticsError: {String(debug.body.diagnosticsError)}
                </div>
              )}
              {diagnostics.length > 0 && (
                <>
                  <div style={{ overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                      <thead style={{ background: "#f8fafc" }}>
                        <tr>{["Provider", "Fetched", "In BBox", "Segments", "Rules", "Geom", "Error"].map((h) => (
                          <th key={h} style={th}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {diagnostics.map((d, i) => (
                          <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                            <td style={td}><strong>{d.provider}</strong></td>
                            <td style={td}>{d.features_fetched}</td>
                            <td style={td}>{d.features_after_bbox}</td>
                            <td style={td}>{d.segments_generated}</td>
                            <td style={td}>{d.rules_generated}</td>
                            <td style={td}>{d.geometry_type}</td>
                            <td style={{ ...td, color: d.error ? "#dc2626" : "#475569" }}>{d.error ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {diagnostics.map((d, i) => (
                    <details key={i} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 8 }}>
                      <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                        {d.provider} — sample feature, dataset, notes
                      </summary>
                      <div style={{ fontSize: 11, color: "#475569", marginTop: 6, wordBreak: "break-all" }}>
                        <div><strong>dataset_url:</strong> <code>{d.dataset_url}</code></div>
                        <div style={{ marginTop: 4 }}><strong>notes:</strong> {d.notes}</div>
                        {d.error && <div style={{ marginTop: 4, color: "#dc2626" }}><strong>error:</strong> {d.error}</div>}
                      </div>
                      <pre style={{ marginTop: 8, background: "#0f172a", color: "#e2e8f0", padding: 10, borderRadius: 6, fontSize: 10, maxHeight: 240, overflow: "auto" }}>
                        {JSON.stringify(d.sample_feature, null, 2)}
                      </pre>
                    </details>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
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

function Stat({ label, value, danger }: { label: string; value: React.ReactNode; danger?: boolean }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: "#f8fafc" }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: danger ? "#dc2626" : "#0f172a", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
