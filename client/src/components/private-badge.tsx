import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Marks a project as private. Used on the project page, project cards, and
 * leaderboard rows so the indicator reads the same everywhere.
 */
export function PrivateBadge({
  variant = "badge",
  className = "",
}: {
  /** "badge" shows a labeled pill; "icon" is a bare lock for tight rows. */
  variant?: "badge" | "icon";
  className?: string;
}) {
  const label = "Private project — only you and your team can see this";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {variant === "icon" ? (
            <span
              className={`inline-flex items-center text-muted-foreground ${className}`}
              aria-label={label}
              data-testid="badge-private-icon"
            >
              <Lock className="h-3.5 w-3.5" />
            </span>
          ) : (
            <Badge
              variant="secondary"
              className={`gap-1 font-normal ${className}`}
              aria-label={label}
              data-testid="badge-private"
            >
              <Lock className="h-3 w-3" /> Private
            </Badge>
          )}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
