import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, X } from "lucide-react";

export const Route = createFileRoute("/subscription")({
  head: () => ({
    meta: [
      { title: "Upgrade — ParkClear Pro" },
      { name: "description", content: "Unlock unlimited scans and remove ads with ParkClear Pro." },
    ],
  }),
  component: Subscription,
});

const features = [
  "Unlimited parking scans",
  "Smart reminders & alerts",
  "Ad-free experience",
  "Priority AI accuracy",
];

const plans = [
  { id: "year", title: "Yearly", price: "$29.99", sub: "$2.50 / mo · Save 50%", featured: true },
  { id: "month", title: "Monthly", price: "$4.99", sub: "Billed every month" },
  { id: "week", title: "Weekly", price: "$1.99", sub: "Billed every week" },
];

function Subscription() {
  const navigate = useNavigate();
  return (
    <main className="safe-top relative min-h-[100dvh] overflow-hidden bg-white font-sans text-slate-900">
      <div className="pc-bg-gradient-brand-vert absolute inset-x-0 top-0 h-72" />
      <button
        onClick={() => navigate({ to: "/dashboard" })}
        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/30 text-white"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="relative px-6 pt-12 text-white">
        <h1 className="text-3xl font-bold leading-tight">Unlock ParkClear Pro</h1>
        <p className="mt-2 text-sm/6 opacity-90">Every scan, every reminder — no limits, no ads.</p>
      </div>

      <ul className="pc-shadow-card relative mx-5 mt-6 rounded-3xl bg-white p-5">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-3 py-2 text-sm">
            <span className="pc-bg-gradient-brand flex h-6 w-6 items-center justify-center rounded-full text-white">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-col gap-3 px-5">
        {plans.map((p) => (
          <label
            key={p.id}
            className="flex cursor-pointer items-center justify-between rounded-2xl border-2 px-5 py-4"
            style={
              p.featured
                ? { borderColor: "var(--pc-brand-end)", background: "#EDF4FE" }
                : { borderColor: "var(--pc-border)" }
            }
          >
            <div>
              <div className="flex items-center gap-2 text-base font-semibold">
                {p.title}
                {p.featured && (
                  <span className="pc-bg-gradient-brand rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                    Best
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500">{p.sub}</div>
            </div>
            <div className="text-lg font-bold">{p.price}</div>
          </label>
        ))}
      </div>

      <div className="safe-bottom mt-auto px-5 pb-8 pt-6">
        <button
          onClick={() => navigate({ to: "/dashboard" })}
          className="pc-bg-gradient-brand pc-shadow-brand w-full rounded-2xl py-4 text-base font-semibold text-white"
        >
          Start 7-day Free Trial
        </button>
        <p className="mt-3 text-center text-xs text-slate-500">Cancel anytime. Auto-renews after trial.</p>
      </div>
    </main>
  );
}
