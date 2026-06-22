// Shared "parking attendant" narrator. Used by BOTH the AI Sign Scanner
// (src/routes/scan.tsx) and the Can-I-Park decision screen
// (src/components/ParkDecisionScreen.tsx) so the two surfaces produce
// identical phrasing for identical structured inputs.
//
// Anti-hallucination: this function does NOT decide parking legality and
// does NOT invent any facts. Every clause traces back to a structured
// input field; if a field is missing the clause is dropped — never
// guessed, never estimated.

export interface OfficerArgs {
  status: "YES" | "NO" | "LIMITED" | "UNKNOWN";
  reason: string;
  appliesTo: "LEFT" | "RIGHT" | "BOTH" | "NONE";
  hasArrows: boolean;
  nowClock: string;
  nowDay: string;
  allowedUntilLabel: string | null;
  allowedUntilDayLabel: string | null;
  maxStayLabel: string | null;
  timeLimitMinutes: number | null;
  nextReasonLabel: string | null;
  nextStartLabel: string | null;
  nextStartDayLabel: string | null;
  nextEndLabel: string | null;
  becomesFreeDayLabel: string | null;
  currentRuleWindow: string | null;
  nextRuleWindow: string | null;
  parsedWindow: string | null;
  currentRuleActive: boolean;
  sidesDiffer: boolean;
  leftUntil: string | null;
  rightUntil: string | null;
  leftRuleLabel: string | null;
  rightRuleLabel: string | null;
  leftActive: boolean;
  rightActive: boolean;
  bothWindow: string | null;
  restrictionStartsLabel: string | null;
  decisionConfidence: number;
  /** Engine code for the currently active rule (e.g. "passenger_loading"). */
  activeCode: string | null;
  /** Plain-English description of who may use a loading/taxi/bus zone. */
  loadingActivity: string | null;
  /** Clock label for restriction_ends_at, used by loading-zone narratives. */
  restrictionEndLabel: string | null;
  currentRuleStartLabel: string | null;
  currentRuleEndLabel: string | null;
  nextRuleLabel: string | null;
  nextRuleTimeLimit: number | null;
  nextRuleStartLabel: string | null;
  nextRuleEndLabel: string | null;
}

// Narrator-only side phrase. Uses ONLY the supplied arrow value — never guesses.
export function sidePhrase(appliesTo: OfficerArgs["appliesTo"], hasArrows: boolean): string {
  if (!hasArrows || appliesTo === "NONE") return "for this location";
  if (appliesTo === "LEFT") return "for the left side";
  if (appliesTo === "RIGHT") return "for the right side";
  if (appliesTo === "BOTH") return "for both directions";
  return "for this location";
}

