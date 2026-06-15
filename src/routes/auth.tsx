import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { GradientButton } from "@/components/parkclear/ui";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — ParkClear" },
      { name: "description", content: "Sign in or create your ParkClear account." },
    ],
  }),
  component: Auth,
});

function Auth() {
  const [tab, setTab] = useState<"in" | "up">("in");
  const navigate = useNavigate();
  return (
    <main className="safe-top flex min-h-[100dvh] flex-col bg-white px-5 pt-6 pb-8 font-sans text-slate-900">
      <h1 className="text-2xl font-semibold">Parking Made Simple and Clear</h1>
      <p className="mt-1 text-sm text-slate-500">Get great experience with ParkClear</p>

      <div className="mt-8 flex rounded-full p-1" style={{ background: "var(--pc-surface)" }}>
        {(["in", "up"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full py-2.5 text-sm font-medium transition ${
              tab === t ? "pc-shadow-card bg-white text-slate-900" : "text-slate-500"
            }`}
          >
            {t === "in" ? "Sign In" : "Sign Up"}
          </button>
        ))}
      </div>

      <form
        className="mt-7 flex flex-1 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ to: "/dashboard" });
        }}
      >
        {tab === "up" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name" placeholder="Enter first name" />
            <Field label="Last Name" placeholder="Enter last name" />
          </div>
        )}
        <Field label="Email" type="email" placeholder="Enter your email address" />
        <Field label="Password" type="password" placeholder="Enter your password" />
        {tab === "up" && <Field label="Confirm password" type="password" placeholder="Enter your confirm password" />}
        {tab === "in" && (
          <button type="button" className="-mt-1 self-end text-sm font-medium" style={{ color: "var(--pc-brand-end)" }}>
            Forgot Password?
          </button>
        )}

        <div className="mt-auto pt-6">
          <GradientButton type="submit">{tab === "in" ? "Sign In" : "Create Account"}</GradientButton>

          <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
            <span className="h-px flex-1" style={{ background: "var(--pc-border)" }} />
            Or {tab === "in" ? "Sign in" : "Sign up"} With
            <span className="h-px flex-1" style={{ background: "var(--pc-border)" }} />
          </div>
          <button
            type="button"
            onClick={() => navigate({ to: "/dashboard" })}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border bg-white py-3.5 text-sm font-medium text-slate-900"
            style={{ borderColor: "var(--pc-border)" }}
          >
            <span className="text-lg font-bold" style={{ color: "var(--pc-brand-end)" }}>G</span> Sign in with Google
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...rest}
        className="mt-1.5 w-full rounded-2xl border border-transparent px-4 py-3.5 text-sm outline-none focus:bg-white"
        style={{ background: "var(--pc-surface)" }}
      />
    </label>
  );
}
