// First-run onboarding overlay. Explains color system + the four core
// features (Can I Park Here, Forecast, Sign Scanner, Sessions). Records
// completion in the device store so it never shows twice.
import { useEffect, useState } from "react";
import { ChevronRight, MapPin, Clock, ScanLine, Car, X } from "lucide-react";
import { useDeviceStore } from "@/stores/device-store";
import { track } from "@/lib/parking/analytics";
import { cn } from "@/lib/utils";

const SLIDES = [
  {
    title: "Welcome to ParkClear",
    body: "Real-time, color-coded parking for every street.",
    accent: "bg-primary/15 text-primary",
    icon: MapPin,
    content: (
      <div className="space-y-2 text-sm">
        <Legend color="green" label="Allowed" detail="You can park here right now." />
        <Legend color="yellow" label="Restricted" detail="Time limit, permit, or paid parking applies." />
        <Legend color="red" label="No parking" detail="Don't park — sign or event in effect." />
      </div>
    ),
  },
  {
    title: "Can I Park Here?",
    body: "Tap the bottom button — we check your GPS location against the rules engine and give you a YES/NO/LIMITED answer with the time you can stay.",
    accent: "bg-park-green-soft text-park-green",
    icon: MapPin,
  },
  {
    title: "Forecast a future time",
    body: "Open Forecast from the bottom nav to see which streets will be legal at a specific hour. Plan your evening parking before you leave.",
    accent: "bg-primary/15 text-primary",
    icon: Clock,
  },
  {
    title: "AI Sign Scanner",
    body: "Snap any parking sign and the AI extracts the rule, then runs it through the same engine. Useful for temporary signs that aren't in city data yet.",
    accent: "bg-park-yellow-soft text-park-yellow",
    icon: ScanLine,
  },
  {
    title: "Parking Sessions",
    body: "After parking, tap ‘I parked here’. We'll track your time remaining and send alerts at 30, 15, and 5 minutes before your window ends.",
    accent: "bg-park-green-soft text-park-green",
    icon: Car,
  },
];

export function Onboarding() {
  const completed = useDeviceStore((s) => s.onboardingCompletedAt);
  const complete = useDeviceStore((s) => s.completeOnboarding);
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted || completed) return null;

  const finish = () => {
    complete();
    track("onboarding_completed", { steps_viewed: step + 1 });
  };

  const slide = SLIDES[step];
  const Icon = slide.icon;
  const isLast = step === SLIDES.length - 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-border bg-elevated p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", slide.accent)}>
            <Icon className="h-6 w-6" />
          </div>
          <button onClick={finish} className="rounded-full bg-muted p-2 text-muted-foreground hover:text-foreground" aria-label="Skip">
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2 className="mt-5 font-display text-2xl font-extrabold leading-tight">{slide.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{slide.body}</p>

        {"content" in slide && slide.content && <div className="mt-4">{slide.content}</div>}

        <div className="mt-6 flex items-center justify-center gap-1.5">
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={cn("h-1.5 rounded-full transition-all", i === step ? "w-6 bg-primary" : "w-1.5 bg-muted")}
            />
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          {step > 0 && (
            <button onClick={() => setStep((s) => s - 1)} className="flex-1 rounded-full bg-muted py-3 text-sm font-semibold">
              Back
            </button>
          )}
          <button
            onClick={() => isLast ? finish() : setStep((s) => s + 1)}
            className="flex-1 rounded-full bg-primary py-3 text-sm font-bold text-primary-foreground inline-flex items-center justify-center gap-1"
          >
            {isLast ? "Get started" : "Next"} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {!isLast && (
          <button onClick={finish} className="mt-3 w-full text-center text-[11px] text-muted-foreground">
            Skip intro
          </button>
        )}
      </div>
    </div>
  );
}

function Legend({ color, label, detail }: { color: "green" | "yellow" | "red"; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-surface px-3 py-2">
      <span className={cn("mt-1 h-3 w-3 shrink-0 rounded-full", {
        "bg-park-green": color === "green",
        "bg-park-yellow": color === "yellow",
        "bg-park-red": color === "red",
      })} />
      <div>
        <div className="text-sm font-bold">{label}</div>
        <div className="text-[11px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}
