// Validation suite — extends the debug pipeline with the engine explanation.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getSegmentDebug, listDebugSegments } from "@/lib/parking/debug.functions";
import { explainSegment } from "@/lib/parking/admin.functions";

export const Route = createFileRoute("/admin/validation")({
  head: () => ({ meta: [{ title: "Validation Suite · Admin" }] }),
  component: ValidationPage,
});

function ValidationPage() {
  const listFn = useServerFn(listDebugSegments);
  const debugFn = useServerFn(getSegmentDebug);
  const explainFn = useServerFn(explainSegment);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [atInput, setAtInput] = useState("");
  const [tz, setTz] = useState("America/Los_Angeles");

  const listQ = useQuery({
    queryKey: ["val-list", search],
    queryFn: () => listFn({ data: { citySlug: "seattle", limit: 100, search: search || null } }),
  });

  const atIso = useMemo(() => {
    if (!atInput) return null;
    const d = new Date(atInput);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }, [atInput]);

  const reportQ = useQuery({
    queryKey: ["val-report", selectedId, atIso, tz],
    queryFn: () => debugFn({ data: { id: selectedId!, at: atIso, timezone: tz } }),
    enabled: !!selectedId,
  });
  const explainQ = useQuery({
    queryKey: ["val-explain", selectedId, atIso, tz],
    queryFn: () => explainFn({ data: { segmentId: selectedId!, at: atIso, timezone: tz } }),
    enabled: !!selectedId,
  });

  const r = reportQ.data;
  const e = explainQ.data;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16 }}>
      <aside style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
        <input
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
          placeholder="Search street…"
          style={{ width: "100%", padding: 8, border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, marginBottom: 8 }}
        />
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>{listQ.data?.length ?? 0} segments</div>
        <div style={{ maxHeight: "70vh", overflow: "auto" }}>
          {(listQ.data ?? []).map((s) => (
            <button key={s.id} onClick={() => setSelectedId(s.id)} style={{
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

      <main style={{ display: "grid", gap: 14 }}>
        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ fontSize: 12 }}>Date / time:&nbsp;
            <input type="datetime-local" value={atInput} onChange={(ev) => setAtInput(ev.target.value)} style={S.input} />
          </label>
          <label style={{ fontSize: 12 }}>Timezone:&nbsp;
            <select value={tz} onChange={(ev) => setTz(ev.target.value)} style={S.input}>
              <option>America/Los_Angeles</option>
              <option>America/New_York</option>
              <option>America/Chicago</option>
              <option>America/Denver</option>
            </select>
          </label>
          <button onClick={() => setAtInput("")} style={S.btn}>Now</button>
        </section>

        {!selectedId && <Empty>Select a segment to validate its parking decision.</Empty>}

        {e && (
          <section style={{
            background: e.color === "red" ? "#fef2f2" : e.color === "yellow" ? "#fefce8" : "#f0fdf4",
            border: `1px solid ${e.color === "red" ? "#fca5a5" : e.color === "yellow" ? "#fde047" : "#86efac"}`,
            borderRadius: 12, padding: 18,
          }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "#475569" }}>Engine explanation · {e.segment_name}</div>
            <div style={{ fontSize: 26, fontWeight: 900, marginTop: 4, color: e.color === "red" ? "#991b1b" : e.color === "yellow" ? "#854d0e" : "#166534" }}>
              {e.headline}
            </div>
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <Field label="Reason" value={e.reason} />
              <Field label="Active" value={e.active_window ?? "—"} />
              <Field label="Permit zone" value={e.permit_zone ?? "—"} />
              <Field label="Time limit" value={e.time_limit ?? "—"} />
              <Field label="Allowed until" value={e.allowed_until ? new Date(e.allowed_until).toLocaleString() : "—"} />
              <Field label="Source" value={e.source} />
            </div>
            {e.notes && <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>Notes: {e.notes}</div>}
          </section>
        )}

        {r && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              <Card label="Engine decision" value={r.engine.label} sub={r.engine.code} />
              <Card label="Color" value={r.engine.color.toUpperCase()} sub={r.engine.map_color_hex} swatch={r.engine.map_color_hex} />
              <Card label="Allowed until" value={r.engine.allowed_until ? new Date(r.engine.allowed_until).toLocaleString() : "—"} />
              <Card label="Source" value={r.segment.data_source} sub={r.segment.external_id ?? r.segment.id.slice(0, 12)} />
            </div>

            <Pane title="Raw SDOT data"><Pre>{r.raw_source_json}</Pre></Pane>
            <Pane title="Normalized rules"><Pre>{JSON.stringify(r.normalized, null, 2)}</Pre></Pane>
            <Pane title="Conflict resolution result"><Pre>{JSON.stringify(r.conflict_resolved, null, 2)}</Pre></Pane>
            <Pane title="Active stored rules"><Pre>{JSON.stringify(r.stored_rules, null, 2)}</Pre></Pane>
            <Pane title={`Engine evaluation @ ${new Date(r.evaluated_at).toLocaleString()} (${r.timezone})`}><Pre>{JSON.stringify(r.engine, null, 2)}</Pre></Pane>
          </>
        )}
      </main>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#64748b" }}>{label}</div><div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{value}</div></div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 30, textAlign: "center", color: "#64748b" }}>{children}</div>;
}
function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#64748b", marginBottom: 6 }}>{title}</div>
      <div style={{ background: "#0b1220", color: "#e2e8f0", padding: 12, borderRadius: 8, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, overflow: "auto", maxHeight: 320 }}>{children}</div>
    </section>
  );
}
function Pre({ children }: { children: React.ReactNode }) {
  return <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{children}</pre>;
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

const S = {
  input: { padding: 6, border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 },
  btn: { padding: "6px 12px", border: "1px solid #cbd5e1", borderRadius: 6, background: "white", cursor: "pointer", fontSize: 12 },
};
