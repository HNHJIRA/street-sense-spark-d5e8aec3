import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Info, Phone, FileText, Shield, Star, RotateCcw, LogOut, Crown, MessageSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppBar } from "@/components/parkclear/ui";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ParkClear" },
      { name: "description", content: "ParkClear settings, support and account." },
    ],
  }),
  component: Settings,
});

type Row = { icon: LucideIcon; label: string; to?: "/subscription"; danger?: boolean };
const groups: { title: string; rows: Row[] }[] = [
  {
    title: "Subscription",
    rows: [
      { icon: Crown, label: "Remove Ads", to: "/subscription" },
      { icon: RotateCcw, label: "Restore Purchase" },
    ],
  },
  {
    title: "Support & About",
    rows: [
      { icon: Info, label: "About Us" },
      { icon: Phone, label: "Contact Us" },
      { icon: MessageSquare, label: "Feedback" },
      { icon: Star, label: "Rate ParkClear" },
      { icon: Shield, label: "Privacy Policy" },
      { icon: FileText, label: "Terms & Conditions" },
    ],
  },
];

function Settings() {
  return (
    <main className="safe-top min-h-[100dvh] font-sans text-slate-900" style={{ background: "var(--pc-surface)" }}>
      <AppBar title="Settings" />
      <div className="space-y-6 px-5 pt-2 pb-10">
        {groups.map((g) => (
          <div key={g.title}>
            <h3 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{g.title}</h3>
            <div className="pc-shadow-card overflow-hidden rounded-2xl bg-white">
              {g.rows.map(({ icon: Icon, label, to, danger }, i) => {
                const inner = (
                  <div
                    className={`flex items-center gap-3 px-4 py-4 ${i > 0 ? "border-t" : ""}`}
                    style={{ borderColor: "var(--pc-border)" }}
                  >
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full"
                      style={
                        danger
                          ? { background: "#FEECEC", color: "var(--pc-danger)" }
                          : { background: "var(--pc-surface)", color: "var(--pc-brand-end)" }
                      }
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span
                      className="flex-1 text-sm font-medium"
                      style={danger ? { color: "var(--pc-danger)" } : undefined}
                    >
                      {label}
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                );
                return to ? (
                  <Link key={label} to={to}>
                    {inner}
                  </Link>
                ) : (
                  <button key={label} className="block w-full text-left">
                    {inner}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <button
          type="button"
          className="pc-shadow-card flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-4 text-sm font-semibold"
          style={{ color: "var(--pc-danger)" }}
        >
          <LogOut className="h-4 w-4" /> Logout
        </button>
      </div>
    </main>
  );
}
