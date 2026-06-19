import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, Camera, User, Share2, X, LogOut, Settings as SettingsIcon, Bell, Crown, Map as MapIcon } from "lucide-react";
import car from "@/assets/car.png";
import { GradientButton, IconBubble } from "@/components/parkclear/ui";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — ParkClear" },
      { name: "description", content: "Snap a parking sign and find out if you can park here." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [drawer, setDrawer] = useState(false);
  const navigate = useNavigate();

  return (
    <main className="relative min-h-[100dvh] overflow-hidden font-sans text-slate-900">
      <div className="pc-bg-gradient-brand-vert absolute inset-0" />

      <div className="safe-top relative flex min-h-[100dvh] flex-col">
        <header className="flex items-center justify-between px-5 pt-3">
          <button
            onClick={() => setDrawer(true)}
            className="pc-shadow-card flex h-12 w-12 items-center justify-center rounded-full bg-white"
          >
            <Menu className="h-5 w-5" style={{ color: "var(--pc-brand-end)" }} />
          </button>
          <Link
            to="/subscription"
            className="pc-shadow-card flex h-12 w-12 items-center justify-center rounded-full bg-white"
          >
            <Crown className="h-5 w-5 text-amber-500" />
          </Link>
        </header>

        <div className="flex flex-1 flex-col items-center px-5 pt-6 pb-72">
          <img src={car} alt="Your car" className="h-64 w-full max-w-sm object-contain drop-shadow-2xl" />
          <CurrentTime />
        </div>

        <div
          className="safe-bottom absolute inset-x-0 bottom-0 rounded-t-[2rem] bg-white px-6 pt-6"
          style={{ boxShadow: "0 -8px 24px rgba(0,0,0,0.08)" }}
        >
          <GradientButton onClick={() => navigate({ to: "/scan" })}>Can I Park Here?</GradientButton>
          <div className="mt-5 flex items-center justify-between">
            <IconBubble onClick={() => navigate({ to: "/profile" })}>
              <User className="h-6 w-6" style={{ color: "var(--pc-brand-end)" }} />
            </IconBubble>
            <IconBubble onClick={() => navigate({ to: "/scan" })}>
              <Camera className="h-6 w-6" style={{ color: "var(--pc-brand-end)" }} />
            </IconBubble>
            <IconBubble onClick={() => navigate({ to: "/" })}>
              <MapIcon className="h-6 w-6" style={{ color: "var(--pc-brand-end)" }} />
            </IconBubble>
            <IconBubble
              onClick={() => {
                if (typeof navigator !== "undefined" && "share" in navigator) {
                  navigator.share?.({ title: "ParkClear", text: "Check out ParkClear" }).catch(() => {});
                }
              }}
            >
              <Share2 className="h-6 w-6" style={{ color: "var(--pc-brand-end)" }} />
            </IconBubble>
          </div>
        </div>
      </div>

      <SideDrawer open={drawer} onClose={() => setDrawer(false)} />
    </main>
  );
}

function CurrentTime() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  if (!now) return <div className="mt-6 h-16" />;
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  const date = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  return (
    <div className="mt-6 text-center text-white">
      <div className="text-5xl font-semibold tabular-nums tracking-tight">{time}</div>
      <div className="mt-1 text-sm/6 opacity-90">{date}</div>
    </div>
  );
}

function SideDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = [
    { icon: User, label: "My Profile", to: "/profile" as const },
    { icon: SettingsIcon, label: "Settings", to: "/settings" as const },
    { icon: Bell, label: "Active Alerts", to: "/alerts" as const },
    { icon: MapIcon, label: "Map", to: "/" as const },
    { icon: Crown, label: "Upgrade", to: "/subscription" as const },
  ];
  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}>
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        className={`absolute inset-y-0 left-0 w-[82%] max-w-sm shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          background: "linear-gradient(90deg, var(--pc-brand-end) 0%, var(--pc-brand-start) 100%)",
        }}
      >
        <div className="safe-top relative flex h-full flex-col px-5 pt-6 pb-8 text-white">
          <button
            onClick={onClose}
            className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/15"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-xl font-semibold">
              JD
            </div>
            <div>
              <div className="font-semibold">John Doe</div>
              <div className="text-xs opacity-90">john@parkclear.app</div>
            </div>
          </div>
          <nav className="flex flex-1 flex-col">
            {items.map(({ icon: Icon, label, to }) => (
              <Link
                key={label}
                to={to}
                onClick={onClose}
                className="flex items-center gap-4 py-3.5 text-[17px] font-medium tracking-wide text-white"
              >
                <span className="flex w-7 items-center justify-center">
                  <Icon className="h-6 w-6" strokeWidth={2.2} />
                </span>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </aside>
    </div>
  );
}
