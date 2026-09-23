/**
 * The strip across the top of a screen that answers "where am I, and what now".
 *
 * ## What it is for
 *
 * Two or three facts and one button, on one row, above everything else. The
 * Codebase tab's is the model: *Code* — which repository; *Last read* — when,
 * and whether it is live; *Do now* — the button. Somebody who opens that tab
 * knows where they stand before they have read a sentence.
 *
 * The alternative, which most of this product still does, is a paragraph
 * explaining the feature followed by a button. A paragraph is read once, by
 * somebody new, and skipped for ever afterwards by the person who uses the
 * screen daily — so the screen is optimised for its least frequent visitor.
 *
 * ## The rules that make it work
 *
 * **Short labels.** One or two words, upper case, quiet. "Last read", not
 * "When this project's code was most recently analysed".
 *
 * **A value that is a fact, not a sentence.** A date, a count, a name, a
 * state. If it needs a verb it belongs in the line underneath.
 *
 * **One action.** The right-hand column is the thing to do next, and there is
 * only ever one of it. Two primary buttons is a screen that has not decided.
 */
import type { ReactNode } from "react";
import { GLANCE_LABEL } from "./tokens";

export function Glance({ children, testId = "glance" }: { children: ReactNode; testId?: string }) {
  return (
    <div
      /*
       * Stacked on a phone, ruled columns from `sm`. The dividers are what
       * make three facts read as three facts rather than one paragraph.
       */
      className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto] sm:gap-0 sm:divide-x sm:divide-black/[0.08] dark:sm:divide-white/10"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** One fact: a label, the fact, and optionally a quieter line under it. */
export function GlanceStat({ label, value, note, className = "", testId }: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={`min-w-0 sm:px-5 sm:first:pl-0 sm:last:pr-0 ${className}`} data-testid={testId}>
      <p className={GLANCE_LABEL}>{label}</p>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
      {note && <div className="mt-0.5 truncate text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

/**
 * The last column: what to do next.
 *
 * Its label is hidden from `sm` up, where the button under three ruled columns
 * is self-evidently the action, and shown on a phone where the columns have
 * become a stack and it no longer is.
 */
export function GlanceAction({ children, label = "Do now", testId }: { children: ReactNode; label?: string; testId?: string }) {
  return (
    <div className="flex flex-col justify-center gap-1 sm:pl-5" data-testid={testId}>
      <p className={`${GLANCE_LABEL} sm:hidden`}>{label}</p>
      {children}
    </div>
  );
}
