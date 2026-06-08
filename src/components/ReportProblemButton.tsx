// Report-a-problem dialog. Used on every result screen so users can flag
// incorrect parking results, bad sign reads, or wrong street data.
import { useState } from "react";
import { Flag, X, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { sendReport, type ReportInput } from "@/lib/parking/analytics";
import { cn } from "@/lib/utils";

interface Props {
  surface: ReportInput["surface"];
  segmentId?: string | null;
  scanId?: string | null;
  context?: Record<string, unknown>;
  /** Visual variant — defaults to a small ghost button. */
  variant?: "ghost" | "outline";
}

const TYPES: { value: ReportInput["type"]; label: string; help: string }[] = [
  { value: "incorrect_result", label: "Incorrect parking result", help: "The engine said the wrong thing for this spot." },
  { value: "wrong_sign", label: "Wrong sign interpretation", help: "The AI mis-read the sign." },
  { value: "wrong_street_data", label: "Wrong street data", help: "The street name, side, or rules look wrong." },
  { value: "other", label: "Something else", help: "Anything else worth flagging." },
];

export function ReportProblemButton({ surface, segmentId, scanId, context, variant = "ghost" }: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ReportInput["type"]>("incorrect_result");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!message.trim()) {
      toast.error("Add a short description so we can investigate.");
      return;
    }
    setBusy(true);
    const res = await sendReport({
      type, surface,
      segmentId: segmentId ?? null,
      scanId: scanId ?? null,
      message: message.trim(),
      context,
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      toast.success("Thanks — report submitted.");
      setTimeout(() => { setOpen(false); setDone(false); setMessage(""); }, 1200);
    } else {
      toast.error(res.error);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold",
          variant === "outline"
            ? "border border-border text-muted-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Flag className="h-3 w-3" /> Report a problem
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-3" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-md rounded-3xl border border-border bg-elevated p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Report a problem</div>
                <h3 className="font-display text-lg font-bold">Help us improve accuracy</h3>
              </div>
              <button onClick={() => !busy && setOpen(false)} className="rounded-full bg-muted p-2 text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {done ? (
              <div className="my-6 flex flex-col items-center gap-2 text-park-green">
                <CheckCircle2 className="h-8 w-8" />
                <div className="text-sm font-bold">Report submitted</div>
              </div>
            ) : (
              <>
                <ul className="mt-3 space-y-1.5">
                  {TYPES.map((t) => (
                    <li key={t.value}>
                      <button
                        type="button"
                        onClick={() => setType(t.value)}
                        className={cn(
                          "w-full rounded-2xl border px-3 py-2 text-left text-xs transition",
                          type === t.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-foreground"
                        )}
                      >
                        <div className="text-sm font-bold">{t.label}</div>
                        <div className="text-[11px] opacity-70">{t.help}</div>
                      </button>
                    </li>
                  ))}
                </ul>
                <textarea
                  className="mt-3 w-full rounded-2xl bg-surface px-3 py-2 text-sm outline-none"
                  rows={3}
                  maxLength={1500}
                  placeholder="What's wrong? (e.g. ‘sign actually says 4 hour parking, not 2’)"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => setOpen(false)} disabled={busy} className="flex-1 rounded-full bg-muted py-2.5 text-sm font-semibold">
                    Cancel
                  </button>
                  <button type="button" onClick={submit} disabled={busy} className="flex-1 rounded-full bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60 inline-flex items-center justify-center gap-2">
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Submit
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
