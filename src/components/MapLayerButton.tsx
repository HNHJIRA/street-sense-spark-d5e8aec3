// Compact floating layer switcher for any Mapbox surface. Reads/writes the
// shared useMapTypeStore so every map in the app stays in sync.
import { useEffect, useRef, useState } from "react";
import { Layers, Check } from "lucide-react";
import { useMapTypeStore, type MapType } from "@/stores/map-type-store";
import { cn } from "@/lib/utils";

const OPTIONS: { value: MapType; label: string; hint: string }[] = [
  { value: "standard", label: "Standard", hint: "Road map" },
  { value: "satellite", label: "Satellite", hint: "Imagery only" },
  { value: "hybrid", label: "Hybrid", hint: "Imagery + labels" },
];

interface Props {
  /** Optional class overrides for positioning (defaults to bottom-right). */
  className?: string;
}

export function MapLayerButton({ className }: Props) {
  const mapType = useMapTypeStore((s) => s.mapType);
  const setMapType = useMapTypeStore((s) => s.setMapType);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("touchstart", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("touchstart", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "pointer-events-auto absolute z-20 flex flex-col items-end gap-2",
        className,
      )}
    >
      {open && (
        <div
          role="menu"
          aria-label="Map layer"
          className="min-w-[180px] overflow-hidden rounded-2xl bg-white text-neutral-800 shadow-xl ring-1 ring-black/10 animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          {OPTIONS.map((opt) => {
            const active = mapType === opt.value;
            return (
              <button
                key={opt.value}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { setMapType(opt.value); setOpen(false); }}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition active:bg-neutral-100",
                  active && "bg-neutral-50",
                )}
              >
                <span>
                  <span className="block text-sm font-semibold">{opt.label}</span>
                  <span className="block text-[11px] text-neutral-500">{opt.hint}</span>
                </span>
                {active && <Check className="h-4 w-4 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change map layer"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-neutral-800 shadow-lg ring-1 ring-black/5 transition hover:bg-neutral-50 active:scale-95"
      >
        <Layers className="h-5 w-5" />
      </button>
    </div>
  );
}
