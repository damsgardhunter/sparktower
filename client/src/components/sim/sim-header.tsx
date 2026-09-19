/**
 * The header every simulation page off the desk shares: market, boardroom,
 * standings, the year's report.
 *
 * Each page used to draw its own — the same padded gradient wrapper around a
 * card, four times, with an icon in a different place each time. One header
 * now, in the desk's language: the Nova ring and glow on a single element, the
 * page's icon in a gradient chip the way the project manager's rail marks the
 * active tab, and the way back to the desk always in the same corner. Whatever
 * a page needs to say under its title (the funds a team can bid with, a year
 * picker) goes in as children.
 */
import type { ComponentType, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export function SimHeader({ icon: Icon, title, titleTestId, subtitle, onBack, backLabel = "Back to your desk", backTestId = "button-back-desk", children }: {
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  titleTestId?: string;
  subtitle?: ReactNode;
  onBack: () => void;
  backLabel?: string;
  backTestId?: string;
  children?: ReactNode;
}) {
  return (
    <header className="rounded-2xl nova-ring-page nova-glow p-5 sm:p-6" data-testid="sim-header">
      <button onClick={onBack} className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid={backTestId}>
        <ArrowLeft className="h-3 w-3" /> {backLabel}
      </button>
      <div className="flex items-center gap-3">
        {Icon && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl nova-chip">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight" data-testid={titleTestId}>{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
        </div>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </header>
  );
}
