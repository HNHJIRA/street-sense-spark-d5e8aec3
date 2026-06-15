import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import { AppBar } from "@/components/parkclear/ui";

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "Active Alerts — ParkClear" },
      { name: "description", content: "Your active and passed parking alerts." },
    ],
  }),
  component: Alerts,
});

const mock = {
  Active: [
    { addr: "200 Market St", until: "4:30 PM", remind: "4:20 PM" },
    { addr: "Castro & 18th", until: "6:00 PM", remind: "5:50 PM" },
  ],
  Passed: [{ addr: "Mission & 22nd", until: "Yesterday, 2:00 PM", remind: "" }],
};

function Alerts() {
  const [tab, setTab] = useState<"Active" | "Passed">("Active");
  const rows = mock[tab];
  return (
    <main className="safe-top min-h-[100dvh] font-sans text-slate-900" style={{ background: "var(--pc-surface)" }}>
      <AppBar title="Active Alerts" />
      <div className="px-5">
        <div className="pc-shadow-card mt-2 flex rounded-full bg-white p-1">
          {(["Active", "Passed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-full py-2.5 text-sm font-medium transition ${
                tab === t ? "pc-bg-gradient-brand text-white" : "text-slate-500"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 pb-10">
          {rows.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-500">No {tab.toLowerCase()} alerts</p>
          ) : (
            rows.map((a, i) => (
              <div key={i} className="pc-shadow-card flex items-center gap-4 rounded-2xl bg-white p-4">
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-full"
                  style={{ background: "#EAF2FE", color: "var(--pc-brand-end)" }}
                >
                  <Bell className="h-5 w-5" />
                </span>
                <div className="flex-1">
                  <div className="font-semibold">{a.addr}</div>
                  <div className="text-xs text-slate-500">
                    Parking until {a.until}
                    {a.remind && ` · Remind ${a.remind}`}
                  </div>
                </div>
                <button className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
