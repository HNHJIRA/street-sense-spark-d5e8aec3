import { ArrowRight } from "lucide-react";
import { useRef, useState, useEffect } from "react";

export function SwipeButton({
  label = "Swipe To Continue",
  onComplete,
}: {
  label?: string;
  onComplete: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);
  const startRef = useRef(0);
  const maxRef = useRef(0);

  const computeMax = () => {
    const track = trackRef.current;
    if (!track) return 0;
    return track.clientWidth - 56; // knob = 56px
  };

  const onStart = (clientX: number) => {
    if (done) return;
    maxRef.current = computeMax();
    startRef.current = clientX - x;
    setDragging(true);
  };
  const onMove = (clientX: number) => {
    if (!dragging) return;
    const next = Math.max(0, Math.min(maxRef.current, clientX - startRef.current));
    setX(next);
  };
  const onEnd = () => {
    if (!dragging) return;
    setDragging(false);
    if (x >= maxRef.current - 4) {
      setX(maxRef.current);
      setDone(true);
      setTimeout(() => {
        onComplete();
        setX(0);
        setDone(false);
      }, 200);
    } else {
      setX(0);
    }
  };

  useEffect(() => {
    if (!dragging) return;
    const mm = (e: MouseEvent) => onMove(e.clientX);
    const mu = () => onEnd();
    const tm = (e: TouchEvent) => onMove(e.touches[0].clientX);
    const tu = () => onEnd();
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
    window.addEventListener("touchmove", tm, { passive: false });
    window.addEventListener("touchend", tu);
    return () => {
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("touchmove", tm);
      window.removeEventListener("touchend", tu);
    };
  }, [dragging, x]);

  return (
    <div
      ref={trackRef}
      className="relative h-16 w-full select-none rounded-full"
      style={{ background: "var(--pc-surface)" }}
    >
      <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-900">
        {label} →
      </div>
      <div
        onMouseDown={(e) => onStart(e.clientX)}
        onTouchStart={(e) => onStart(e.touches[0].clientX)}
        className="absolute left-1 top-1 flex h-14 w-14 cursor-grab items-center justify-center rounded-full bg-white active:cursor-grabbing"
        style={{
          transform: `translateX(${x}px)`,
          transition: dragging ? "none" : "transform 200ms ease",
          border: "2px solid var(--pc-brand-end)",
          touchAction: "none",
        }}
      >
        <ArrowRight className="h-5 w-5" style={{ color: "var(--pc-brand-end)" }} />
      </div>
    </div>
  );
}