export function buildOfficerParagraph(a: OfficerArgs): string {
  const directionSentence =
    a.appliesTo === "LEFT"  ? " This sign applies to the LEFT side." :
    a.appliesTo === "RIGHT" ? " This sign applies to the RIGHT side." :
    a.appliesTo === "BOTH" && a.hasArrows ? " This sign applies to BOTH sides." : "";
  const prefix = `it is currently ${a.nowClock} on ${a.nowDay}.${directionSentence}`;

  if (a.status === "UNKNOWN" || a.decisionConfidence < 0.65) {
    return `UNKNOWN. ${prefix} The sign could not be interpreted with sufficient confidence. Please inspect the sign manually.`;
  }

  const side = sidePhrase(a.appliesTo, a.hasArrows);

  if (a.activeCode && a.loadingActivity) {
    const reasonNoLimit = (a.reason || "").replace(/\s*\([^)]*\)\s*$/, "").trim() || "Loading Only";
    const start = a.currentRuleStartLabel;
    const end = a.currentRuleEndLabel ?? a.restrictionEndLabel;
    const activeWindow = start && end
      ? `${reasonNoLimit} is active from ${start} until ${end}.`
      : end
        ? `${reasonNoLimit} is active until ${end}.`
        : `${reasonNoLimit} is currently active.`;
    const limitLine = a.timeLimitMinutes
      ? (end
          ? `A ${a.timeLimitMinutes}-minute loading limit applies until ${end}.`
          : `A ${a.timeLimitMinutes}-minute loading limit applies.`)
      : "";
    const nextLine = (() => {
      if (!a.nextRuleLabel) return "";
      const nextLimit = a.nextRuleTimeLimit ? `${a.nextRuleTimeLimit}-minute loading limit` : null;
      const untilNext = a.nextRuleEndLabel ? ` until ${a.nextRuleEndLabel}` : "";
      const after = end ? `After ${end} the rule changes to: ${a.nextRuleLabel}` : `Next: ${a.nextRuleLabel}`;
      return nextLimit ? `${after}, ${nextLimit}${untilNext}.` : `${after}${untilNext}.`;
    })();
    return [
      `LIMITED. ${prefix}`,
      activeWindow,
      "General parking is not permitted during this period.",
      a.loadingActivity,
      limitLine,
      nextLine,
    ].filter(Boolean).join(" ");
  }

  if (a.status === "NO") {
    const reasonLc = (a.reason || "no-parking").toLowerCase();
    const window = a.currentRuleWindow ?? a.parsedWindow;
    const windowClause = window ? ` ${window}` : "";
    const becomes = a.becomesFreeDayLabel ?? a.nextEndLabel;
    const endTail = becomes ? ` Parking becomes available again at ${becomes}.` : "";
    return `NO. ${prefix} A ${reasonLc} restriction ${side} is currently active${windowClause}. Parking is not allowed at this time.${endTail}`;
  }

  if (a.sidesDiffer && (a.leftRuleLabel || a.rightRuleLabel || (a.leftUntil && a.rightUntil))) {
    const rightLbl = a.rightRuleLabel ?? "posted";
    const leftLbl = a.leftRuleLabel ?? "posted";
    const bothActive = a.leftActive && a.rightActive;
    const neitherActive = !a.leftActive && !a.rightActive;
    if (bothActive) {
      const rightTail = a.rightUntil ? ` If you park on the right side, you must leave by ${a.rightUntil}.` : "";
      const leftTail = a.leftUntil ? ` If you park on the left side, you may remain until ${a.leftUntil}.` : "";
      return `YES. ${prefix} The ${rightLbl} restriction for the right side and the ${leftLbl} restriction for the left side are currently active.${rightTail}${leftTail}`;
    }
    if (neitherActive) {
      const windowClause = a.bothWindow ? ` ${a.bothWindow}` : "";
      const untilTailNeither = (a.allowedUntilDayLabel ?? a.allowedUntilLabel)
        ? ` You can park here until ${a.allowedUntilDayLabel ?? a.allowedUntilLabel}.`
        : "";
      return `YES. ${prefix} The ${rightLbl} restriction for the right side and the ${leftLbl} restriction for the left side both apply${windowClause}. Since it is currently outside that window, these time limits are not active.${untilTailNeither}`;
    }
    if (a.leftUntil && a.rightUntil) {
      return `YES. ${prefix} The ${rightLbl} restriction for the right side allows parking until ${a.rightUntil}, and the ${leftLbl} restriction for the left side allows parking until ${a.leftUntil} because different rules apply to each direction.`;
    }
  }

  const untilLabel = a.allowedUntilDayLabel ?? a.allowedUntilLabel;
  const untilTail = untilLabel ? ` You can park here until ${untilLabel}.` : "";
  const reasonLc = (a.reason || "").toLowerCase();
  const hasLimit = !!(a.timeLimitMinutes && a.timeLimitMinutes > 0);
  const limitLabel = a.maxStayLabel
    ? a.maxStayLabel.toLowerCase()
    : hasLimit
      ? `${a.timeLimitMinutes}-minute`
      : null;

  if (a.currentRuleActive && hasLimit && limitLabel) {
    const window = a.currentRuleWindow ? ` between ${a.currentRuleWindow.replace(/^between /, "")}` : "";
    const upTo = ` You may park here for up to ${limitLabel}.`;
    return `YES. ${prefix} The ${limitLabel} parking restriction ${side} is currently active${window}.${upTo}${untilTail}`;
  }

  if (!a.currentRuleActive && (a.nextRuleWindow || a.parsedWindow)) {
    const rawWindow = (a.nextRuleWindow ?? a.parsedWindow)!;
    const window = rawWindow.replace(/^between /, "from ").replace(/ and /, " to ");
    const what = limitLabel
      ? `${limitLabel} parking`
      : a.nextReasonLabel
        ? a.nextReasonLabel.toLowerCase()
        : reasonLc || "posted";
    return `YES. ${prefix} The ${what} restriction ${side} applies ${window}. Since it is currently outside that window, this time limit is not active.${untilTail}`;
  }

  if (a.currentRuleActive && reasonLc && reasonLc !== "free parking") {
    const window = a.currentRuleWindow ? ` ${a.currentRuleWindow}` : "";
    return `YES. ${prefix} ${capitalize(reasonLc)} applies ${side}${window}.${untilTail}`;
  }

  return `YES. ${prefix} Parking is currently allowed here.${untilTail}`;
}

export function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
