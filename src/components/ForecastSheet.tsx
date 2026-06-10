import { useState } from "react";
import { X, Clock } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

const QUICK_HOURS = [9, 12, 15, 17, 19, 21];

function setHour(base: Date, hour: number): Date {
  const d = new Date(base);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

function setHourMinute(base: Date, hour: number, minute: number, allowPast: boolean): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  if (!allowPast && d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

function toTimeInputValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ForecastSheet() {
  const open = useAppStore((s) => s.forecastOpen);
  const setOpen = useAppStore((s) => s.setForecastOpen);
  const setForecastAt = useAppStore((s) => s.setForecastAt);
  const forecastAt = useAppStore((s) => s.forecastAt);
  const [day, setDay] = useState<0 | 1 | 2>(0);
  const [customTime, setCustomTime] = useState<string>(() => toTimeInputValue(forecastAt ?? new Date()));

  if (!open) return null;

  const dayBase = (() => {
    const d = new Date();
    d.setDate(d.getDate() + day);
    return d;
  })();

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="absolute inset-x-0 bottom-0 z-50 safe-bottom animate-in slide-in-from-bottom duration-200">
        <div className="mx-auto max-w-md px-3 pb-3">
          <div className="rounded-3xl border border-border bg-elevated p-5 shadow-2xl">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" />
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-display text-xl font-bold leading-tight">Forecast parking</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">See what's legal at a future time.</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-full bg-muted p-2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { i: 0, label: "Today" },
                { i: 1, label: "Tomorrow" },
                { i: 2, label: "In 2 days" },
              ].map((d) => (
                <button
                  key={d.i}
                  onClick={() => setDay(d.i as 0 | 1 | 2)}
                  className={cn(
                    "rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                    day === d.i
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-surface text-muted-foreground",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {QUICK_HOURS.map((h) => {
                const target = setHour(dayBase, h);
                const isActive = forecastAt?.getTime() === target.getTime();
                return (
                  <button
                    key={h}
                    onClick={() => {
                      setForecastAt(target);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 transition",
                      isActive
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-surface text-foreground",
                    )}
                  >
                    <Clock className="h-4 w-4 opacity-70" />
                    <span className="text-sm font-bold">
                      {((h + 11) % 12) + 1} {h < 12 ? "AM" : "PM"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-2xl border border-border bg-surface p-3">
              <label className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-muted-foreground">Pick a custom time</span>
                <input
                  type="time"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                  className="rounded-xl border border-border bg-elevated px-3 py-2 text-sm font-bold text-foreground focus:border-primary focus:outline-none"
                />
              </label>
              <button
                onClick={() => {
                  const [hh, mm] = customTime.split(":").map((n) => parseInt(n, 10));
                  if (isNaN(hh) || isNaN(mm)) return;
                  const target = setHourMinute(dayBase, hh, mm, day > 0);
                  setForecastAt(target);
                  setOpen(false);
                }}
                className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground"
              >
                Apply custom time
              </button>
            </div>


            <button
              onClick={() => {
                setForecastAt(null);
                setOpen(false);
              }}
              className="mt-5 w-full rounded-2xl border border-border bg-surface py-3 text-sm font-bold"
            >
              Return to Live Mode
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
