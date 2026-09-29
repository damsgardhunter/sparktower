/**
 * A small bordered badge for a state.
 *
 * Deliberately not the `Badge` primitive: this is the tinted, thin-bordered
 * shape the Codebase tab uses for a severity or a build stage, where a dozen
 * of them sit in a row and the shadcn badge's weight would make the screen
 * shout. `tone` keeps the colour decisions in one place rather than as a
 * string of Tailwind classes repeated at every call site.
 */
import type { HTMLAttributes, ReactNode } from "react";

export type PillTone = "good" | "warn" | "bad" | "info" | "neutral" | "unknown";

/**
 * Each tone at one tenth opacity with a matching border.
 *
 * `unknown` is the one worth reading twice: it is dashed and blue, never red,
 * because "nobody has checked" is a question and `bad` is an answer. Drawing
 * them alike is how a screen tells somebody they have a problem they do not
 * have.
 */
export const PILL_TONE: Record<PillTone, string> = {
  good: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
  bad: "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-400",
  info: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400",
  neutral: "bg-muted text-muted-foreground border-black/[0.08] dark:border-white/10",
  unknown: "bg-sky-500/10 text-sky-700 border-sky-500/40 border-dashed dark:text-sky-400",
};

export function Pill({ tone = "neutral", className = "", children, ...rest }:
  { tone?: PillTone; className?: string; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${PILL_TONE[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
