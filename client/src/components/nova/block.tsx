/**
 * One section of a long screen, separated by a line rather than boxed in a card.
 *
 * A page of eight cards is eight borders, eight shadows and eight radiuses
 * competing with the content inside them; the eye has to re-enter a container
 * at every heading. A ruled block is the same grouping with none of that, and
 * it is what makes the Codebase tab read as one screen rather than a pile of
 * widgets.
 *
 * Use a `Card` when a thing could be moved elsewhere on its own. Use a `Block`
 * for the parts of one screen.
 */
import type { ReactNode, Ref } from "react";
import { GLANCE_LABEL } from "./tokens";

export function Block({ title, count, action, children, testId, innerRef, className = "" }: {
  title: string;
  /** A number or pill beside the title — "12", "3 open". */
  count?: ReactNode;
  /** One control, on the right of the heading. */
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
  innerRef?: Ref<HTMLElement>;
  className?: string;
}) {
  return (
    <section
      ref={innerRef}
      /* `scroll-mt` so linking to a block does not tuck its heading under a sticky header. */
      className={`space-y-3 border-t border-black/[0.08] px-4 py-5 scroll-mt-4 dark:border-white/10 sm:px-6 ${className}`}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={GLANCE_LABEL}>{title}</h2>
        {count != null && <span className="text-xs text-muted-foreground">{count}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}
