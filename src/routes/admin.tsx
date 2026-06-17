import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin · Parking Intelligence" }] }),
  component: AdminLayout,
});

const TABS = [
  { to: "/admin/health", label: "Health" },
  { to: "/admin/accuracy", label: "Accuracy" },
  { to: "/admin/provider-sync", label: "Provider Sync" },
  { to: "/admin/validation", label: "Validation" },
  { to: "/admin/forecast", label: "Forecast" },
  { to: "/admin/analytics", label: "Analytics" },
  { to: "/admin/reports", label: "Reports" },
  { to: "/admin/beta-readiness", label: "Beta Readiness" },
  { to: "/admin/la-coverage", label: "LA Coverage" },
  { to: "/admin/arlington-coverage", label: "Arlington Coverage" },
] as const;

function AdminLayout() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", color: "#0f172a", background: "#f8fafc", minHeight: "100vh" }}>
      <header style={{ borderBottom: "1px solid #e2e8f0", background: "white" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1.2 }}>Internal · Phase 1.5</div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Parking Intelligence Admin</h1>
          </div>
          <nav style={{ display: "flex", gap: 6 }}>
            {TABS.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                activeProps={{ style: { background: "#0f172a", color: "white" } }}
                style={{ padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, color: "#475569", textDecoration: "none", border: "1px solid #e2e8f0", background: "white" }}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: 24 }}>
        <Outlet />
      </main>
    </div>
  );
}
