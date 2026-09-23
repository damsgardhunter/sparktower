import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * One block of a section screen: a small uppercase label, an optional control
 * on the right, and its content. Blocks are stacked in a `divide-y` column so
 * every one sits between thin rules.
 *
 * ## Collapsing
 *
 * A section screen had seven blocks open at once — the next step, progress,
 * the loops, fundability, the codebase, recent activity and the whole path —
 * so the one thing it exists to answer, *what do I do next*, was a screen and
 * a half of scrolling away from the bottom of the page and shared the first
 * screen with six things nobody had asked for. A block that is reference
 * rather than action now starts closed, says in one line what it holds, and
 * opens on a click. What it holds is not a secret; it is just not the point.
 */
export function Block({ title, icon: Icon, right, children, testid, className = "", collapsible = false, defaultOpen = true, summary }: {
  title: string; icon?: LucideIcon; right?: ReactNode; children: ReactNode; testid?: string; className?: string;
  /** Starts closed unless `defaultOpen`, and the whole header becomes the toggle. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** One line shown beside the title while closed — what you would learn by opening it. */
  summary?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const heading = (
    <>
      {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
    </>
  );

  if (!collapsible) {
    return (
      <section className={`py-6 first:pt-0 last:pb-0 space-y-3 ${className}`} data-testid={testid}>
        <div className="flex items-center gap-2 min-h-[28px]">
          {heading}
          {right && <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">{right}</div>}
        </div>
        {children}
      </section>
    );
  }

  return (
    <section className={`py-4 first:pt-0 last:pb-0 ${open ? "space-y-3" : ""} ${className}`} data-testid={testid}>
      <div className="flex items-center gap-2 min-h-[28px]">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-2 min-w-0 flex-1 text-left group"
          data-testid={testid ? `${testid}-toggle` : undefined}
        >
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
          {heading}
          {!open && summary && <span className="text-xs text-muted-foreground truncate">{summary}</span>}
        </button>
        {right && open && <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">{right}</div>}
      </div>
      {open && children}
    </section>
  );
}

/** A column of blocks with a rule between each. */
export function Blocks({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`divide-y divide-border ${className}`}>{children}</div>;
}

/** Text that shows two lines until asked for the rest. */
export function Clamp({ text, lines = 2, className = "" }: { text: string | null | undefined; lines?: 1 | 2 | 3; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > (lines === 1 ? 70 : lines === 2 ? 150 : 230) || text.includes("\n");
  const clamp = lines === 1 ? "line-clamp-1" : lines === 2 ? "line-clamp-2" : "line-clamp-3";
  return (
    <div className={className}>
      <p className={`text-sm text-muted-foreground leading-relaxed whitespace-pre-line ${open ? "" : clamp}`}>{text}</p>
      {long && (
        <button className="text-xs text-primary hover:underline mt-0.5" onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</button>
      )}
    </div>
  );
}

/** A small grey pill: an icon and a few words. */
export function Chip({ icon: Icon, children, className = "", title, testid }: { icon?: LucideIcon; children: ReactNode; className?: string; title?: string; testid?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap ${className}`} title={title} data-testid={testid}>
      {Icon && <Icon className="h-3 w-3" />}{children}
    </span>
  );
}
