import { createFileRoute } from "@tanstack/react-router";
import { Bookmark } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/saved")({
  head: () => ({ meta: [{ title: "Saved spots — ParkClear" }] }),
  component: SavedPage,
});

function SavedPage() {
  return (
    <div className="relative min-h-screen bg-background pb-32">
      <div className="safe-top mx-auto max-w-md px-5 pt-6">
        <h1 className="font-display text-2xl font-bold">Saved spots</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bookmark your favorite blocks to check them in one tap.
        </p>
        <div className="mt-8 rounded-3xl border border-dashed border-border bg-surface/50 p-8 text-center">
          <Bookmark className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No saved spots yet. Tap any street on the map and save it for later.
          </p>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
