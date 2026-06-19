import { useEffect, useState } from "react";
import { X, Search, MapPin, Loader2, Clock, Trash2 } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDeviceStore } from "@/stores/device-store";

interface MapboxFeature {
  id: string;
  place_name: string;
  text: string;
  center: [number, number];
}

const SEATTLE_PROX = "-122.3321,47.6062";

export function SearchSheet({ token }: { token: string }) {
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const setFlyTo = useAppStore((s) => s.setFlyTo);
  const setDestination = useAppStore((s) => s.setDestination);
  const history = useDeviceStore((s) => s.searchHistory);
  const pushSearch = useDeviceStore((s) => s.pushSearch);
  const removeSearch = useDeviceStore((s) => s.removeSearch);
  const clearHistory = useDeviceStore((s) => s.clearSearchHistory);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<MapboxFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      setResults([]); setError(null); setLoading(false);
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
        setError((e as Error).message); setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [q, open, token]);

  if (!open) return null;

  const choose = (f: { center: [number, number]; place_name: string; text: string }) => {
    setFlyTo({ lng: f.center[0], lat: f.center[1], zoom: 17 });
    pushSearch({ query: f.text, placeName: f.place_name, coordinates: f.center });
    setDestination({ name: f.text, placeName: f.place_name, lng: f.center[0], lat: f.center[1] });
    setOpen(false); setQ("");
  };

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="absolute inset-x-0 top-0 z-50 safe-top animate-in slide-in-from-top duration-200">
        <div className="mx-auto max-w-md px-3 pb-3">
          <div className="pc-shadow-card rounded-3xl border border-[var(--pc-border)] bg-white p-4 text-slate-900">
            <div className="flex items-center gap-2 rounded-full bg-[var(--pc-surface)] px-3 py-2.5">
              <Search className="h-5 w-5" style={{ color: "var(--pc-brand-end)" }} />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Address, landmark, neighborhood…"
                className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              <button onClick={() => setOpen(false)} className="pc-bg-gradient-brand rounded-full p-1.5 text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 max-h-[55vh] overflow-y-auto">
              {q.trim().length < 2 && (
                <>
                  {history.length === 0 ? (
                    <div className="px-2 py-1 text-xs text-muted-foreground">
                      Try "Space Needle", "Pike Place Market", or an address.
                    </div>
                  ) : (
                    <>
                      <div className="mb-1 flex items-center justify-between px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        <span>Recent</span>
                        <button onClick={clearHistory} className="text-[10px] font-medium normal-case text-muted-foreground hover:text-foreground">Clear</button>
                      </div>
                      {history.map((h) => (
                        <div key={h.id} className="group flex items-center gap-1">
                          <button
                            onClick={() => choose({ center: h.coordinates, place_name: h.placeName, text: h.query })}
                            className="flex flex-1 items-start gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-surface"
                          >
                            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{h.query}</div>
                              <div className="truncate text-xs text-muted-foreground">{h.placeName}</div>
                            </div>
                          </button>
                          <button
                            onClick={() => removeSearch(h.id)}
                            className="rounded-full p-2 text-muted-foreground opacity-0 transition group-hover:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
              {loading && (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
                </div>
              )}
              {!loading && error && (
                <div className="px-2 py-3 text-xs text-park-red">Couldn't search: {error}</div>
              )}
              {!loading && !error && q.trim().length >= 2 && results.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground">No matches for "{q}".</div>
              )}
              {results.map((f) => (
                <button
                  key={f.id}
                  onClick={() => choose(f)}
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
