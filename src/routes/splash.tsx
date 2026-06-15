import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/splash")({
  head: () => ({
    meta: [
      { title: "ParkClear" },
      { name: "description", content: "Parking made simple and clear." },
    ],
  }),
  component: Splash,
});

function Splash() {
  const navigate = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => navigate({ to: "/onboard" }), 1400);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-white font-sans">
      <div className="duration-700 animate-in fade-in zoom-in-50">
        <div className="pc-bg-gradient-brand pc-shadow-brand flex h-40 w-40 items-center justify-center rounded-3xl">
          <span className="text-6xl font-extrabold text-white">P</span>
        </div>
        <h1 className="mt-6 text-center text-3xl font-bold text-slate-900">
          Park<span className="pc-text-gradient-brand">Clear</span>
        </h1>
        <p className="mt-1 text-center text-sm text-slate-500">Parking made simple and clear</p>
      </div>
    </main>
  );
}
