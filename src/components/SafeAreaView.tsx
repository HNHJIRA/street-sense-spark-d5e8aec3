import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface SafeAreaViewProps extends HTMLAttributes<HTMLDivElement> {
  /** Which device insets to apply as padding. Defaults to all four. */
  edges?: Array<"top" | "bottom" | "left" | "right">;
}

/**
 * Wrap full-screen content so it stays clear of the notch, status bar,
 * home indicator and rounded corners on iOS/Android.
 *
 * Reads CSS env(safe-area-inset-*) via our --safe-* CSS variables.
 */
export const SafeAreaView = forwardRef<HTMLDivElement, SafeAreaViewProps>(
  ({ className, edges = ["top", "bottom", "left", "right"], style, ...props }, ref) => {
    const has = (e: typeof edges[number]) => edges.includes(e);
    return (
      <div
        ref={ref}
        {...props}
        style={{
          paddingTop: has("top") ? "var(--safe-top)" : undefined,
          paddingBottom: has("bottom") ? "var(--safe-bottom)" : undefined,
          paddingLeft: has("left") ? "var(--safe-left)" : undefined,
          paddingRight: has("right") ? "var(--safe-right)" : undefined,
          ...style,
        }}
        className={cn(className)}
      />
    );
  },
);
SafeAreaView.displayName = "SafeAreaView";
