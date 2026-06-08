// Internal developer validation dashboard for the parking rules engine.
// Not linked from the customer-facing app. Visit /debug/parking directly.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getSegmentDebug, listDebugSegments } from "@/lib/parking/debug.functions";

export const Route = createFileRoute("/debug/parking")({
  head: () => ({ meta: [{ title: "Parking Engine Validation (Internal)" }] }),
  component: DebugParkingPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, color: "#64748b", marginBottom: 6 }}>{title}</h2>
      <div style={{ background: "#0b1220", color: "#e2e8f0", padding: 12, borderRadius: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, overflow: "auto", maxHeight: 320 }}>
        {children}
      </div>
    </section>
  );
}

function Json({ value }: { value: unknown }) {
  return <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(value, null, 2)}</pre>;
}

function DebugParkingPage() {
  const listFn = useServerFn(listDebugSegments);
  const debugFn = useServerFn(getSegmentDebug);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [atInput, setAtInput] = useState<string>("");
  const [tz, setTz] = useState("America/Los_Angeles");

  const listQ = useQuery({
    queryKey: ["debug-list", search],
    queryFn: () => listFn({ data: { citySlug: "seattle", limit: 100, search: search || null } }),
  });

  const atIso = useMemo(() => {
    if (!atInput) return null;
    const d = new Date(atInput);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }, [atInput]);

  const reportQ = useQuery({
    queryKey: ["debug-report", selectedId, atIso, tz],
    queryFn: () => debugFn({ data: { id: selectedId!, at: atIso, timezone: tz } }),
    enabled: !!selectedId,
  });

  const r = reportQ.data;

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Parking Engine Validation</h1>
        <p style={{ margin: "4px 0 0", color: "#475569", fontSize: 13 }}>
          Internal developer tool. Inspect raw source → normalized → conflict-resolved → engine decision → map color.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 }}>
        <aside style={{ borderRight: "1px solid #e2e8f0", paddingRight: 16 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by street name…"
            style={{ width: "100%", padding: 8, border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, marginBottom: 8 }}
          />
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
            {listQ.isLoading ? "Loading…" : `${listQ.data?.length ?? 0} segments`}
          </div>
          <div style={{ maxHeight: "70vh", overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 6 }}>
            {(listQ.data ?? []).map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "8px 10px", border: "none", borderBottom: "1px solid #f1f5f9",
                  background: selectedId === s.id ? "#dbeafe" : "white",
                  cursor: "pointer", fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div style={{ color: "#64748b", fontSize: 10 }}>
                  {s.data_source} · {s.side} · {s.external_id ?? s.id.slice(0, 8)}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main>
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <label style={{ fontSize: 12 }}>
              Evaluate at (local):{" "}
              <input
                type="datetime-local"
                value={atInput}
                onChange={(e) => setAtInput(e.target.value)}
                style={{ padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Timezone:{" "}
              <input
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                style={{ padding: 6, border: "1px solid #cbd5e1", borderRadius: 6, width: 200 }}
              />
            </label>
            <button
              onClick={() => setAtInput("")}
              style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, background: "white", cursor: "pointer", fontSize: 12 }}
            >Now</button>
          </div>

          {!selectedId && <div style={{ color: "#64748b" }}>Select a segment from the list.</div>}
          {selectedId && reportQ.isLoading && <div>Loading report…</div>}
          {selectedId && reportQ.error && (
            <div style={{ color: "#dc2626" }}>Error: {(reportQ.error as Error).message}</div>
          )}

          {r && (
            <>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16,
              }}>
                <Card label="Engine decision" value={r.engine.label} sub={r.engine.code} />
                <Card label="Map color" value={r.engine.color.toUpperCase()} sub={r.engine.map_color_hex} swatch={r.engine.map_color_hex} />
                <Card label="Allowed until" value={r.engine.allowed_until ? new Date(r.engine.allowed_until).toLocaleString() : "—"} sub={r.engine.allowed_until ?? ""} />
                <Card label="Source" value={r.segment.data_source} sub={r.segment.external_id ?? r.segment.id.slice(0, 12)} />
              </div>

              <Section title="1 · Raw source data (provider payload as stored)">
                <Json value={r.raw_source} />
              </Section>

              <Section title="2 · Normalization layer output">
                <Json value={{ side: r.normalized.side, classification: r.normalized.classification, rules: r.normalized.rules }} />
              </Section>

              <Section title="3 · Conflict resolution output">
                <Json value={r.conflict_resolved} />
              </Section>

              <Section title="4 · Stored rules (parking_rules table)">
                <Json value={r.stored_rules} />
              </Section>

              {r.stored_events.length > 0 && (
                <Section title="4b · Active / scheduled events">
                  <Json value={r.stored_events} />
                </Section>
              )}

              <Section title={`5 · Engine evaluation @ ${new Date(r.evaluated_at).toLocaleString()} (${r.timezone})`}>
                <Json value={r.engine} />
              </Section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Card({ label, value, sub, swatch }: { label: string; value: string; sub?: string; swatch?: string }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, background: "white" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#64748b" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        {swatch && <span style={{ width: 14, height: 14, borderRadius: 4, background: swatch, border: "1px solid #cbd5e1" }} />}
        <div style={{ fontWeight: 700, fontSize: 16 }}>{value}</div>
      </div>
      {sub && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, wordBreak: "break-all" }}>{sub}</div>}
    </div>
  );
}
