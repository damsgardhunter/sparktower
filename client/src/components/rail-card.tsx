import { Link } from "wouter";
import { ChevronRight } from "lucide-react";

/**
 * A box sits *above* the page, so it has to be lighter than it.
 *
 * This theme defines a white background with grey cards, which is the inverse
 * of the feed look — cards came out darker than the page and the whole layout
 * read flat. Using the tokens the other way round gives white boxes on a grey
 * page in light mode, and lifted boxes on black in dark mode.
 */
export const BOX_SURFACE = "bg-background dark:bg-card";

/**
 * The box shape LinkedIn uses for its rail modules.
 *
 * Deliberately not the app's `Card`: that one has a larger radius and a
 * shadow, which reads as a floating panel. LinkedIn's rails are flat, tightly
 * rounded, hairline-bordered boxes that sit against the page — and matching
 * that shape is most of what makes a layout "look like LinkedIn". Defined once
 * so every rail module is identical rather than each one approximating it.
 */
export function RailCard({
  children, className, padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Off for cards whose first child is a full-bleed image. */
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-border ${BOX_SURFACE} overflow-hidden ${padded ? "p-3" : ""} ${className || ""}`}
    >
      {children}
    </div>
  );
}

/** A rail module's title row, with an optional "see all" on the right. */
export function RailHeader({
  title, href, action,
}: {
  title: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      {href && (
        <Link href={href} className="text-xs text-primary hover:underline shrink-0">
          {action || "See all"}
        </Link>
      )}
    </div>
  );
}

/**
 * A tappable row inside a rail module.
 *
 * Full-width hover with negative margins so the highlight bleeds to the card's
 * edges, the way LinkedIn's list rows do, instead of floating inset.
 */
export function RailRow({
  href, icon: Icon, label, value, sublabel, onClick, testId,
}: {
  href?: string;
  icon?: any;
  label: string;
  value?: string | number;
  sublabel?: string;
  onClick?: () => void;
  testId?: string;
}) {
  const body = (
    <span className="flex items-center gap-2 min-w-0 w-full">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm truncate">{label}</span>
        {sublabel && <span className="block text-xs text-muted-foreground truncate">{sublabel}</span>}
      </span>
      {value !== undefined ? (
        <span className="text-sm font-semibold text-primary shrink-0 tabular-nums">{value}</span>
      ) : (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      )}
    </span>
  );

  const classes = "flex items-center -mx-3 px-3 py-1.5 hover:bg-accent transition-colors text-left w-[calc(100%+1.5rem)]";

  if (href) {
    return <Link href={href} className={classes} data-testid={testId}>{body}</Link>;
  }
  return (
    <button type="button" onClick={onClick} className={classes} data-testid={testId}>
      {body}
    </button>
  );
}

/** The hairline that separates sections inside one card. */
export function RailDivider() {
  return <div className="-mx-3 my-2 border-t border-border" />;
}
