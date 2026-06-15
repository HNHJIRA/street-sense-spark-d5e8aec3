import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

export function AppBar({
  title,
  right,
  back = true,
  transparent = false,
  backTo = "/dashboard",
}: {
  title?: string;
  right?: ReactNode;
  back?: boolean;
  transparent?: boolean;
  backTo?: string;
}) {
  return (
    <header className={`flex items-center justify-between px-5 pt-3 pb-2 ${transparent ? "" : "bg-white"}`}>
      {back ? (
        <Link to={backTo} className="flex h-11 w-11 items-center justify-center rounded-full bg-white pc-shadow-card">
          <ChevronLeft className="h-5 w-5" style={{ color: "var(--pc-brand-end)" }} />
        </Link>
      ) : (
        <div className="h-11 w-11" />
      )}
      {title && <h1 className="text-base font-semibold text-slate-900">{title}</h1>}
      <div className="h-11 w-11 flex items-center justify-end">{right}</div>
    </header>
  );
}

export function GradientButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="pc-bg-gradient-brand pc-shadow-brand w-full rounded-2xl py-4 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function IconBubble({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="pc-shadow-card flex h-14 w-14 items-center justify-center rounded-full bg-white transition active:scale-95"
    >
      {children}
    </button>
  );
}
