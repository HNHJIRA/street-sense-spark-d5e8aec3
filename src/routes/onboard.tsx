import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import welcome from "@/assets/welcome.png";
import { GradientButton } from "@/components/parkclear/ui";
import { SwipeButton } from "@/components/parkclear/SwipeButton";

export const Route = createFileRoute("/onboard")({
  head: () => ({
    meta: [
      { title: "Welcome to ParkClear" },
      { name: "description", content: "Save time on confusing street parking with ParkClear." },
    ],
  }),
  component: Onboard,
});

const steps = [
  { title: "Snap any sign", body: "Point your camera at a parking sign and let ParkClear do the reading." },
  { title: "Get an instant answer", body: "We tell you Yes or No with the exact time you can stay." },
  { title: "Never miss a move", body: "Set a smart reminder so you're back before the meter runs out." },
];

function Onboard() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const isWelcome = step === 0;
  const advance = () => (step >= 3 ? navigate({ to: "/auth" }) : setStep(step + 1));

  return (
    <main className="safe-top flex min-h-[100dvh] flex-col bg-white px-7 pb-8 font-sans text-slate-900">
      <div className="flex justify-end pt-2">
        <Link to="/auth" className="rounded-full px-3 py-1.5 text-sm font-medium" style={{ color: "var(--pc-brand-end)" }}>
          Skip
        </Link>
      </div>

      {isWelcome ? (
        <div className="flex flex-1 flex-col items-center justify-center">
          <img src={welcome} alt="Welcome to ParkClear" className="h-72 w-auto object-contain" />
          <div className="mt-6 text-center">
            <p className="text-3xl font-semibold leading-tight">Welcome To</p>
            <p className="pc-text-gradient-brand text-4xl font-bold">ParkClear!</p>
          </div>
          <p className="mt-3 max-w-xs text-center text-base text-slate-500">
            Helping you save time and money on confusing street parking.
          </p>
          <div className="mt-10 w-full">
            <SwipeButton label="Swipe To Continue" onComplete={() => setStep(1)} />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="pc-bg-gradient-brand-vert pc-shadow-brand flex h-72 w-72 items-center justify-center rounded-[2rem] text-white">
            <span className="text-7xl font-extrabold">{step}</span>
          </div>
          <h2 className="mt-8 text-center text-2xl font-semibold">{steps[step - 1].title}</h2>
          <p className="mt-3 max-w-xs text-center text-slate-500">{steps[step - 1].body}</p>
          <div className="mt-8 flex gap-2">
            {[1, 2, 3].map((i) => (
              <span
                key={i}
                className="h-2 rounded-full transition-all"
                style={{
                  width: i === step ? "1.5rem" : "0.5rem",
                  background: i === step ? "var(--pc-brand-end)" : "#E5E7EB",
                }}
              />
            ))}
          </div>
          <div className="mt-10 w-full">
            <GradientButton onClick={advance}>{step === 3 ? "Get Started" : "Next"}</GradientButton>
          </div>
        </div>
      )}
    </main>
  );
}
