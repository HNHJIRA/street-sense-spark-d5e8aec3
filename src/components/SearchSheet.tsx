import { useEffect, useState } from "react";
import { X, Search, MapPin, Loader2 } from "lucide-react";
import { useAppStore } from "@/stores/app-store";

interface MapboxFeature {
  id: string;
  place_name: string;
  text: string;
  center: [number, number];
}

// Seattle center — used as a proximity bias so local matches rank first
// (NOT as a hard bbox, so users can still search anything).
const SEATTLE_PROX = "-122.3321,47.6062";

export function SearchSheet({ token }: { token: string }) {
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const setFlyTo = useAppStore((s) => s.setFlyTo);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MapboxFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&proximity=${SEATTLE_PROX}&limit=6&types=address,poi,place,neighborhood,locality`;
        const res = await fetch(url, { signal: ctl.signal });
        if (!res.ok) throw new Error(`Mapbox ${res.status}`);
        const json = (await res.json()) as { features?: MapboxFeature[] };
        setResults(json.features ?? []);
        setError(null);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [q, open, token]);

  if (!open) return null;

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="absolute inset-x-0 top-0 z-50 safe-top animate-in slide-in-from-top duration-200">
        <div className="mx-auto max-w-md px-3 pb-3">
          <div className="rounded-3xl border border-border bg-elevated p-4 shadow-2xl">
            <div className="flex items-center gap-2 rounded-full bg-surface px-3 py-2.5">
              <Search className="h-5 w-5 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Address, landmark, neighborhood…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button onClick={() => setOpen(false)} className="rounded-full bg-muted p-1.5 text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 max-h-[55vh] overflow-y-auto">
              {q.trim().length < 2 && (
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  Try "Space Needle", "Pike Place Market", or an address.
                </div>
              )}
              {results.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setFlyTo({ lng: f.center[0], lat: f.center[1], zoom: 17 });
                    setOpen(false);
                    setQ("");
                  }}
                  className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left hover:bg-surface"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{f.text}</div>
                    <div className="truncate text-xs text-muted-foreground">{f.place_name}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
