import { createFileRoute } from "@tanstack/react-router";
import { User, MapPin, ShieldCheck } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profile — ParkClear" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <div className="relative min-h-screen bg-background pb-32">
      <div className="safe-top mx-auto max-w-md px-5 pt-6">
        <h1 className="font-display text-2xl font-bold">Profile</h1>
        <div className="mt-6 flex items-center gap-4 rounded-3xl bg-surface p-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <User className="h-7 w-7" />
          </div>
          <div>
            <div className="text-sm font-semibold">Guest</div>
            <div className="text-xs text-muted-foreground">Sign-in coming soon</div>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <Row icon={MapPin} label="Current city" value="Seattle, WA" />
          <Row icon={ShieldCheck} label="Data source" value="Seattle (seed) · CurbIQ-ready" />
        </div>

        <p className="mt-8 px-1 text-[11px] text-muted-foreground">
          ParkClear shows parking legality based on posted city rules. Always verify the sign on the
          street before parking — rules change.
        </p>
      </div>
      <BottomNav />
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
